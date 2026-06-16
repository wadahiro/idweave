/**
 * Resolve the midPoint instance a connector-mediated `resource` system is driven
 * THROUGH — its REST client + version. The version selects the version-correct
 * connector-script dialect (the same per-instance `version` that drives cache-clear
 * and page objects); the REST client routes the executeScript to the right midPoint.
 *
 * `resource.midpoint` (a suite.systems key) names the owning instance. Omit it only
 * when the suite has exactly ONE midPoint (that one is used, off the conventional
 * `MIDPOINT_*` env defaults). With several midPoints declared, `midpoint:` is
 * REQUIRED — a resource must never silently route through the wrong instance, so a
 * NAMED instance is also strict (its own connection env vars must be set, no
 * fallback to the defaults).
 */
import { MidpointRest } from "../../clients/midpointRest.ts";
import { midpointSystems, midpointConnection } from "../suite.ts";
import type { Suite, ResourceSystemConfig, MidpointSystemConfig } from "../suite.ts";
import type { Config } from "../../config.ts";

export function resolveResourceMidpoint(
  suite: Suite,
  resource: ResourceSystemConfig,
  cfg: Config,
): { rest: MidpointRest; version: string } {
  return resolveMidpoint(suite, cfg, resource.midpoint, "resource");
}

/**
 * Resolve a driven midPoint instance by name → its REST client + version. `midpointName`
 * names the instance; omit it only when the suite has exactly ONE midPoint (used off the
 * `MIDPOINT_*` env defaults). With several declared, a name is REQUIRED — a step must
 * never silently route through the wrong instance, so a NAMED instance is also strict
 * (its own connection env vars must be set). `what` labels errors for the caller.
 */
export function resolveMidpoint(
  suite: Suite,
  cfg: Config,
  midpointName: string | undefined,
  what = "step",
): { rest: MidpointRest; version: string } {
  const mids = midpointSystems(suite);
  const names = mids.map((m) => m.name).join(", ") || "none";

  let chosen: { name: string; cfg: MidpointSystemConfig };
  if (midpointName) {
    const found = mids.find((m) => m.name === midpointName);
    if (!found) {
      throw new Error(`${what} names midpoint "${midpointName}", but no such midPoint system is declared (have: ${names})`);
    }
    chosen = found;
  } else if (mids.length === 1) {
    chosen = mids[0]!;
  } else if (mids.length === 0) {
    throw new Error(`${what} needs a midPoint system in the suite (none declared)`);
  } else {
    throw new Error(
      `the suite has ${mids.length} midPoint systems (${names}) — set \`midpoint: <name>\` to name the instance for this ${what}`,
    );
  }

  const { version } = chosen.cfg;
  if (!version) {
    throw new Error(`midPoint system "${chosen.name}" needs a \`version\` (for the version-correct script)`);
  }
  // Sole/default instance → fall back to the MIDPOINT_* defaults; a NAMED instance is
  // strict so a step never silently routes through the wrong midPoint.
  const fallback = midpointName ? undefined : cfg.midpoint;
  return { rest: new MidpointRest(midpointConnection(chosen.cfg, fallback)), version };
}
