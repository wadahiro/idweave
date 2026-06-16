/**
 * env — environment readiness.
 *
 * Readiness is polled, never slept on (by design): the running system is ready when
 * midPoint answers REST AND the expected baseline exists (the well-known
 * administrator user). Heavy lifecycle ops (up / snapshot restore) belong to the
 * outer orchestrator (make/CI), not here.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";
import type { PollConfig } from "../config.ts";
import { pollUntil } from "../poll.ts";

/** Well-known administrator user OID — our baseline marker. */
const ADMINISTRATOR_OID = "00000000-0000-0000-0000-000000000002";

/**
 * Block until midPoint is reachable and the baseline administrator user is
 * present. Resolves on success; throws PollTimeoutError on deadline.
 */
export async function awaitMidpointReady(
  rest: MidpointRest,
  poll: PollConfig,
): Promise<void> {
  await pollUntil(
    async () => {
      try {
        const admin = await rest.getUser(ADMINISTRATOR_OID);
        return admin !== null;
      } catch {
        // Connection refused / 5xx during startup — keep polling.
        return false;
      }
    },
    (ready) => ready,
    poll,
    "midPoint REST up and baseline administrator present",
  );
}

/** A baseline object that must exist before scenarios run (e.g. a resource). */
export interface BaselineRef {
  type: string;
  oid: string;
}

/**
 * Block until all baseline objects exist. The deployment config is constructed
 * outside the runtime (post-init at startup, or the REST CLI), and post-init
 * lands slightly after REST comes up — so the test entry waits for "configured",
 * not just "live" (by design: confirm the baseline exists). Liveness vs configured
 * are separate on purpose: the REST bootstrap path must not require config to
 * already be present.
 */
export async function awaitBaseline(
  rest: MidpointRest,
  poll: PollConfig,
  refs: BaselineRef[],
): Promise<void> {
  if (refs.length === 0) return;
  await pollUntil(
    async () => {
      for (const ref of refs) {
        const obj = await rest.getObject(ref.type, ref.oid).catch(() => null);
        if (obj === null) return false;
      }
      return true;
    },
    (present) => present,
    poll,
    `baseline objects present: ${refs.map((r) => `${r.type}/${r.oid}`).join(", ")}`,
  );
}
