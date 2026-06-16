/**
 * `idw help` — the command index. One-line purpose per command (commands change
 * rarely and have no schema, so their purposes live here, beside the dispatch table);
 * the STEP vocabulary, which DOES churn, is generated from the registry by `idw steps`.
 */

/** One-line purpose per command, in display order. Keep in sync with cli.ts COMMANDS. */
export const COMMAND_HELP: ReadonlyArray<[string, string]> = [
  ["init", "Scaffold a starter project (.env, suite.yaml, an example scenario)."],
  ["run", "Wait for readiness, run every scenario, write reports, exit non-zero on failure."],
  ["scenarios", "List the test cases (id / requirement / steps / asserts). Add `md` for Markdown."],
  ["steps", "List the step kinds a scenario may use (generated from the registry)."],
  ["capture-expected", "Record expected/*.json from the live end-state (then review)."],
  ["import-config", "Load midpoint-config/*.xml into midPoint via REST (no restart)."],
  ["wait-ready", "Poll until midPoint REST is up and the baseline exists."],
  ["triage", "Offline failure triage from reports/ctrf.json."],
  ["snapshot-build", "Snapshot the whole environment as a named baseline."],
  ["snapshot-restore", "Reset the whole environment to a baseline (idempotency)."],
  ["snapshot-list", "List baselines (name / created / size / volumes / binds)."],
  ["help", "Show this command index."],
];

/** Render the command index as aligned plain text. */
export function renderHelp(): string {
  const width = Math.max(...COMMAND_HELP.map(([c]) => c.length));
  const rows = COMMAND_HELP.map(([c, p]) => `  ${c.padEnd(width)}  ${p}`);
  return [
    "idweave (idw) — end-to-end test harness for midPoint deployments.",
    "",
    "Usage: idw <command> [path]",
    "",
    "Commands:",
    ...rows,
    "",
    "Every command auto-loads .env and takes an optional path to the scenarios dir.",
    "Run `idw steps` for the step vocabulary a scenario.yaml may use.",
  ].join("\n");
}

/** CLI: print the command index. */
export async function help(): Promise<void> {
  console.log(renderHelp());
}
