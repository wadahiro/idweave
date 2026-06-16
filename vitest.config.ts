import { defineConfig } from "vitest/config";

/**
 * Two lanes share this config (selected by the path passed on the CLI):
 *  - UNIT  (`vitest run src/`)      — registry/handlers/schema, no running stack, fast.
 *  - CONNECTED (`vitest run examples/`) — 1 scenario = 1 test, needs the stack up.
 *
 * Connected scenarios touch a SHARED running deployment, so test files must not run in
 * parallel (`fileParallelism: false`); a single GUI scenario can take ~40s, and
 * the readiness `beforeAll` can wait minutes, hence the generous timeouts.
 * JUnit + its output file are passed per-run by the Makefile (`--reporter=junit
 * --outputFile=...`); CTRF is derived from that JUnit via scripts/junit-to-ctrf.ts.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "examples/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
