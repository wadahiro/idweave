/**
 * Step: a PRECONDITION that DERIVES a focus property from one of its own values —
 * read `source`, split-and-reformat each value (the shared `delimited` transform),
 * optionally splicing in a seeded relative date, and raw-write the result to
 * `target`. It exists for state the harness can't write literally because part of
 * the value was minted at run time.
 *
 * Typical use: the value is a `/`-delimited composite whose trailing field is a date
 * a scheduled task acts on when it passes (an expiry/validity scanner). To exercise
 * that task deterministically WITHOUT moving the clock, rewind the date in place —
 * read the live value, keep the leading fields, substitute a seeded date:
 *   delimited: { delimiter: "/", names: [a, b], format: "{a}/{b}:{time}" }
 *   time: now-P1D|yyyy-MM-dd
 * `{time}` resolves to the date; the named fields come from the split source.
 *
 * `raw` defaults to true: the seed must not recompute the effect itself — the
 * scanner/task under test is what acts. A setup mutation, not an assert.
 */
import { resolveTimeExpr } from "../../time.ts";
import { applyDelimited, type DelimitedTransform } from "../../verify/consistency.ts";
import { deriveFocus, type SetFocusType } from "../../actions/focus.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface DeriveFocusStep {
  "derive-focus": {
    /** Target type (default user). */
    type?: SetFocusType;
    /** Focus name to read from and write to. */
    name: string;
    /** Source property path to read the value(s) from (multi-value supported). */
    source: string;
    /** Target property path to REPLACE with the derived value(s). */
    target: string;
    /**
     * Split-and-format transform applied to each source value. `format` references
     * split fields by NAME (`{a}`, when `names` given) or 0-based INDEX (`{0}`),
     * plus the special `{time}` when `time` is set.
     */
    delimited: DelimitedTransform;
    /**
     * Optional relative-time expression (`now`, `now-P1D`, `now-P1D|yyyy-MM-dd`),
     * resolved against the injected clock and made available to `format` as `{time}`.
     */
    time?: string;
    /** Direct repository write — no recompute (default true). */
    raw?: boolean;
  };
}

export const deriveFocusStep: StepHandler<DeriveFocusStep> = {
  kind: "derive-focus",
  phase: "arrange",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["derive-focus"],
    description:
      "Precondition: derive a focus property from one of its own values (split-reformat + optional seeded date), raw-written.",
    properties: {
      "derive-focus": {
        type: "object",
        additionalProperties: false,
        required: ["name", "source", "target", "delimited"],
        properties: {
          type: {
            type: "string",
            enum: ["user", "role", "org", "service", "shadow"],
            description: "Target type (default user).",
          },
          name: { type: "string", description: "Focus name to read from and write to." },
          source: { type: "string", description: "Source property path to read value(s) from." },
          target: { type: "string", description: "Target property path to REPLACE with the derived value(s)." },
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
            description: "Relative-time expression resolved at run time and exposed to `format` as `{time}` (e.g. `now-P1D|yyyy-MM-dd`).",
          },
          raw: { type: "boolean", description: "Direct repository write, no recompute (default true)." },
        },
      },
    },
  },

  match(step): step is DeriveFocusStep {
    return typeof step === "object" && step !== null && "derive-focus" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["derive-focus"];
    const extra = s.time !== undefined ? { time: resolveTimeExpr(s.time, ctx.now()) } : undefined;
    await deriveFocus(
      ctx.rest,
      s.type ?? "user",
      s.name,
      s.source,
      s.target,
      (v) => applyDelimited(v, s.delimited, extra),
      { raw: s.raw ?? true },
    );
  },

  token() {
    return "derive-focus";
  },

  detail(step) {
    const s = step["derive-focus"];
    const time = s.time !== undefined ? ` time=${s.time}` : "";
    return `**derive-focus** \`${s.name}\` — ${s.source} → ${s.target} (\`${s.delimited.format}\`${time})${s.raw === false ? "" : " (raw)"}`;
  },
};
