/**
 * Step: run a GLOBAL registered midPoint task by its logical name and await a
 * fresh completion. Unlike `trigger` (per-system source recon/import), this runs a
 * deployment-wide operational/scanner task bound in `suite.tasks` — a validity
 * scan, trigger scan, or cleanup. It is the "scanner" half of time control: after
 * a `set-assignment`/`set-focus` seeds a past date (raw), this runs the task that
 * picks up the crossed threshold, so the scenario asserts the REAL effect of the
 * deployed task.
 *
 * Two forms:
 *  - `run-task: <key>` — just run the task.
 *  - `run-task: { task: <key>, rewind: <when> }` — for a WINDOWED scanner (e.g. the
 *    focus-validity-scanner, which only processes objects whose validity boundary
 *    fell in (lastScanTimestamp, now]): a back-dated `validTo` is BEFORE that window
 *    and would be missed. `rewind` parks the task (suspend), raw-sets its
 *    `extension/lastScanTimestamp` to `when` (a relative `now…` or literal dateTime,
 *    just before the seeded date), then runs it — so the window (when, now] catches
 *    the seed. Keep `when` close to the seed (e.g. validTo − 1m) so the window stays
 *    narrow; a far-past value (or clearing it) makes the scanner re-scan everything.
 *    Running resumes the parked task, so it self-restores to runnable.
 *
 * Like `trigger`, the task must be REGISTERED (no generic fallback) — the harness
 * verifies the tasks your deployment actually ships. A recurring scheduled scanner
 * never closes; runRegisteredTask detects completion by the fresh run finishing.
 */
import { resolveTimeExpr } from "../../time.ts";
import { isResultAccepted, runRegisteredTask, type ResultCeiling } from "../../actions/tasks.ts";
import { registeredTask } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface RunTaskStep {
  /** Logical task name (string form), or `{ task, rewind?, acceptUpTo? }`. */
  "run-task": string | { task: string; rewind?: string; acceptUpTo?: ResultCeiling };
}

function parts(step: RunTaskStep): { key: string; rewind?: string; acceptUpTo?: ResultCeiling } {
  const v = step["run-task"];
  return typeof v === "string" ? { key: v } : { key: v.task, rewind: v.rewind, acceptUpTo: v.acceptUpTo };
}

export const runTaskStep: StepHandler<RunTaskStep> = {
  kind: "run-task",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["run-task"],
    description: "Run a global registered midPoint task (suite.tasks) — e.g. a validity scan or cleanup — and await its fresh run.",
    properties: {
      "run-task": {
        oneOf: [
          { type: "string", description: "Logical task name bound to an OID in suite.tasks." },
          {
            type: "object",
            additionalProperties: false,
            required: ["task"],
            description: "Object form: optionally rewind a windowed scanner and/or widen the accepted result status.",
            properties: {
              task: { type: "string", description: "Logical task name bound to an OID in suite.tasks." },
              rewind: { type: "string", description: "Set the scanner's lastScanTimestamp to this (`now…` or ISO dateTime), just before the seeded date." },
              acceptUpTo: {
                type: "string",
                enum: ["success", "warning", "partial_error"],
                description: "Worst task result status that still passes (default: success). Set to partial_error for a deployment-wide task that processes unrelated objects which may error.",
              },
            },
          },
        ],
      },
    },
  },

  match(step): step is RunTaskStep {
    return typeof step === "object" && step !== null && "run-task" in step;
  },

  async run(step, ctx: RunContext) {
    const { key, rewind, acceptUpTo } = parts(step);
    const taskOid = registeredTask(ctx.suite, key);
    if (rewind !== undefined) {
      // Park the recurring scanner (suspend) so it can't auto-fire and reset
      // lastScanTimestamp while we rewind it, narrow its window onto the seeded date,
      // then RESUME it back to runnable. Resume alone does NOT run a scheduled task
      // now (only if overdue), so runRegisteredTask below run-now's it — which works
      // on a runnable task but is a no-op on a suspended one. The run restores normal
      // recurring operation.
      await ctx.rest.suspendTask(taskOid);
      await ctx.rest.modifyObject(
        "tasks",
        taskOid,
        [{ modificationType: "replace", path: "extension/lastScanTimestamp", value: resolveTimeExpr(rewind, ctx.now()) }],
        { raw: true },
      );
      await ctx.rest.resumeTask(taskOid);
    }
    // Strict (default success) fails fast on the first running object error; a
    // deployment-wide task that tolerates unrelated partial errors waits for the
    // final status instead (acceptUpTo: partial_error).
    const failFastOnError = (acceptUpTo ?? "success") !== "partial_error";
    const outcome = await runRegisteredTask(ctx.rest, taskOid, ctx.cfg.poll, key, { failFastOnError });
    ctx.state.lastTaskOid = outcome.oid;
    if (!isResultAccepted(outcome.resultStatus, acceptUpTo)) {
      const d = await ctx.dump(`${ctx.scenarioId}-${key}-task`).catch(() => null);
      throw new Error(
        `run-task "${key}" (${outcome.oid}) closed with resultStatus=${outcome.resultStatus}` +
          ` (accepted up to "${acceptUpTo ?? "success"}")` +
          (d ? ` (dump: ${d})` : ""),
      );
    }
  },

  token(step) {
    return `run-task:${parts(step).key}`;
  },

  detail(step) {
    const { key, rewind } = parts(step);
    return `**run-task** \`${key}\`${rewind ? ` (rewind lastScanTimestamp→${rewind})` : ""}`;
  },
};
