/**
 * verify — mail (Mailpit) projection check.
 *
 * Read the REAL message midPoint sent (from the Mailpit sink) and return a
 * stable record the expected asserts — addresses, subject, body — dropping the
 * volatile envelope (message id, date, size). So the expected pins WHAT midPoint
 * notified, not when/how it was framed.
 */
import { Mailpit, type MailAddress, type MailMessage } from "../clients/mailpit.ts";
import { pollUntil, PollTimeoutError } from "../poll.ts";
import type { PollConfig } from "../config.ts";

/** A normalized, assertable view of a message. */
export interface MailProjection {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
}

/** Format one address as `Name <addr>` (when it carries a display name) or just `addr`. */
function formatAddress(a: MailAddress | null | undefined): string {
  if (!a) return "";
  return a.Name ? `${a.Name} <${a.Address}>` : a.Address;
}
/** Format an address list, sorted so recipient order is irrelevant. */
function addresses(list: MailAddress[] | null | undefined): string[] {
  return (list ?? []).map(formatAddress).sort();
}

/**
 * Project a full message into the stable assertion record: from + every recipient
 * list (to/cc/bcc, each sorted so order is irrelevant, with display names kept),
 * subject, and the plain-text body with CRLF normalized to LF and trailing blank
 * lines trimmed. The message id, date and size are dropped as volatile. cc/bcc are
 * omitted when empty so the expected only pins what was actually addressed.
 */
export function projectMail(msg: MailMessage): MailProjection {
  const out: MailProjection = {
    from: formatAddress(msg.From),
    to: addresses(msg.To),
    subject: msg.Subject ?? "",
    text: (msg.Text ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, ""),
  };
  const cc = addresses(msg.Cc);
  if (cc.length) out.cc = cc;
  const bcc = addresses(msg.Bcc);
  if (bcc.length) out.bcc = bcc;
  return out;
}

/** Mailpit search query for the latest message to `to` (optionally filtered by subject). */
export function mailQuery(to: string, subject?: string): string {
  // `subject:` matches a substring; quote it so spaces stay one term.
  return subject ? `to:${to} subject:"${subject}"` : `to:${to}`;
}

/**
 * Partial assertion over a projection's subject+body — for notifications whose
 * body carries a volatile token/URL, so an exact `expected` would be brittle.
 * `contains` are substrings that MUST appear; `matches` are regexes that MUST
 * match. Returns human-readable failure lines (empty ⇒ pass). IO-free.
 */
export function evaluateMail(
  projection: MailProjection,
  spec: { contains?: string[]; matches?: string[] },
): string[] {
  const body = `${projection.subject}\n${projection.text}`;
  const failures: string[] = [];
  for (const s of spec.contains ?? []) {
    if (!body.includes(s)) failures.push(`body must contain: ${JSON.stringify(s)}`);
  }
  for (const re of spec.matches ?? []) {
    if (!new RegExp(re).test(body)) failures.push(`body must match /${re}/`);
  }
  return failures;
}

/**
 * Extract an actionable URL from a message body (the invitation/approval link).
 * With `pattern` (a regex), returns capture group 1 if present else the whole
 * match; without it, the first http(s) URL. Searches the plain text then the
 * HTML (so an HTML-only link is still found). Null if none.
 */
export function extractMailLink(body: { text: string; html: string }, pattern?: string): string | null {
  const hay = `${body.text}\n${body.html}`;
  if (pattern) {
    const m = new RegExp(pattern).exec(hay);
    return m ? (m[1] ?? m[0]) : null;
  }
  const m = /https?:\/\/[^\s"'<>)]+/.exec(hay);
  return m ? m[0] : null;
}

/** Read the latest RAW message matching `to` (+ optional subject), for link extraction. */
export async function readMailMessage(
  baseUrl: string,
  to: string,
  subject?: string,
): Promise<MailMessage | null> {
  const mp = new Mailpit(baseUrl);
  const matches = await mp.search(mailQuery(to, subject), 1);
  if (matches.length === 0) return null;
  return mp.message(matches[0]!.ID);
}

/**
 * The plain-text body of the latest message matching `to` (+ optional subject),
 * polling until it arrives (a notification is sent asynchronously). For a flow
 * that must read a value FROM the mail — e.g. an activation code the user types.
 */
export async function readMailText(
  baseUrl: string,
  to: string,
  subject: string | undefined,
  poll: PollConfig,
): Promise<string> {
  const msg = await pollUntil(
    () => readMailMessage(baseUrl, to, subject),
    (m) => m !== null,
    poll,
    `mail to ${subject ? `${to} / "${subject}"` : to}`,
  ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as MailMessage | null) : null));
  if (!msg) throw new Error(`No mail to ${to}${subject ? ` with subject containing "${subject}"` : ""}`);
  return (msg.Text ?? "").replace(/\r\n/g, "\n");
}

/**
 * Read the LATEST message matching `to` (and optional `subject`) from Mailpit,
 * projected for assertion. Returns null if none match. Latest-wins so messages
 * accumulated across runs don't shadow the one this scenario just produced.
 */
export async function readMailProjection(
  baseUrl: string,
  to: string,
  subject?: string,
): Promise<MailProjection | null> {
  const mp = new Mailpit(baseUrl);
  const matches = await mp.search(mailQuery(to, subject), 1);
  if (matches.length === 0) return null;
  return projectMail(await mp.message(matches[0]!.ID));
}
