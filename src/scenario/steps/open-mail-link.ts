/**
 * Step: open the actionable URL inside a received notification in the browser —
 * the bridge for an email-driven journey (an invitation link a new user follows
 * to self-register, or an approval link an approver follows to the work item).
 * Finds the latest message to `to` (optionally narrowed by `subject`), extracts a
 * URL (the first http(s) link, or one matched by the `link` regex), and navigates
 * to it: anonymously, or — with `as` — in that principal's logged-in session.
 * An INPUT step (it drives state, like request-ui); the check still asserts the
 * end-state via expect/expect-mail afterwards.
 */
import { readMailMessage, extractMailLink } from "../../verify/mailTarget.ts";
import { guiPassword } from "../suite.ts";
import { pollUntil, PollTimeoutError } from "../../poll.ts";
import type { MailMessage } from "../../clients/mailpit.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface OpenMailLinkStep {
  "open-mail-link": {
    /** Recipient address of the message whose link to open. */
    to: string;
    /** Optional subject substring to narrow the match. */
    subject?: string;
    /** Regex picking the URL (capture group 1, else whole match); default first http(s) link. */
    link?: string;
    /** Open as this logged-in principal (e.g. the approver); omit for an anonymous page. */
    as?: string;
  };
}

export const openMailLinkStep: StepHandler<OpenMailLinkStep> = {
  kind: "open-mail-link",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["open-mail-link"],
    description: "Open the link in a received notification in the browser (email-driven journey).",
    properties: {
      "open-mail-link": {
        type: "object",
        additionalProperties: false,
        required: ["to"],
        properties: {
          to: { type: "string", description: "Recipient address of the message whose link to open." },
          subject: { type: "string", description: "Optional subject substring to narrow the match." },
          link: { type: "string", description: "Regex picking the URL (group 1 or whole match); default first http(s) link." },
          as: { type: "string", description: "Open in this principal's logged-in session; omit for anonymous." },
        },
      },
    },
  },

  match(step): step is OpenMailLinkStep {
    return typeof step === "object" && step !== null && "open-mail-link" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["open-mail-link"];
    const label = s.subject ? `${s.to} / "${s.subject}"` : s.to;

    // The notification is sent asynchronously — poll until it lands.
    const msg = await pollUntil(
      () => readMailMessage(ctx.cfg.mail.url, s.to, s.subject),
      (m) => m !== null,
      ctx.cfg.poll,
      `mail to ${label}`,
    ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as MailMessage | null) : null));
    if (!msg) throw new Error(`open-mail-link: no mail to ${label}`);

    const url = extractMailLink({ text: msg.Text, html: msg.HTML }, s.link);
    if (!url) throw new Error(`open-mail-link: no link in mail to ${label}${s.link ? ` matching /${s.link}/` : ""}`);

    const auth = s.as ? { login: s.as, password: guiPassword(ctx.suite, s.as, ctx.cfg.gui.password) } : undefined;
    await ctx.ui.openUrl(url, auth);
  },

  token() {
    return "open-mail-link";
  },

  detail(step) {
    const s = step["open-mail-link"];
    return `**open-mail-link** to \`${s.to}\`${s.as ? ` as \`${s.as}\`` : " (anonymous)"}`;
  },
};
