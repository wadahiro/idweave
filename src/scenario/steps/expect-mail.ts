/**
 * Step: assert a notification midPoint sent, read back from the Mailpit sink via
 * its REST API. Matches the LATEST message to `to` (optionally narrowed by
 * `subject`) and asserts its normalized projection (from/to/cc/subject/text) —
 * or `absent: true` to assert none was sent. In capture mode, writes the expected
 * (current-behaviour capture). The Mailpit endpoint is env data (MAILPIT_URL), like the GUI.
 */
import { join } from "node:path";
import { loadExpected, assertMatchesExpected, compareToExpected } from "../../verify/expected.ts";
import { readMailProjection, evaluateMail, type MailProjection } from "../../verify/mailTarget.ts";
import { pollUntil, PollTimeoutError } from "../../poll.ts";
import type { RunContext, StepHandler } from "./types.ts";
import { expectedPath, captureExpectedFile } from "./expectedPath.ts";

interface ExpectMailStep {
  "expect-mail": {
    /** Recipient address to match (Mailpit `to:` search). */
    to: string;
    /** Optional subject substring to narrow the match. */
    subject?: string;
    /** Path to the captured expected projection (full exact pin). */
    expected?: string;
    /** Substrings the subject+body MUST contain (partial — for volatile-token mail). */
    contains?: string[];
    /** Regexes the subject+body MUST match. */
    matches?: string[];
    /** Assert NO matching message was sent. */
    absent?: boolean;
  };
}


export const expectMailStep: StepHandler<ExpectMailStep> = {
  kind: "expect-mail",
  phase: "assert",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect-mail"],
    description: "Assert a notification midPoint sent (read from the Mailpit sink).",
    properties: {
      "expect-mail": {
        type: "object",
        additionalProperties: false,
        required: ["to"],
        properties: {
          to: { type: "string", description: "Recipient address to match." },
          subject: { type: "string", description: "Optional subject substring to narrow the match." },
          expected: { type: "string", description: "Path to the captured expected projection (full exact pin)." },
          contains: {
            type: "array",
            items: { type: "string" },
            description: "Substrings the subject+body MUST contain (partial — for volatile-token mail).",
          },
          matches: {
            type: "array",
            items: { type: "string" },
            description: "Regexes the subject+body MUST match.",
          },
          absent: { type: "boolean", description: "Assert NO matching message was sent." },
        },
        anyOf: [
          { required: ["expected"] },
          { required: ["contains"] },
          { required: ["matches"] },
          { required: ["absent"] },
        ],
      },
    },
  },

  match(step): step is ExpectMailStep {
    return typeof step === "object" && step !== null && "expect-mail" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["expect-mail"];
    const label = s.subject ? `${s.to} / "${s.subject}"` : s.to;
    const read = () => readMailProjection(ctx.cfg.mail.url, s.to, s.subject);
    // A notification lands within seconds; wait the short MAIL timeout (not the
    // minutes-long general poll) so a mail that never comes fails fast.
    const mailPoll = { timeoutMs: ctx.cfg.mail.timeoutMs, intervalMs: ctx.cfg.poll.intervalMs };

    if (s.absent) {
      if (ctx.captureExpected) return;
      if ((await read()) !== null) throw new Error(`Expected NO mail to ${label}, but a matching message exists`);
      return;
    }

    // Partial assertion (contains/matches): for mail whose body carries a volatile
    // token, assert only the stable substrings/regexes. Capture still pins the full
    // projection (for review), so a `contains` scenario can also be captured.
    if (!s.expected && (s.contains || s.matches)) {
      if (ctx.captureExpected) return;
      const spec = { contains: s.contains, matches: s.matches };
      const projection = await pollUntil(
        read,
        (p) => p !== null && evaluateMail(p, spec).length === 0,
        mailPoll,
        `mail to ${label} to match contains/matches`,
      ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as MailProjection | null) : null));
      if (projection === null) throw new Error(`Expected mail to ${label} not found`);
      const failures = evaluateMail(projection, spec);
      if (failures.length) {
        throw new Error(`expect-mail to ${label} — ${failures.join("; ")}.\nBody: ${JSON.stringify(projection.text)}`);
      }
      return;
    }

    const expectedFile = expectedPath(ctx, s.expected!);
    // A notification is sent asynchronously, so poll until the message lands.
    if (ctx.captureExpected) {
      const m = await pollUntil(read, (v) => v !== null, mailPoll, `mail to ${label}`).catch(() => null);
      return void (await captureExpectedFile(ctx, expectedFile, m));
    }
    const expected = await loadExpected(expectedFile);
    const projection = await pollUntil(
      read,
      (p) => p !== null && compareToExpected(p, expected).match,
      mailPoll,
      `mail to ${label} to match expected`,
    ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as MailProjection | null) : null));
    if (projection === null) throw new Error(`Expected mail to ${label} not found`);
    await assertMatchesExpected(projection, expected, () => Promise.resolve(null));
  },

  token() {
    return "expect-mail";
  },

  detail(step) {
    const s = step["expect-mail"];
    const mode = s.absent
      ? "absent"
      : s.expected
        ? `expected \`${s.expected}\``
        : [s.contains?.length ? `contains ${s.contains.length}` : "", s.matches?.length ? `matches ${s.matches.length}` : ""]
            .filter(Boolean)
            .join(", ");
    return `**expect-mail** to \`${s.to}\`${s.subject ? ` / \`${s.subject}\`` : ""} — ${mode}`;
  },
};
