/**
 * Step: a PRECONDITION that DERIVES a shadow's identifier/attribute from its own
 * value — the shadow-side twin of `derive-focus`. Locate the OWNER's shadow on a
 * named RESOURCE, read `source`, split-and-reformat each value (the shared
 * `delimited` transform, optionally splicing a seeded relative date), and raw-write
 * the result to each of `targets`.
 *
 * The shadow is found by owner+resource because a provisioned shadow's name is
 * minted at run time (it can't be named literally). Typical use: a date a scheduled
 * task acts on is frozen at provisioning time into the shadow's identifier, and a
 * STRONG inbound copies it to the focus. To simulate "near/at the threshold" without
 * moving the clock, rewind that date at its SOURCE — the shadow — writing the new
 * value to BOTH identifier paths so the task reads a consistent value, the inbound
 * doesn't revert the focus on recompute, and any connector decision that reads the
 * stored date is faithful:
 *   source: attributes/extId
 *   targets: [primaryIdentifierValue, attributes/extId]
 *   delimited: { delimiter: "/", names: [a, b, c], format: "{a}/{b}/{c}/{time}" }
 *   time: now+P15D|yyyyMMddHHmmss   # before the threshold, or now-P1D once past it
 *
 * `raw` defaults to true (the rewind must not recompute the effect itself; the
 * task under test is what acts). A setup mutation, not an assert. The focus
 * and DB layers are rewound to the SAME instant by `derive-focus` and `db-mutate`.
 */
import { resolveTimeExpr } from "../../time.ts";
import { applyDelimited, type DelimitedTransform } from "../../verify/consistency.ts";
import { deriveShadow } from "../../actions/projection.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface DeriveShadowStep {
  "derive-shadow": {
    /** Focus name owning the shadow (its linkRef leads to the shadow). */
    owner: string;
    /** Resource NAME the shadow lives on (picks which of the owner's shadows to rewind). */
    resource: string;
    /** Source path on the shadow to read the value(s) from (e.g. `attributes/extId`). */
    source: string;
    /** Shadow path(s) to REPLACE with the derived value (e.g. `primaryIdentifierValue`, `attributes/extId`). */
    targets: string[];
    /**
     * Split-and-format transform applied to each source value. `format` references
     * split fields by NAME (`{a}`, when `names` given) or 0-based INDEX (`{0}`),
     * plus the special `{time}` when `time` is set.
     */
    delimited: DelimitedTransform;
    /**
     * Optional relative-time expression (`now`, `now+P15D|yyyyMMddHHmmss`), resolved
     * against the injected clock and made available to `format` as `{time}`.
     */
    time?: string;
    /** Direct repository write — no recompute (default true). */
    raw?: boolean;
  };
}

export const deriveShadowStep: StepHandler<DeriveShadowStep> = {
  kind: "derive-shadow",
  phase: "arrange",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["derive-shadow"],
    description:
      "Precondition: derive a shadow's identifier/attribute from its own value (split-reformat + optional seeded date), raw-written to one or more paths.",
    properties: {
      "derive-shadow": {
        type: "object",
        additionalProperties: false,
        required: ["owner", "resource", "source", "targets", "delimited"],
        properties: {
          owner: { type: "string", description: "Focus name owning the shadow." },
          resource: { type: "string", description: "Resource NAME the shadow lives on." },
          source: { type: "string", description: "Source path on the shadow to read value(s) from." },
          targets: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Shadow path(s) to REPLACE with the derived value.",
          },
          delimited: {
            type: "object",
            additionalProperties: false,
            required: ["delimiter", "format"],
            description: "Split-and-format transform; `format` may reference `{name}`/`{index}` fields and `{time}`.",
            properties: {
              delimiter: { type: "string", description: "Field delimiter to split each source value on." },
              names: {
                type: "array",
                items: { type: "string" },
                description: "Field names for `{name}` references (else use `{0}`/`{1}` indices).",
              },
              format: { type: "string", description: "Output template; `{field}` and `{time}` substitutions, literals pass through." },
            },
          },
          time: {
            type: "string",
            description: "Relative-time expression resolved at run time and exposed to `format` as `{time}` (e.g. `now+P15D|yyyyMMddHHmmss`).",
          },
          raw: { type: "boolean", description: "Direct repository write, no recompute (default true)." },
        },
      },
    },
  },

  match(step): step is DeriveShadowStep {
    return typeof step === "object" && step !== null && "derive-shadow" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["derive-shadow"];
    const extra = s.time !== undefined ? { time: resolveTimeExpr(s.time, ctx.now()) } : undefined;
    await deriveShadow(
      ctx.rest,
      s.owner,
      s.resource,
      s.source,
      s.targets,
      (v) => applyDelimited(v, s.delimited, extra),
      { raw: s.raw ?? true },
    );
  },

  token() {
    return "derive-shadow";
  },

  detail(step) {
    const s = step["derive-shadow"];
    const time = s.time !== undefined ? ` time=${s.time}` : "";
    return `**derive-shadow** \`${s.owner}\` @ \`${s.resource}\` — ${s.source} → [${s.targets.join(", ")}] (\`${s.delimited.format}\`${time})${s.raw === false ? "" : " (raw)"}`;
  },
};
