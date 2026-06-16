/**
 * Runner adapter (thin) — this repo's self-test entry.
 *
 * Lives with the example suite it runs: discovers the YAML scenarios under
 * SCENARIOS_DIR (this repo's examples) and turns each into exactly one vitest
 * test (1 scenario = 1 test). The engine (`src/`) holds all the
 * logic; this file only binds it to vitest. A consumer of the published tool
 * either copies this wiring or uses the CLI. JUnit is from vitest (`make test`
 * passes `--reporter=junit`); CTRF is derived from it via scripts/junit-to-ctrf.ts.
 */
import { describe, test, beforeAll } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { MidpointRest } from "../../src/clients/midpointRest.ts";
import { awaitMidpointReady, awaitBaseline } from "../../src/env/readiness.ts";
import { loadScenarios } from "../../src/scenario/loader.ts";
import { loadSuite } from "../../src/scenario/suite.ts";
import { runScenario } from "../../src/scenario/runner.ts";
import { reportFailure } from "../../src/scenario/failure.ts";

const cfg = loadConfig();
const rest = new MidpointRest(cfg.midpoint);

// Load the suite manifest + discover/validate scenarios at collection time.
const suite = await loadSuite(cfg.scenariosDir);
const scenarios = await loadScenarios(cfg.scenariosDir);

beforeAll(async () => {
  await awaitMidpointReady(rest, cfg.poll);
  // Wait for the deployment config to be present (post-init at startup, or the
  // REST CLI) before exercising it.
  await awaitBaseline(
    rest,
    cfg.poll,
    Object.values(suite.triggers ?? {}).flatMap((t) =>
      [t.recon, t.import].filter((oid): oid is string => !!oid).map((oid) => ({ type: "tasks", oid })),
    ),
  );
});

describe("connected scenarios", () => {
  for (const loaded of scenarios) {
    const { id, requirement } = loaded.scenario;
    test(`${id} [${requirement}]`, async () => {
      try {
        await runScenario(loaded, { rest, cfg, suite, now: () => Date.now() });
      } catch (err) {
        // Console-only diagnostics (the error message stays plain so JUnit/CTRF
        // stay escape-free): point at the failing step in scenario.yaml — with a
        // clickable line link and a source excerpt — then, for an expectation
        // mismatch, a git-style colored expected/actual diff and the dump link.
        reportFailure(err);
        throw err;
      }
    });
  }
});
