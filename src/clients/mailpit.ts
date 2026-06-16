/**
 * clients — Mailpit REST client. A thin read wrapper over the Mailpit v1 API used to
 * assert the notifications midPoint actually sent (Mailpit is the test SMTP sink).
 * The base URL (incl. any webroot, e.g. http://host:1080/maildev) is env data.
 */

/** An address as Mailpit returns it. */
export interface MailAddress {
  Name: string;
  Address: string;
}

/** Summary of a message in a list/search result (newest first). */
export interface MailSummary {
  ID: string;
  From: MailAddress | null;
  To: MailAddress[];
  Cc: MailAddress[] | null;
  Subject: string;
  Created: string;
}

/** A full message (GET /message/{id}). */
export interface MailMessage {
  ID: string;
  From: MailAddress | null;
  To: MailAddress[];
  Cc: MailAddress[] | null;
  Bcc: MailAddress[] | null;
  Subject: string;
  Date: string;
  Text: string;
  HTML: string;
}

export class MailpitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailpitError";
  }
}

export class Mailpit {
  private readonly base: string;
  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { headers: { accept: "application/json" } });
    } catch (e) {
      throw new MailpitError(`Mailpit unreachable at ${this.base} (${e instanceof Error ? e.message : e})`);
    }
    if (!res.ok) throw new MailpitError(`Mailpit ${path} → ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  /** Messages matching a Mailpit search query (e.g. `to:x@y subject:"Hi"`), newest first. */
  async search(query: string, limit = 50): Promise<MailSummary[]> {
    const r = await this.get<{ messages: MailSummary[] }>(
      `/api/v1/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return r.messages ?? [];
  }

  /** Full message by id. */
  async message(id: string): Promise<MailMessage> {
    return this.get<MailMessage>(`/api/v1/message/${encodeURIComponent(id)}`);
  }

  /** Delete every captured message (reset the sink). */
  async deleteAll(): Promise<void> {
    const res = await fetch(`${this.base}/api/v1/messages`, { method: "DELETE" });
    if (!res.ok) throw new MailpitError(`Mailpit DELETE messages → ${res.status} ${res.statusText}`);
  }

  /**
   * Delete the messages addressed to `to` (a surgical reset). Used to make a
   * negative assertion ("no notification was sent") RE-RUNNABLE: the sink
   * accumulates across runs, so a prior run's mail to the same recipient would
   * otherwise make a fresh `absent` check fail. Deletes only this recipient's
   * mail, leaving other scenarios' messages intact. A no-op if none match.
   */
  async deleteTo(to: string): Promise<void> {
    const ids = (await this.search(`to:${to}`, 200)).map((m) => m.ID);
    if (ids.length === 0) return;
    const res = await fetch(`${this.base}/api/v1/messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: ids }),
    });
    if (!res.ok) throw new MailpitError(`Mailpit DELETE messages → ${res.status} ${res.statusText}`);
  }
}
