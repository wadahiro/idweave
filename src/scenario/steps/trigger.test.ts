/**
 * Unit: trigger handler — runs the system's registered recon/import task and
 * gates pass/fail on the run's result status. No running stack; the fake rest mimics a
 * recurring task whose fresh run finishes with a given resultStatus. Covers the
 * per-step `acceptUpTo` ceiling (a scenario that expects partial failures widens
 * the default strict-success gate).
 */
import { describe, it, expect } from "vitest";
import { triggerStep } from "./trigger.ts";
import { isResultAccepted } from "../../actions/tasks.ts";
import type { RunContext } from "./types.ts";

/** A fake task that, after runTask(), reports a fresh FINISHED run with `status`. */
function ctxWith(status: string, acceptUpTo?: "success" | "warning" | "partial_error"): {
  ctx: RunContext;
  step: Record<string, unknown>;
} {
  let ran = false;
  const rest = {
    getTask: async () =>
      ran
        ? { executionState: "runnable", lastRunStartTimestamp: "2", lastRunFinishTimestamp: "2", resultStatus: status }
        : { executionState: "runnable", lastRunStartTimestamp: "1", lastRunFinishTimestamp: "1", resultStatus: "success" },
    runTask: async () => { ran = true; },
    resumeTask: async () => { ran = true; },
  };
  const ctx = {
    rest,
    suite: { systems: { csv1: { csv: { fileName: "x", columns: ["id"], idColumn: "id" } } }, triggers: { csv1: { recon: "task-1" } } },
    cfg: { poll: { timeoutMs: 1000, intervalMs: 1 } },
    state: {},
    scenarioId: "t",
    now: () => 0,
    dump: async () => null,
  } as unknown as RunContext;
  const step: Record<string, unknown> = { trigger: "recon", system: "csv1" };
  if (acceptUpTo) step.acceptUpTo = acceptUpTo;
  return { ctx, step };
}

/**
 * A fake task that, after runTask(), is STILL RUNNING (finish never catches up to
 * the new start) but whose live operation statistics already report `failures`
 * object errors — the case where a strict scenario should fail without waiting.
 */
function ctxStillRunningWithFailures(failures: number, acceptUpTo?: "success" | "warning" | "partial_error") {
  let ran = false;
  const rest = {
    getTask: async () =>
      ran
        ? {
            executionState: "runnable",
            lastRunStartTimestamp: "2",
            lastRunFinishTimestamp: "1", // run still in flight — finish < start
            resultStatus: "in_progress",
            operationStats: {
              timestamp: "3", // fresh: >= the new run start "2"
              iterativeTaskInformation: {
                totalSuccessCount: 5,
                totalFailureCount: failures,
                lastFailureObjectName: "CN=bad,OU=Users",
                lastFailureMessage: "no required attribute",
              },
            },
          }
        : { executionState: "runnable", lastRunStartTimestamp: "1", lastRunFinishTimestamp: "1", resultStatus: "success" },
    runTask: async () => { ran = true; },
    resumeTask: async () => { ran = true; },
  };
  const ctx = {
    rest,
    suite: { systems: { csv1: { csv: { fileName: "x", columns: ["id"], idColumn: "id" } } }, triggers: { csv1: { recon: "task-1" } } },
    cfg: { poll: { timeoutMs: 50, intervalMs: 1 } }, // tight: a wait-for-finish would time out here
    state: {},
    scenarioId: "t",
    now: () => 0,
    dump: async () => null,
  } as unknown as RunContext;
  const step: Record<string, unknown> = { trigger: "recon", system: "csv1" };
  if (acceptUpTo) step.acceptUpTo = acceptUpTo;
  return { ctx, step };
}

describe("isResultAccepted", () => {
  it("default ceiling is strict success", () => {
    expect(isResultAccepted("success")).toBe(true);
    expect(isResultAccepted("warning")).toBe(false);
    expect(isResultAccepted("partial_error")).toBe(false);
    expect(isResultAccepted("fatal_error")).toBe(false);
  });
  it("a wider ceiling accepts up to that severity but never fatal/unknown", () => {
    expect(isResultAccepted("partial_error", "partial_error")).toBe(true);
    expect(isResultAccepted("warning", "partial_error")).toBe(true);
    expect(isResultAccepted("fatal_error", "partial_error")).toBe(false);
    expect(isResultAccepted("unknown", "partial_error")).toBe(false);
  });
});

describe("trigger handler", () => {
  it("passes when the recon run finishes success", async () => {
    const { ctx, step } = ctxWith("success");
    await expect(triggerStep.run(step as never, ctx)).resolves.toBeUndefined();
  });

  it("fails on partial_error by default", async () => {
    const { ctx, step } = ctxWith("partial_error");
    await expect(triggerStep.run(step as never, ctx)).rejects.toThrow(/resultStatus=partial_error/);
  });

  it("tolerates partial_error when acceptUpTo: partial_error", async () => {
    const { ctx, step } = ctxWith("partial_error", "partial_error");
    await expect(triggerStep.run(step as never, ctx)).resolves.toBeUndefined();
  });

  it("fails fast on a running object error (strict) without waiting for completion", async () => {
    const { ctx, step } = ctxStillRunningWithFailures(1);
    await expect(triggerStep.run(step as never, ctx)).rejects.toThrow(
      /1 object failure\(s\) while running.*CN=bad/,
    );
  });

  it("does NOT fail fast on running errors when acceptUpTo: partial_error (waits for the final status)", async () => {
    // Tolerant scenario: per-object failures are expected, so the running-error
    // bail is off. The run never finishes here, so it times out rather than
    // fast-failing — proving the early-fail was skipped.
    const { ctx, step } = ctxStillRunningWithFailures(1, "partial_error");
    await expect(triggerStep.run(step as never, ctx)).rejects.toThrow(/to complete a fresh run/);
  });
});
