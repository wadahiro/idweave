/**
 * CLI command: capture expected files by current-behaviour capture.
 *
 * Runs each scenario in capture mode, writing the normalized projection to its
 * expected path. by design: capture is allowed, but the captured expected MUST then
 * be verified against intent (requirement/config) in review — never blindly pin
 * current behavior.
 */
import { loadConfig } from "../config.ts";
import { MidpointRest } from "../clients/midpointRest.ts";
import { awaitMidpointReady } from "../env/readiness.ts";
import { loadScenarios, validateScenarioSystems } from "../scenario/loader.ts";
import { loadSuite } from "../scenario/suite.ts";
import { runScenario } from "../scenario/runner.ts";

export async function captureExpected(scenariosDirArg?: string): Promise<void> {
  const cfg = loadConfig();
  const rest = new MidpointRest(cfg.midpoint);
  await awaitMidpointReady(rest, cfg.poll);

  const scenariosDir = scenariosDirArg ?? cfg.scenariosDir;
  const suite = await loadSuite(scenariosDir);
  const all = await loadScenarios(scenariosDir);
  validateScenarioSystems(all, suite);
  // Per-scenario authoring loop (CLAUDE.md): IDW_ONLY pins capture to one scenario
  // id, so re-capturing a single behavior never re-runs (and cross-contaminates) the
  // rest of the suite — important once any LDAP/AD system is in play.
  const only = process.env["IDW_ONLY"];
  const scenarios = only ? all.filter((l) => l.scenario.id === only) : all;
  if (only && scenarios.length === 0) {
    throw new Error(`IDW_ONLY=${only} matched no scenario under ${scenariosDir}`);
  }
  for (const loaded of scenarios) {
    await runScenario(loaded, { rest, cfg, suite, now: () => Date.now() }, { captureExpected: true });
    console.log(`captured expected for ${loaded.scenario.id}`);
  }
}
