/**
 * runner — runner-independent suite execution.
 *
 * The shared core behind both entry points: the engine's own vitest self-test
 * (examples/scenarios.test.ts) and the `run` CLI a consumer invokes. Waits for
 * the running system + deployment baseline, then runs every discovered scenario in order
 * (they share one running system, so serial), rendering developer-facing diagnostics on
 * failure and returning a structured result the reporters turn into junit/ctrf.
 */
import pc from "picocolors";
import type { Config } from "../config.ts";
import { MidpointRest } from "../clients/midpointRest.ts";
import { awaitMidpointReady, awaitBaseline } from "../env/readiness.ts";
import { loadScenarios, validateScenarioSystems } from "./loader.ts";
import type { LoadedScenario } from "./loader.ts";
import { loadSuite, triggerOid, primaryMidpointSystem, midpointConnection } from "./suite.ts";
import { runScenario } from "./runner.ts";
import { reportFailure, getStepLocation } from "./failure.ts";
import { ExpectedMismatchError } from "../verify/expected.ts";

export interface ScenarioResult {
  id: string;
  requirement: string;
  /** Absolute path to the scenario.yaml. */
  file: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  /** Plain (escape-free) failure message, for junit/ctrf. */
  message?: string;
}

export interface SuiteResult {
  tests: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    /** Epoch ms. */
    start: number;
    stop: number;
  };
}

/** A scenario in execution order. */
export interface PlannedScenario {
  loaded: LoadedScenario;
}

/**
 * Order scenarios for execution: ungrouped scenarios first in their given order,
 * then grouped scenarios, each group's members kept contiguous and in declared
 * order (the loader has already sorted members within a group by orderIndex).
 *
 * No reset is wired here — idempotency reset across runs is the standalone snapshot
 * CLI's job (src/cli/snapshot.ts), deliberately NOT coupled to a scenario run.
 */
export function planExecution(scenarios: LoadedScenario[]): PlannedScenario[] {
  const ungrouped = scenarios.filter((s) => !s.group);
  const grouped = scenarios.filter((s) => s.group);
  const groupIds: string[] = [];
  for (const s of grouped) {
    if (!groupIds.includes(s.group!.id)) groupIds.push(s.group!.id);
  }
  const orderedGrouped = groupIds.flatMap((gid) => grouped.filter((s) => s.group!.id === gid));
  return [...ungrouped, ...orderedGrouped].map((loaded) => ({ loaded }));
}

/**
 * Run every scenario under `scenariosDir` against the configured running system. Reports
 * failures to the console as it goes and returns the structured result; it never
 * throws on a scenario failure (the caller decides the process exit code).
 */
export async function runSuite(
  cfg: Config,
  scenariosDir: string = cfg.scenariosDir,
): Promise<SuiteResult> {
  const suite = await loadSuite(scenariosDir);
  // The midPoint connection comes from the sole midPoint SYSTEM (its env-named
  // base URL + admin credential), falling back to the env defaults (`cfg.midpoint`)
  // when its vars are unset — so a single-instance suite still runs off the
  // conventional MIDPOINT_* defaults. (A suite with several midPoints drives each
  // via a step's `system:`; the primary is then the env default.)
  const primary = primaryMidpointSystem(suite);
  const rest = new MidpointRest(primary ? midpointConnection(primary, cfg.midpoint) : cfg.midpoint);
  await awaitMidpointReady(rest, cfg.poll);

  const allScenarios = await loadScenarios(scenariosDir);
  // Fail fast (with a source line) on a step that names a system its kind can't act on.
  validateScenarioSystems(allScenarios, suite);
  // IDW_ONLY pins the run to one scenario id (same knob as capture-expected) — for
  // iterating on a single behavior without re-running (and, in an LDAP suite,
  // cross-contaminating) the rest.
  const only = process.env["IDW_ONLY"];
  const scenarios = only ? allScenarios.filter((l) => l.scenario.id === only) : allScenarios;
  if (only && scenarios.length === 0) {
    throw new Error(`IDW_ONLY=${only} matched no scenario under ${scenariosDir}`);
  }

  // Wait for the deployment config to be present before exercising it: gate on
  // the registered tasks the scenarios trigger (recon/import) existing.
  await awaitBaseline(
    rest,
    cfg.poll,
    Object.values(suite.triggers ?? {}).flatMap((t) =>
      [t.recon, t.import].map(triggerOid).filter((oid): oid is string => !!oid).map((oid) => ({ type: "tasks", oid })),
    ),
  );

  const plan = planExecution(scenarios);
  // A group is a chain — once a member fails, the rest run on an undefined state,
  // so they are blocked (skipped) rather than reported as flaky.
  const failedChains = new Set<string>();

  const tests: ScenarioResult[] = [];
  const start = Date.now();
  for (const { loaded } of plan) {
    const { id, requirement } = loaded.scenario;
    const group = loaded.group;

    if (group && failedChains.has(group.id)) {
      tests.push({
        id, requirement, file: loaded.file, status: "skipped", durationMs: 0,
        message: `blocked: an earlier scenario in chain "${group.id}" failed`,
      });
      console.error(`${pc.yellow("∅")} ${id} ${pc.dim(`[${requirement}] skipped — chain "${group.id}" blocked`)}`);
      continue;
    }

    const t0 = performance.now();
    try {
      await runScenario(loaded, { rest, cfg, suite, now: () => Date.now() });
      const durationMs = Math.round(performance.now() - t0);
      tests.push({ id, requirement, file: loaded.file, status: "passed", durationMs });
      console.error(`${pc.green("✓")} ${id} ${pc.dim(`[${requirement}] ${durationMs}ms`)}`);
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      reportFailure(err);
      // reportFailure stays silent for errors that aren't a step assertion (no
      // location, not a mismatch) — surface those, with their stack, so an
      // unexpected harness/config error isn't swallowed.
      if (!getStepLocation(err) && !(err instanceof ExpectedMismatchError)) {
        console.error(`\n✗ ${id}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }
      tests.push({
        id,
        requirement,
        file: loaded.file,
        status: "failed",
        durationMs,
        message: err instanceof Error ? err.message : String(err),
      });
      if (group) failedChains.add(group.id);
    }
  }
  const stop = Date.now();
  const passed = tests.filter((t) => t.status === "passed").length;
  const failed = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  return { tests, summary: { total: tests.length, passed, failed, skipped, start, stop } };
}
