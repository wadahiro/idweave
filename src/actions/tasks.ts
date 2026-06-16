/**
 * actions — task domain actions.
 *
 * `awaitTaskClosed` is the single place asynchronous completion is waited on
 * (by design): scenarios and YAML never express waits. Everything polls.
 */
import type { MidpointRest, MidpointObject } from "../clients/midpointRest.ts";
import type { PollConfig } from "../config.ts";
import { pollUntil } from "../poll.ts";

export interface TaskOutcome {
  oid: string;
  executionState: string;
  resultStatus: string;
}

/**
 * The worst midPoint operation-result status a run may end with and still pass.
 * Ordered by ascending severity; `fatal_error` is never acceptable (it is the
 * terminal error the wait fails fast on), so it is not a ceiling option.
 */
export type ResultCeiling = "success" | "warning" | "partial_error";
const RESULT_ORDER: readonly string[] = ["success", "warning", "partial_error"];

/**
 * Whether a finished run's `resultStatus` is accepted under `ceiling` (default
 * strict `success`). A scenario that knows partial failures are expected (e.g. a
 * recon over many objects where unrelated ones error) widens this on the step;
 * the default keeps "all-success or fail". Anything off the severity scale —
 * `fatal_error`, `in_progress`, `unknown` — is never accepted.
 */
export function isResultAccepted(status: string, ceiling: ResultCeiling = "success"): boolean {
  const got = RESULT_ORDER.indexOf(status);
  return got !== -1 && got <= RESULT_ORDER.indexOf(ceiling);
}

function readState(task: MidpointObject | null): { executionState: string; resultStatus: string } {
  const t = (task ?? {}) as Record<string, unknown>;
  return {
    // `executionState` is the 4.4+ field name; midPoint 4.0 calls it
    // `executionStatus` (same values, e.g. "closed"/"suspended"). Read either.
    executionState: String(t["executionState"] ?? t["executionStatus"] ?? "unknown"),
    resultStatus: String(t["resultStatus"] ?? "unknown"),
  };
}

/** triggerImport: start an import-from-resource task; returns the task oid. */
export async function triggerImport(
  rest: MidpointRest,
  resourceOid: string,
  objectClass: string,
): Promise<string> {
  return rest.importFromResource(resourceOid, objectClass);
}

function lastRunStart(task: MidpointObject | null): string {
  return String((task as Record<string, unknown> | null)?.["lastRunStartTimestamp"] ?? "");
}
function lastRunFinish(task: MidpointObject | null): string {
  return String((task as Record<string, unknown> | null)?.["lastRunFinishTimestamp"] ?? "");
}

/**
 * Object failures the RUNNING task has already accumulated — the "errors" count
 * the GUI shows live in operation statistics (`operationStats.iterativeTaskInformation`).
 * Returns null when there are none. `operationStats.timestamp` is checked against
 * the current run's start so a previous run's stale failures (the counters reset
 * each run) don't trigger a false early-fail before the new run has updated them.
 */
function runningFailures(
  task: MidpointObject | null,
  runStart: string,
): { count: number; lastObject?: string; lastMessage?: string } | null {
  const stats = (task as Record<string, unknown> | null)?.["operationStats"] as Record<string, unknown> | undefined;
  const iti = stats?.["iterativeTaskInformation"] as Record<string, unknown> | undefined;
  const count = Number(iti?.["totalFailureCount"] ?? 0);
  if (!Number.isFinite(count) || count <= 0) return null;
  const statsAt = String(stats?.["timestamp"] ?? "");
  if (statsAt && runStart && statsAt < runStart) return null; // stale: belongs to the previous run
  return {
    count,
    lastObject: iti?.["lastFailureObjectName"] ? String(iti["lastFailureObjectName"]) : undefined,
    lastMessage: iti?.["lastFailureMessage"] ? String(iti["lastFailureMessage"]) : undefined,
  };
}

/**
 * runRegisteredTask: run a REGISTERED task (fixed OID, defined in post-init
 * config) now and await a fresh completion. Used for reconciliation (no one-shot
 * REST endpoint exists) and, when a source declares one, for import — so the
 * test exercises the DEPLOYED task object (its options/object class), not just
 * midPoint's generic /import endpoint.
 *
 * Run-now is racy: right after the command the task still shows the PREVIOUS
 * run, so we wait for `lastRunStartTimestamp` to advance AND that fresh run to
 * FINISH. A one-shot task then shows `closed`; a recurring SCHEDULED task (e.g. a
 * daily reconciliation) instead returns to `runnable` and never closes — so we
 * detect completion by the finish timestamp catching up to the new start, which
 * covers both.
 *
 * A registered task can auto-run at post-init boot and end up `suspended` (e.g. a
 * transient first-run error before the source files exist). Run-now is a no-op on
 * a suspended task, so we resume it — which runs it — instead.
 */
export interface RunTaskOptions {
  /**
   * Fail the moment the RUNNING task reports an object failure (what the GUI's
   * operation statistics show live), instead of waiting out a possibly-long run
   * to read the final status. Set by strict scenarios; a scenario that tolerates
   * partial errors (`acceptUpTo: partial_error`) leaves it off so per-object
   * failures are expected, not fatal.
   */
  failFastOnError?: boolean;
}

export async function runRegisteredTask(
  rest: MidpointRest,
  taskOid: string,
  poll: PollConfig,
  label = "task",
  opts: RunTaskOptions = {},
): Promise<TaskOutcome> {
  const task = await rest.getTask(taskOid, true);
  const before = lastRunStart(task);
  if (readState(task).executionState === "suspended") {
    await rest.resumeTask(taskOid);
  } else {
    await rest.runTask(taskOid);
  }
  const done = await pollUntil(
    () => rest.getTask(taskOid, true),
    (t) => {
      const startAdvanced = lastRunStart(t) !== before && lastRunStart(t) !== "";
      if (!startAdvanced) return false;
      // Strict scenarios need not wait out a long run: once the running statistics
      // already report an object failure, fail right here. Throwing from the `done`
      // predicate propagates out of pollUntil with a message naming the failure.
      if (opts.failFastOnError) {
        const f = runningFailures(t, lastRunStart(t));
        if (f) {
          throw new Error(
            `${label} task ${taskOid} reported ${f.count} object failure(s) while running` +
              (f.lastObject ? ` (last: ${f.lastObject}${f.lastMessage ? ` — ${f.lastMessage}` : ""})` : "") +
              ` — failing without waiting for completion`,
          );
        }
      }
      const { executionState, resultStatus } = readState(t);
      // Settle the wait once the fresh run is TERMINAL — either a clean finish
      // (one-shot closes; a recurring scheduled task stays runnable and its finish
      // timestamp catches up to (>=) the new start) OR a terminal error. A fatal
      // run SUSPENDS (or reports fatal_error) WITHOUT its finish timestamp catching
      // up, so without the error arms we'd block until the poll timeout instead of
      // failing fast — the caller then throws on the non-success resultStatus.
      return executionState === "closed"
        || executionState === "suspended"
        || resultStatus === "fatal_error"
        || lastRunFinish(t) >= lastRunStart(t);
    },
    poll,
    `${label} task ${taskOid} to complete a fresh run`,
  );
  return { oid: taskOid, ...readState(done) };
}

/**
 * Poll a task until its executionState is `closed`, then return its outcome.
 * Does NOT assert success — the caller (the verify step) decides what's expected.
 */
export async function awaitTaskClosed(
  rest: MidpointRest,
  taskOid: string,
  poll: PollConfig,
): Promise<TaskOutcome> {
  const task = await pollUntil(
    () => rest.getTask(taskOid, true),
    (t) => readState(t).executionState === "closed",
    poll,
    `task ${taskOid} to reach executionState=closed`,
  );
  const state = readState(task);
  return { oid: taskOid, ...state };
}
