/**
 * CLI command: block until the running system is ready (env readiness, polled).
 * Used by the outer orchestrator before importing config / running tests.
 */
import { loadConfig } from "../config.ts";
import { MidpointRest } from "../clients/midpointRest.ts";
import { awaitMidpointReady } from "../env/readiness.ts";

export async function waitReady(): Promise<void> {
  const cfg = loadConfig();
  const rest = new MidpointRest(cfg.midpoint);
  await awaitMidpointReady(rest, cfg.poll);
  console.log("midPoint is ready.");
}
