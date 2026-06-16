/**
 * Public API of the midPoint connected-test engine.
 *
 * Runner-independent. Consumers usually drive scenarios through the `run` CLI
 * (which uses `runSuite` + the reporters below); a thin vitest adapter
 * (examples/scenarios.test.ts) shows the alternative library wiring.
 */

// config
export * from "./config.ts";
export * from "./poll.ts";

// clients/ — protocol adapters
export * from "./clients/midpointRest.ts";
export * from "./clients/csvFile.ts";

// env/ — readiness
export * from "./env/readiness.ts";

// actions/ — domain operations
export * from "./actions/csvSource.ts";
export * from "./actions/tasks.ts";
export * from "./actions/cleanup.ts";
export * from "./actions/assign.ts";

// verify/ — read state + compare
export * from "./verify/normalize.ts";
export * from "./verify/expected.ts";
export * from "./verify/csvTarget.ts";
export * from "./verify/dump.ts";

// scenario/ — the engine (loader, suite, runner, step registry)
export * from "./scenario/loader.ts";
export * from "./scenario/suite.ts";
export * from "./scenario/runner.ts";
export * from "./scenario/failure.ts";

// runner — runSuite + reporters (the `run` CLI uses these; a consumer can too)
export * from "./scenario/runSuite.ts";
export * from "./report/junit.ts";
export * from "./report/ctrf.ts";

// util
export * from "./util/terminal.ts";
