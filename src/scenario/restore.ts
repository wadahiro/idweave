/**
 * Restore participants — the extension point for system-specific rollback repair.
 * A near-non-stop restore first calls `beforeRestore()` to quiesce volatile work,
 * then rolls back volumes generically (infra: docker + btrfs), then calls
 * `afterRestore()` to reconcile in-memory state. No per-action config: the system
 * TYPE decides its behavior.
 *
 * Implementations (one place to see "which system does what" on restore):
 *   - midpoint → STOP TASKS + SCHEDULER, then clear caches, synchronize Quartz,
 *     and restart the scheduler (see clients/cacheClear.ts). Version-correct per instance.
 *   - keycloak → CLEAR CACHES (its realm/user/keys Infinispan caches hold the
 *     rolled-back DB; see clients/keycloakCacheClear.ts). Version-independent.
 *   - csv / ldap / db → no hook (their data is rolled back by snapshot itself).
 */
import type { Config } from "../config.ts";
import { quiesceMidpointTasks, restoreMidpointTasks } from "../clients/cacheClear.ts";
import { clearKeycloakCaches } from "../clients/keycloakCacheClear.ts";
import { midpointConnection, keycloakAdminConnection, type Suite, type SystemSpec } from "./suite.ts";

export interface RestoreParticipant {
  readonly label: string;
  /** Quiesce state that cannot survive an out-of-band store rollback. */
  beforeRestore?(): Promise<void>;
  /** A failed repair leaves the system unsafe to use and must fail the restore. */
  requiredAfterRestore?: boolean;
  /** Reconcile in-memory state with the rolled-back stores (called after snapshot-restore). */
  afterRestore(): Promise<void>;
}

/** The restore participant for a system, or `null` when its type needs no post-restore hook. */
export function restoreParticipant(name: string, sys: SystemSpec, cfg: Config): RestoreParticipant | null {
  if (sys.midpoint) {
    const m = sys.midpoint;
    // Strict (no fallback): a restore participant must clear THIS instance's cache,
    // never silently fall back to the primary's connection.
    const conn = midpointConnection(m);
    return {
      label: `midpoint:${name} (${conn.baseUrl}, v${m.version})`,
      // All supported 4.x majors expose these TaskManager methods. The Groovy
      // scripts select the version-correct SpringApplicationContextHolder.
      beforeRestore: () => quiesceMidpointTasks(conn, m.version, cfg.poll),
      requiredAfterRestore: true,
      afterRestore: () => restoreMidpointTasks(conn, m.version, cfg.poll),
    };
  }
  if (sys.keycloak) {
    const conn = keycloakAdminConnection(sys.keycloak);
    return {
      label: `keycloak:${name} (${conn.url}, realm ${conn.realm})`,
      afterRestore: () => clearKeycloakCaches(conn, cfg.poll),
    };
  }
  // csv / ldap / db: data is rolled back by snapshot; nothing in-memory to reconcile.
  return null;
}

/** All systems that have a post-restore hook, in declaration order. */
export function restoreParticipants(suite: Suite, cfg: Config): RestoreParticipant[] {
  return Object.entries(suite.systems)
    .map(([name, sys]) => restoreParticipant(name, sys, cfg))
    .filter((p): p is RestoreParticipant => p !== null);
}

/** Stop each participant that has volatile work before a near-non-stop rollback. */
export async function runBeforeRestore(suite: Suite, cfg: Config): Promise<void> {
  for (const p of restoreParticipants(suite, cfg)) {
    if (!p.beforeRestore) continue;
    await p.beforeRestore();
    console.log(`before-restore: ${p.label} quiesced`);
  }
}

/** Run every participant's `afterRestore` (a per-participant failure is a loud WARN, not fatal). */
export async function runAfterRestore(suite: Suite, cfg: Config): Promise<void> {
  const participants = restoreParticipants(suite, cfg);
  if (participants.length === 0) {
    console.log("after-restore: no participants (no midpoint/keycloak system declared).");
    return;
  }
  for (const p of participants) {
    try {
      await p.afterRestore();
      console.log(`after-restore: ${p.label} ok`);
    } catch (e) {
      if (p.requiredAfterRestore) throw e;
      console.warn(`WARN after-restore ${p.label}: ${(e as Error).message}`);
    }
  }
}
