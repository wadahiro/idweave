/**
 * scenario — ScenarioRunner.
 *
 * Resets the namespace, then runs ordered steps by dispatching each to its
 * StepHandler (see steps/registry.ts) — so assertions can be placed at ANY point
 * in the flow, and new step kinds plug in without touching this file. Anything
 * that needs control flow falls back to a hand-written test calling actions/verify
 * directly (by design) — it does NOT leak into YAML.
 */
import { join } from "node:path";
import type { Config } from "../config.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";
import { dumpCrossSystem } from "../verify/dump.ts";
import { UiDriver, type GuiTarget } from "../clients/ui/driver.ts";
import { loadPageObjects } from "../clients/ui/loader.ts";
import { keycloakGuiPageObjects } from "../clients/ui/keycloakPages.ts";
import type { Suite } from "./suite.ts";
import { drivenGuiSystem } from "./suite.ts";
import { handlerFor } from "./steps/registry.ts";
import { attachStepLocation, plainDetail, dropIfKind } from "./failure.ts";
import type {
  LoadedScenario, ExpectedObject, RunContext, StepRef, Step,
} from "./steps/types.ts";

/** A required env var's value, or a clear error (used for a per-instance GUI origin). */
function requireEnvVar(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`env var ${name} is not set`);
  return v;
}

export interface RunnerDeps {
  rest: MidpointRest;
  cfg: Config;
  suite: Suite;
  now: () => number;
}

export interface RunOptions {
  /** Current-behaviour capture mode: capture expected files instead of asserting (by design). */
  captureExpected?: boolean;
}

export async function runScenario(
  loaded: LoadedScenario,
  deps: RunnerDeps,
  opts: RunOptions = {},
): Promise<void> {
  const { rest, cfg, suite } = deps;
  const { scenario, dir } = loaded;
  const hostDir = cfg.csv.hostDir;

  // Every focus object asserted anywhere in the flow — used for the upfront reset.
  const allObjects: ExpectedObject[] = [];
  for (const step of scenario.steps) {
    const a = handlerFor(step)?.assertions?.(step);
    if (a) allObjects.push(...(a.objects ?? []));
  }
  const userNames = allObjects.filter((o) => o.type === "user").map((o) => o.name);

  const state: { lastTaskOid?: string; captures?: Record<string, string[]> } = {};
  // Freeze "now" ONCE per scenario: every relative-time value (`now-P1D`, …) the
  // steps resolve via ctx.now() shares this single anchor, so timestamps seeded in
  // different steps stay in a fixed relation regardless of inter-step latency. E.g.
  // a `validTo: now-PT1M` seed and a `lastScanTimestamp: now-PT2M` rewind are then
  // EXACTLY one minute apart — not "about", so the scanner window reliably catches
  // the seed. (The debug dump below keeps live deps.now() for unique paths.)
  const scenarioNow = deps.now();
  // Cross-system dump is a DEBUG aid: only captured when enabled, so normal
  // failure output stays clean. Disabled -> null, which suppresses every dump
  // path (the error message's `cross-system dump:` line and the console link).
  const dump = (scenarioLabel: string, names: string[] = userNames): Promise<string | null> =>
    cfg.dumpOnFailure
      ? dumpCrossSystem(
          rest,
          { scenario: scenarioLabel, userNames: names, taskOid: state.lastTaskOid },
          cfg.dumpDir,
          String(deps.now()),
        )
      : Promise.resolve(null);

  // No implicit per-scenario reset: a scenario owns the data it mutates and starts
  // with its own idempotent pre-clean (see the README "Writing re-runnable
  // scenarios"). The harness never deletes objects a scenario merely asserts, nor
  // washes a shared system behind your back — state stays exactly what the steps say.

  // Resolve the version-specific page objects lazily — only when (and if) a UI
  // step actually launches the browser. Overrides are relative to the suite dir.
  // Resolve which system a GUI step drives (its `system:`, or the suite default)
  // into a GUI TARGET: origin + page objects. A midPoint instance → its version's
  // page objects at its (optionally distinct) GUI origin; a Keycloak system → the
  // login-only Keycloak page objects. So GUI version/kind follow the DRIVEN system
  // (a suite may run several at different majors), not one top-level `gui.version`.
  const resolveGuiTarget = (systemName?: string): GuiTarget => {
    const driven = drivenGuiSystem(suite, systemName);
    if (driven.kind === "midpoint") {
      const m = driven.midpoint;
      const baseUrl = m.guiBaseUrlEnv ? requireEnvVar(m.guiBaseUrlEnv) : cfg.gui.baseUrl;
      return {
        key: driven.name,
        baseUrl,
        loadPages: () => loadPageObjects({ version: m.version, overrides: m.overrides, auth: m.auth }, cfg.scenariosDir),
      };
    }
    return { key: driven.name, baseUrl: cfg.gui.baseUrl, loadPages: () => Promise.resolve(keycloakGuiPageObjects()) };
  };
  const ui = new UiDriver(cfg.gui.headless, cfg.gui.ignoreHttpsErrors, resolveGuiTarget, cfg.gui.loginTimeoutMs);
  const ctx: RunContext = {
    rest, cfg, suite,
    hostDir,
    scenarioDir: dir,
    scenarioId: scenario.id,
    captureExpected: !!opts.captureExpected,
    userNames,
    state,
    now: () => scenarioNow,
    dump,
    ui,
  };

  // 1. Run the preconditions (`setup`), then the behaviour (`steps`) — each step
  //    dispatched to its registered handler. On a failure, tag the error with the
  //    failing step's location in scenario.yaml (the reporter shows it in source);
  //    a setup failure points into the `setup:` block. The GUI browser (if any UI
  //    step launched it) is always closed afterwards.
  // Describe step `i` of a sequence (identity + scenario.yaml source span) for failure reports.
  const stepRef = (steps: Step[], lines: number[], i: number): StepRef | undefined => {
    const step = steps[i];
    const handler = step && handlerFor(step);
    if (!step || !handler) return undefined;
    const start = lines[i] ?? 0;
    const next = lines[i + 1] ?? 0;
    const kind = handler.token(step);
    return {
      index: i,
      count: steps.length,
      line: start,
      endLine: next > start ? next - 1 : start + 20,
      kind,
      // The listing detail can echo the kind (e.g. expect -> "expect"); drop it
      // then so the header reads "expect", not "expect — expect".
      detail: dropIfKind(plainDetail(handler.detail(step, { suite })), kind),
    };
  };

  // Run one sequence (setup or steps) in order. `phase` only labels the heartbeat.
  const runSequence = async (steps: Step[], lines: number[], phase: "setup" | "step"): Promise<void> => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const handler = handlerFor(step);
      if (!handler) throw new Error(`No handler for ${phase}: ${JSON.stringify(step)}`);
      // Heartbeat: a step that runs long (a recon wait, or an `expect` polling for
      // eventual consistency) is otherwise SILENT — indistinguishable from a hang.
      // Announce the in-progress step + elapsed on stderr every HEARTBEAT_MS, so a
      // stuck step names itself (and where it is in the flow). Fast steps never fire.
      // stderr keeps it out of the stdout summary / junit/ctrf reports. Unref'd so it
      // never holds the process open.
      const HEARTBEAT_MS = 15_000;
      const startedAt = Date.now();
      const ref = stepRef(steps, lines, i);
      const heartbeat = setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        const label = ref ? `${ref.kind}${ref.detail ? ` — ${ref.detail}` : ""}` : phase;
        process.stderr.write(`  … ${phase} ${i + 1}/${steps.length} still running after ${s}s: ${label}\n`);
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        await handler.run(step, ctx);
      } catch (err) {
        throw attachStepLocation(err, {
          scenarioId: scenario.id,
          file: loaded.file,
          step: stepRef(steps, lines, i)!,
          prev: i > 0 ? stepRef(steps, lines, i - 1) : undefined,
        });
      } finally {
        clearInterval(heartbeat);
      }
    }
  };

  let failed = false;
  try {
    await runSequence(scenario.setup ?? [], loaded.setupLines ?? [], "setup");
    await runSequence(scenario.steps, loaded.stepLines, "step");
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    // retain-on-failure: a failed scenario that drove the GUI saves its Playwright
    // trace(s) under reports/traces for diagnosis; a passing one discards them.
    await ui.close(failed ? { traceDir: join(cfg.reportsDir, "traces"), label: scenario.id } : undefined);
  }
}
