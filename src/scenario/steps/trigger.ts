/**
 * Step: trigger import or reconciliation for a system, and await completion.
 * Runs the DEPLOYED midPoint task bound to the system in `suite.triggers`
 * (recon/import) — the harness verifies your configured tasks, so there is no
 * generic one-shot fallback. Records the task oid in run state (dumps reference
 * it) and fails the scenario if the task does not close successfully.
 */
import { isResultAccepted, runRegisteredTask, type ResultCeiling } from "../../actions/tasks.ts";
import { suiteSystem, systemTriggerTask } from "../suite.ts";
import type { DescribeContext, RunContext, StepHandler } from "./types.ts";

interface TriggerStep {
  trigger: "import" | "recon";
  system?: string;
  /** Worst result status that still passes (default: success — partial/warning fail). */
  acceptUpTo?: ResultCeiling;
}

function systemName(ctx: DescribeContext, key?: string): string {
  if (key) return key;
  const keys = Object.keys(ctx.suite.systems ?? {});
  return keys.length === 1 ? keys[0]! : "(default)";
}

export const triggerStep: StepHandler<TriggerStep> = {
  kind: "trigger",
  phase: "act",
  appliesTo: ["csv", "ldap", "scim"],
  prefix: { param: "system", into: "sibling" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["trigger"],
    description: "Run the system's registered import or reconciliation task (suite.triggers).",
    properties: {
      trigger: { type: "string", enum: ["import", "recon"] },
      system: { type: "string", description: "System name; omit when the suite has a single system." },
      acceptUpTo: {
        type: "string",
        enum: ["success", "warning", "partial_error"],
        description: "Worst task result status that still passes (default: success). Set to partial_error when this scenario expects unrelated objects to error.",
      },
    },
  },

  match(step): step is TriggerStep {
    return typeof step === "object" && step !== null && "trigger" in step;
  },

  async run(step, ctx: RunContext) {
    const { name } = suiteSystem(ctx.suite, step.system);
    const { oid: taskOid, timeoutMs } = systemTriggerTask(ctx.suite, name, step.trigger);
    // A per-task timeout (e.g. a cold recon's headroom) overrides only this wait.
    const poll = timeoutMs ? { ...ctx.cfg.poll, timeoutMs } : ctx.cfg.poll;
    // Strict (default success/warning) scenarios fail the moment a running object
    // error appears; one that tolerates partial errors waits for the final status.
    const failFastOnError = (step.acceptUpTo ?? "success") !== "partial_error";
    const outcome = await runRegisteredTask(ctx.rest, taskOid, poll, step.trigger, { failFastOnError });
    ctx.state.lastTaskOid = outcome.oid;
    if (!isResultAccepted(outcome.resultStatus, step.acceptUpTo)) {
      const d = await ctx.dump(`${ctx.scenarioId}-${step.trigger}-task`).catch(() => null);
      throw new Error(
        `${step.trigger} task ${outcome.oid} closed with resultStatus=${outcome.resultStatus}` +
          ` (accepted up to "${step.acceptUpTo ?? "success"}")` +
          (d ? ` (dump: ${d})` : ""),
      );
    }
  },

  token(step) {
    return step.trigger;
  },

  detail(step, ctx) {
    return `**${step.trigger}** \`${systemName(ctx, step.system)}\``;
  },
};
