/**
 * Step: a PRECONDITION that clears a midPoint LookupTable row by key — to RESET a
 * task's per-day progress checkpoint so a re-driven task reprocesses the test
 * subject instead of skipping it as "already done today".
 *
 * Some deployed tasks record "last processed object + date" in a LookupTable row
 * keyed by the task OID, and on a same-day re-run resume past it. A connected test
 * that runs such a task (e.g. an expiry/scanner task) needs the freshly-created
 * subject processed, so it clears that checkpoint row before `run-task`. Idempotent
 * (clearing an absent key is a no-op), so a re-run stays repeatable.
 */
import { clearLookupRow } from "../../actions/lookup.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ClearLookupRowStep {
  "clear-lookup-row": {
    /** LookupTable OID holding the rows. */
    table: string;
    /** Row key to delete (e.g. the task OID whose progress checkpoint to reset). */
    key: string;
  };
}

export const clearLookupRowStep: StepHandler<ClearLookupRowStep> = {
  kind: "clear-lookup-row",
  phase: "reset",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["clear-lookup-row"],
    description: "Precondition: delete a LookupTable row by key (reset a task's per-day progress checkpoint).",
    properties: {
      "clear-lookup-row": {
        type: "object",
        additionalProperties: false,
        required: ["table", "key"],
        properties: {
          table: { type: "string", description: "LookupTable OID holding the rows." },
          key: { type: "string", description: "Row key to delete (e.g. the task OID whose checkpoint to reset)." },
        },
      },
    },
  },

  match(step): step is ClearLookupRowStep {
    return typeof step === "object" && step !== null && "clear-lookup-row" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["clear-lookup-row"];
    await clearLookupRow(ctx.rest, s.table, s.key);
  },

  token() {
    return "clear-lookup-row";
  },

  detail(step) {
    const s = step["clear-lookup-row"];
    return `**clear-lookup-row** table \`${s.table}\` — key \`${s.key}\``;
  },
};
