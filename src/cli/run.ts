/**
 * CLI command: run the connected scenarios (the consumer's primary entry).
 *
 * Discovers scenarios under SCENARIOS_DIR (or the given dir), runs them against
 * the configured midPoint, prints developer-facing failures, and writes the
 * junit.xml + ctrf.json artifacts — no test-runner wiring required in the
 * consuming project. Exits non-zero if any scenario failed (reports still write).
 */
import { join } from "node:path";
import pc from "picocolors";
import { loadConfig } from "../config.ts";
import { runSuite } from "../scenario/runSuite.ts";
import { writeJUnit } from "../report/junit.ts";
import { writeCtrf } from "../report/ctrf.ts";

export async function run(scenariosDirArg?: string): Promise<void> {
  const cfg = loadConfig();
  // Idempotency reset across runs is NOT wired here — it is a standalone, manual
  // dev tool (the snapshot CLI), deliberately decoupled from the scenario run so a
  // slow whole-env restore never inflates a run. Re-runnability comes from each
  // scenario's surgical reset, or from a manual `snapshot-restore` between runs.
  const result = await runSuite(cfg, scenariosDirArg ?? cfg.scenariosDir);

  await writeJUnit(result, join(cfg.reportsDir, "junit.xml"));
  await writeCtrf(result, join(cfg.reportsDir, "ctrf.json"));

  const { total, passed, failed, skipped } = result.summary;
  const line =
    `${passed}/${total} passed` +
    (failed ? `, ${failed} failed` : "") +
    (skipped ? `, ${skipped} skipped` : "");
  console.error(`\n${failed ? pc.red(line) : pc.green(line)} — reports in ${cfg.reportsDir}/`);
  if (failed > 0) process.exitCode = 1;
}
