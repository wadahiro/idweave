/**
 * Step: CAPTURE a focus property's current value(s) into a named slot in run state,
 * for a later assert to use. It exists because a mutating task can DESTROY the value
 * that identifies an external row before we can assert that row's new state.
 *
 * Typical case: a `run-task` scheduled task REMOVES a run-minted reference from a
 * focus extension property (and updates its backing DB row). Afterwards nothing in
 * the focus points at the old row — the external table has no owner column, only a
 * random key. So we snapshot the reference value BEFORE the task runs, and a db
 * system with `linkFrom: { capture: <as> }` binds it as the `:id` of its SELECT to
 * assert the old row is now in its terminal state (while the existing focus-`linkFrom`
 * asserts the freshly minted reference still resolves to an active row).
 *
 * A read-only setup step (records state; mutates nothing). Throws if the focus is
 * absent. An empty property captures the empty set (a later assert can require it).
 */
import { readFocusProperty, type SetFocusType } from "../../actions/focus.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface CaptureFocusStep {
  "capture-focus": {
    /** Focus type to read (default user). */
    type?: SetFocusType;
    /** Focus name to read from. */
    name: string;
    /** Property path to capture the value(s) from (multi-value supported). */
    source: string;
    /** State slot name to store the captured value(s) under (referenced by `linkFrom.capture`). */
    as: string;
  };
}

export const captureFocusStep: StepHandler<CaptureFocusStep> = {
  kind: "capture-focus",
  phase: "arrange",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["capture-focus"],
    description: "Capture a focus property's current value(s) into a named slot, for a later assert to reference.",
    properties: {
      "capture-focus": {
        type: "object",
        additionalProperties: false,
        required: ["name", "source", "as"],
        properties: {
          type: {
            type: "string",
            enum: ["user", "role", "org", "service", "shadow"],
            description: "Focus type to read (default user).",
          },
          name: { type: "string", description: "Focus name to read from." },
          source: { type: "string", description: "Property path to capture value(s) from." },
          as: { type: "string", description: "State slot name to store under (referenced by a db `linkFrom.capture`)." },
        },
      },
    },
  },

  match(step): step is CaptureFocusStep {
    return typeof step === "object" && step !== null && "capture-focus" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["capture-focus"];
    const { values } = await readFocusProperty(ctx.rest, s.type ?? "user", s.name, s.source);
    (ctx.state.captures ??= {})[s.as] = values;
  },

  token() {
    return "capture-focus";
  },

  detail(step) {
    const s = step["capture-focus"];
    return `**capture-focus** \`${s.name}\` — ${s.source} → state \`${s.as}\``;
  },
};
