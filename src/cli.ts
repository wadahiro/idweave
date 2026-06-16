#!/usr/bin/env -S npx tsx
/**
 * CLI entry (the future `bin`). Dispatches subcommands to command modules in
 * src/cli/. Not re-exported from index.ts — importing the library never runs a
 * command. Installed as the `idw` bin (package.json) and run via tsx; consumers
 * point it at their own suite through env (a local `.env`, auto-loaded below).
 */
import { loadDotenv } from "./cli/dotenv.ts";
import { init } from "./cli/init.ts";
import { importConfig } from "./cli/importConfig.ts";
import { waitReady } from "./cli/waitReady.ts";
import { captureExpected } from "./cli/captureExpected.ts";
import { triage } from "./cli/triage.ts";
import { snapshotBuild, snapshotRestore, snapshotList } from "./cli/snapshot.ts";
import { listScenarios } from "./cli/listScenarios.ts";
import { listSteps } from "./cli/describeSteps.ts";
import { help } from "./cli/help.ts";
import { run } from "./cli/run.ts";

const COMMANDS: Record<string, (arg?: string) => Promise<void>> = {
  init: (arg) => init(arg),
  run: (arg) => run(arg),
  "import-config": (arg) => importConfig(arg),
  "wait-ready": () => waitReady(),
  "capture-expected": (arg) => captureExpected(arg),
  triage: (arg) => triage(arg),
  scenarios: (arg) => listScenarios(arg),
  steps: (arg) => listSteps(arg),
  "snapshot-build": async (arg) => snapshotBuild(arg),
  "snapshot-restore": async (arg) => snapshotRestore(arg),
  "snapshot-list": async () => snapshotList(),
  help: () => help(),
};

async function main(): Promise<void> {
  // A consuming project keeps its endpoint/creds in a local .env; load it before
  // any command reads config. Real env wins (see loadDotenv). `init` writes no
  // config itself, so it works in an empty dir with no .env present.
  loadDotenv();
  const [cmd, arg] = process.argv.slice(2);
  // No command, or an explicit help flag → the command index (exit 0: it's what was asked).
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    await COMMANDS.help!();
    return;
  }
  const run = COMMANDS[cmd];
  if (!run) {
    console.error(`Unknown command "${cmd}". Run \`idw help\` for the command index.`);
    process.exit(2);
  }
  await run(arg);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
