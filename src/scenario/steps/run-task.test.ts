/**
 * Unit: run-task handler — resolves a logical task name against suite.tasks and
 * runs that OID via the registered-task primitive. No running stack; the fake rest mimics a
 * recurring scanner (run-now advances lastRunStart, then the fresh run finishes).
 */
import { describe, it, expect } from "vitest";
import { runTaskStep } from "./run-task.ts";
import type { RunContext } from "./types.ts";

const NOW = Date.UTC(2026, 5, 6, 12, 0, 0); // 2026-06-06T12:00:00Z

function ctxWith(rest: Record<string, unknown>, suite: Record<string, unknown>): RunContext {
  return {
    rest,
    suite,
    cfg: { poll: { timeoutMs: 1000, intervalMs: 1 } },
    state: {},
    scenarioId: "t",
    now: () => NOW,
    dump: async () => null,
  } as unknown as RunContext;
}

/** A fake task that, after runTask(), reports a fresh finished run with `status`. */
function fakeRest(status: string) {
  let ran = false;
  const runs: string[] = [];
  const rest = {
    getTask: async () =>
      ran
        ? { executionState: "runnable", lastRunStartTimestamp: "2", lastRunFinishTimestamp: "2", resultStatus: status }
        : { executionState: "runnable", lastRunStartTimestamp: "1", lastRunFinishTimestamp: "1", resultStatus: status },
    runTask: async (oid: string) => { ran = true; runs.push(oid); },
    resumeTask: async (oid: string) => { ran = true; runs.push(oid); },
  };
  return { rest, runs };
}

/**
 * A fake task that, after runTask(), SUSPENDS on a fatal error — its fresh run
 * started (lastRunStart advanced 1→2) but its finish timestamp NEVER catches up
 * (stays "1"). Without the terminal-error arm in runRegisteredTask this would poll
 * until the timeout; with it, the step fails fast on the non-success result.
 */
function fakeSuspendedRest() {
  let ran = false;
  const rest = {
    getTask: async () =>
      ran
        ? { executionState: "suspended", lastRunStartTimestamp: "2", lastRunFinishTimestamp: "1", resultStatus: "fatal_error" }
        : { executionState: "runnable", lastRunStartTimestamp: "1", lastRunFinishTimestamp: "1", resultStatus: "success" },
    runTask: async () => { ran = true; },
    resumeTask: async () => { ran = true; },
  };
  return { rest };
}

describe("run-task handler", () => {
  it("runs the OID bound to the logical name and records it", async () => {
    const { rest, runs } = fakeRest("success");
    const ctx = ctxWith(rest, { tasks: { "validity-scan": "task-oid-9" } });
    await runTaskStep.run({ "run-task": "validity-scan" }, ctx);
    expect(runs).toEqual(["task-oid-9"]);
    expect(ctx.state.lastTaskOid).toBe("task-oid-9");
  });

  it("throws a helpful error when the logical name is not in suite.tasks", async () => {
    const { rest } = fakeRest("success");
    const ctx = ctxWith(rest, { tasks: { other: "x" } });
    await expect(runTaskStep.run({ "run-task": "validity-scan" }, ctx)).rejects.toThrow(
      /run-task "validity-scan" needs a registered task OID/,
    );
  });

  it("fails the step when the task run ends non-success", async () => {
    const { rest } = fakeRest("fatal_error");
    const ctx = ctxWith(rest, { tasks: { "validity-scan": "task-oid-9" } });
    await expect(runTaskStep.run({ "run-task": "validity-scan" }, ctx)).rejects.toThrow(
      /resultStatus=fatal_error/,
    );
  });

  it("accepts a partial_error result when acceptUpTo widens the ceiling", async () => {
    const { rest, runs } = fakeRest("partial_error");
    const ctx = ctxWith(rest, { tasks: { "expiry-scan": "task-oid-7" } });
    // Default would fail on partial_error; acceptUpTo:partial_error tolerates unrelated
    // object errors in a deployment-wide task.
    await runTaskStep.run({ "run-task": { task: "expiry-scan", acceptUpTo: "partial_error" } }, ctx);
    expect(runs).toEqual(["task-oid-7"]);
    expect(ctx.state.lastTaskOid).toBe("task-oid-7");
  });

  it("still fails on partial_error under the default (strict success) ceiling", async () => {
    const { rest } = fakeRest("partial_error");
    const ctx = ctxWith(rest, { tasks: { "expiry-scan": "task-oid-7" } });
    await expect(runTaskStep.run({ "run-task": { task: "expiry-scan" } }, ctx)).rejects.toThrow(
      /resultStatus=partial_error/,
    );
  });

  it("fails fast when the fresh run SUSPENDS on a fatal error (finish never advances)", async () => {
    const { rest } = fakeSuspendedRest();
    // A tight 30ms timeout: a poll that waited for finish>=start would time out here;
    // settling on the terminal `suspended` state must surface the result error instead.
    const ctx = ctxWith(rest, { tasks: { "validity-scan": "task-oid-9" } });
    (ctx.cfg as { poll: { timeoutMs: number; intervalMs: number } }).poll = { timeoutMs: 30, intervalMs: 1 };
    await expect(runTaskStep.run({ "run-task": "validity-scan" }, ctx)).rejects.toThrow(
      /resultStatus=fatal_error/,
    );
  });
});
