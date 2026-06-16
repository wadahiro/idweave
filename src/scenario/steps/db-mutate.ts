/**
 * Step: a PRECONDITION that REWINDS an external `db` system's state — the write-side
 * twin of asserting a db account. It runs the suite system's parameterized `update`
 * SQL once per `linkFrom` value of the focus named by `identifier`, binding `:value`
 * (here resolved as a relative-time expression — a new timestamp).
 *
 * Typical case: a scheduled task acts off a date stored in the mock's table (e.g.
 * `external_items.expires_at`). Rewinding it there (alongside the shadow identifier
 * and the focus reference, all to the SAME frozen instant) makes the external check
 * reflect a genuinely past/at-threshold row before the task runs:
 *   db-mutate: { system: db-mock, identifier: <user>, value: "now+P15D" }
 * with the suite system's `update` = `... SET expires_at = cast(:value as timestamptz)
 * WHERE item_key = split_part(:id,'/',2)`. A setup mutation, not an assert.
 */
import { resolveTimeExpr } from "../../time.ts";
import { dbMutate } from "../../actions/dbMutate.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface DbMutateStep {
  "db-mutate": {
    /** Name of the db system (in suite.systems) to mutate; it must declare `update`. */
    system: string;
    /** Focus name whose `linkFrom` value(s) bind `:id` (a plain system binds `:id` = this). */
    identifier: string;
    /**
     * Value bound as `:value`. A relative-time expression (`now`, `now+P15D`,
     * `now-P1D`, with an optional `|format`) is resolved against the injected clock;
     * any other literal passes through unchanged.
     */
    value: string;
  };
}

export const dbMutateStep: StepHandler<DbMutateStep> = {
  kind: "db-mutate",
  phase: "arrange",
  appliesTo: ["db"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["db-mutate"],
    description: "Precondition: rewind an external db system's state via its suite `update` SQL (`:id` from linkFrom, `:value` supplied).",
    properties: {
      "db-mutate": {
        type: "object",
        additionalProperties: false,
        required: ["system", "identifier", "value"],
        properties: {
          system: { type: "string", description: "db system name (must declare `update`)." },
          identifier: { type: "string", description: "Focus name whose linkFrom value(s) bind `:id`." },
          value: { type: "string", description: "Value bound as `:value`; a `now…` expression is resolved at run time." },
        },
      },
    },
  },

  match(step): step is DbMutateStep {
    return typeof step === "object" && step !== null && "db-mutate" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["db-mutate"];
    const system = ctx.suite.systems[s.system];
    if (!system) throw new Error(`db-mutate: system "${s.system}" is not in suite.systems`);
    if (!system.db) throw new Error(`db-mutate: system "${s.system}" is not a db system`);
    const value = resolveTimeExpr(s.value, ctx.now());
    await dbMutate(ctx.rest, system, s.identifier, value);
  },

  token() {
    return "db-mutate";
  },

  detail(step) {
    const s = step["db-mutate"];
    return `**db-mutate** \`${s.system}\` — ${s.identifier} := \`${s.value}\``;
  },
};
