/**
 * Clear a Keycloak realm's DB-derived in-memory caches over admin REST — the IdP
 * counterpart of `clearMidpointCache` (clients/cacheClear.ts).
 *
 * Why: a near-non-stop snapshot-restore rolls the Keycloak DB back WITHOUT restarting
 * Keycloak, so its Infinispan realm / user / keys caches keep serving the
 * pre-rollback state (realm + client + role + group config, looked-up users, realm
 * signing keys — all DB-derived) until something invalidates them. Clearing all
 * three after the restore reconciles the running Keycloak with the rolled-back DB.
 * A full-restart restore reboots Keycloak, so this is a harmless no-op there.
 *
 * Unlike midPoint's clear (Groovy into version-specific internal beans), the
 * Keycloak admin REST cache endpoints are STABLE across versions — no per-version
 * payload branch is needed.
 */
import { KeycloakAdmin, KeycloakAdminError } from "./keycloakAdmin.ts";
import { pollUntil } from "../poll.ts";
import type { IdpAdminConfig, PollConfig } from "../config.ts";

/**
 * Invalidate the realm, user, and keys caches of one Keycloak realm. Right after a
 * near-non-stop unpause the DB pool / token endpoint may still be re-establishing,
 * so retry (bounded poll, no sleep) until all three clears succeed in one pass.
 */
export async function clearKeycloakCaches(cfg: IdpAdminConfig, poll: PollConfig): Promise<void> {
  const kc = new KeycloakAdmin(cfg);
  await pollUntil(
    async () => {
      try {
        await kc.clearCache("realm");
        await kc.clearCache("user");
        await kc.clearCache("keys");
        return true;
      } catch (e) {
        // A permanent authz failure (bad creds / missing role like `manage-realm`)
        // will NEVER succeed — fail fast instead of burning the whole poll window.
        // Transient errors (the DB pool / token endpoint still re-establishing right
        // after a near-non-stop unpause) → return false to retry until the deadline.
        if (e instanceof KeycloakAdminError && (e.status === 401 || e.status === 403)) throw e;
        return false;
      }
    },
    (ok) => ok,
    poll,
    `Keycloak cache clear (${cfg.url} realm ${cfg.realm})`,
  );
}
