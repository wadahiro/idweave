/**
 * actions — mail sink reset, used as a scenario PRECONDITION.
 *
 * The Mailpit sink accumulates messages across runs, so a NEGATIVE mail assertion
 * ("no notification was sent") is not re-runnable on its own — a prior run's mail to
 * the same recipient would make a fresh `absent` check fail. Clearing the recipient's
 * mail just before the action under test fixes that: any matching message afterwards
 * must have come from THIS run. Surgical by recipient (other scenarios' mail intact);
 * omit `to` to reset the whole sink.
 */
import { Mailpit } from "../clients/mailpit.ts";

/** Delete captured mail — to `to` only, or all when `to` is omitted. Idempotent. */
export async function clearMail(mailUrl: string, to?: string): Promise<void> {
  const mailpit = new Mailpit(mailUrl);
  if (to) await mailpit.deleteTo(to);
  else await mailpit.deleteAll();
}
