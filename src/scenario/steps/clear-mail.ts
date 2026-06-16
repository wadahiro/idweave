/**
 * Step: a PRECONDITION that clears captured mail from the Mailpit sink — to make a
 * NEGATIVE notification assertion ("no mail was sent") re-runnable.
 *
 * The sink accumulates across runs, so a later `expect-mail … absent: true` would
 * trip over a prior run's message to the same recipient. Clearing that recipient's
 * mail right before the action under test ensures any matching message afterwards
 * came from THIS run. Surgical by `to` (leaves other scenarios' mail alone); omit
 * `to` to reset the whole sink. Idempotent (clearing an empty match is a no-op).
 */
import { clearMail } from "../../actions/mail.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ClearMailStep {
  "clear-mail": {
    /** Recipient whose mail to delete; omit to clear the whole sink. */
    to?: string;
  };
}

export const clearMailStep: StepHandler<ClearMailStep> = {
  kind: "clear-mail",
  phase: "reset",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["clear-mail"],
    description: "Precondition: clear captured Mailpit mail (by recipient, or all) so a later absent assertion is re-runnable.",
    properties: {
      "clear-mail": {
        type: "object",
        additionalProperties: false,
        properties: {
          to: { type: "string", description: "Recipient whose mail to delete; omit to clear the whole sink." },
        },
      },
    },
  },

  match(step): step is ClearMailStep {
    return typeof step === "object" && step !== null && "clear-mail" in step;
  },

  async run(step, ctx: RunContext) {
    await clearMail(ctx.cfg.mail.url, step["clear-mail"].to);
  },

  token() {
    return "clear-mail";
  },

  detail(step) {
    const to = step["clear-mail"].to;
    return `**clear-mail** ${to ? `to \`${to}\`` : "(all)"}`;
  },
};
