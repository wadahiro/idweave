/**
 * Step: drive a project-defined custom journey (a `flows` entry in the suite's
 * gui.overrides) over a deployment-specific page — e.g. a deployment-specific app page
 * invitation form, or a Keycloak custom registration (profile + password). With
 * `open`, navigate there first (logged in as `as`, or anonymously); without it,
 * drive whatever page a preceding `open-mail-link` landed on. `with:` carries the
 * flow's input data; the SELECTORS live in the project flow (never in idweave or
 * the YAML). An INPUT step — the check still asserts the end-state via expect.
 */
import { guiPassword } from "../suite.ts";
import { readMailText } from "../../verify/mailTarget.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface UiFlowStep {
  "ui-flow": {
    /** Flow name to run (a key in the suite override's `flows`). */
    name: string;
    /** Open this URL first; required when logging in via `as`. */
    open?: string;
    /** Log in as this principal before opening (else anonymous / the current page). */
    as?: string;
    /** Input data passed to the flow (its `params`). */
    with?: Record<string, string>;
  };
}

export const uiFlowStep: StepHandler<UiFlowStep> = {
  kind: "ui-flow",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ui-flow"],
    description: "Drive a project custom flow (gui.overrides flows) over a deployment-specific page.",
    properties: {
      "ui-flow": {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", description: "Flow name (a key in the suite override's `flows`)." },
          open: { type: "string", description: "Open this URL first (required when using `as`)." },
          as: { type: "string", description: "Log in as this principal before opening (else anonymous / current page)." },
          with: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Input data passed to the flow.",
          },
        },
      },
    },
  },

  match(step): step is UiFlowStep {
    return typeof step === "object" && step !== null && "ui-flow" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["ui-flow"];
    if (s.open) {
      const auth = s.as ? { login: s.as, password: guiPassword(ctx.suite, s.as, ctx.cfg.gui.password) } : undefined;
      await ctx.ui.openUrl(s.open, auth);
    } else if (s.as) {
      throw new Error(`ui-flow "${s.name}": \`as\` requires \`open\` (login then navigate).`);
    }
    // A mail reader the flow can use to pull an emailed value (e.g. an activation
    // code it types) — idweave reads the mail; the project flow owns the pattern.
    // A notification lands within seconds; wait the short MAIL timeout (not the
    // minutes-long general poll) so an absent mail fails fast.
    const mailPoll = { timeoutMs: ctx.cfg.mail.timeoutMs, intervalMs: ctx.cfg.poll.intervalMs };
    const mail = {
      text: (opts: { to: string; subject?: string }) =>
        readMailText(ctx.cfg.mail.url, opts.to, opts.subject, mailPoll),
    };
    await ctx.ui.runFlow(s.name, s.with ?? {}, mail);
  },

  token() {
    return "ui-flow";
  },

  detail(step) {
    const s = step["ui-flow"];
    return `**ui-flow** \`${s.name}\`${s.as ? ` as \`${s.as}\`` : ""}${s.open ? ` → \`${s.open}\`` : ""}`;
  },
};
