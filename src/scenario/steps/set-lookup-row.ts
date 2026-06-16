/**
 * Step: a PRECONDITION that SETS a midPoint LookupTable row (key → value) — to
 * QUEUE a LookupTable-driven task. Some deployed operational tasks iterate the rows
 * of a LookupTable, each row keying a per-key input file and carrying a JSON status
 * (e.g. `{"status":"pending","executionMode":"disable"}`); a connected test seeds
 * that row so the task processes its input. Idempotent / re-runnable: replaces any
 * existing row for the key. The complement of `clear-lookup-row`.
 */
import { setLookupRow } from "../../actions/lookup.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface SetLookupRowStep {
  "set-lookup-row": {
    /** LookupTable OID holding the rows. */
    table: string;
    /** Row key (e.g. the per-run input-file key). */
    key: string;
    /** Row value (e.g. a JSON status string the task reads). */
    value: string;
  };
}

export const setLookupRowStep: StepHandler<SetLookupRowStep> = {
  kind: "set-lookup-row",
  phase: "arrange",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["set-lookup-row"],
    description: "Precondition: set a LookupTable row (key → value), e.g. to queue a LookupTable-driven task.",
    properties: {
      "set-lookup-row": {
        type: "object",
        additionalProperties: false,
        required: ["table", "key", "value"],
        properties: {
          table: { type: "string", description: "LookupTable OID holding the rows." },
          key: { type: "string", description: "Row key." },
          value: { type: "string", description: "Row value (e.g. a JSON status string)." },
        },
      },
    },
  },

  match(step): step is SetLookupRowStep {
    return typeof step === "object" && step !== null && "set-lookup-row" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["set-lookup-row"];
    await setLookupRow(ctx.rest, s.table, s.key, s.value);
  },

  token() {
    return "set-lookup-row";
  },

  detail(step) {
    const s = step["set-lookup-row"];
    return `**set-lookup-row** table \`${s.table}\` — \`${s.key}\` = \`${s.value}\``;
  },
};
