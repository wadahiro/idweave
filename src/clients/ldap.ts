/**
 * clients — LDAP/AD protocol adapter (ldapts).
 *
 * A thin bind/add/modify/delete/search wrapper used by the LDAP source adapter
 * to write test accounts directly into a directory subtree midPoint reconciles
 * from. Takes an already-resolved LdapConnection: the url + bind dn are suite
 * data (per `system`), only the bind password comes from the environment
 * (by design: creds from env).
 */
import { Client, Change, Attribute } from "ldapts";

export interface LdapConnection {
  /** URL with scheme — ldap:// (plain) or ldaps:// (TLS). */
  url: string;
  bindDn: string;
  bindPw: string;
}

export type LdapValue = string | string[] | Buffer;
export type LdapEntry = Record<string, LdapValue>;

function toValues(v: LdapValue): string[] | Buffer[] {
  if (Buffer.isBuffer(v)) return [v];
  return Array.isArray(v) ? v : [v];
}

/** Operations available inside a bound session (see withLdap). */
export class LdapOps {
  constructor(private readonly client: Client) {}

  async add(dn: string, entry: LdapEntry): Promise<void> {
    // Use the Attribute[] form (not the Record form) so binary values like
    // AD's unicodePwd (a Buffer) are accepted.
    const attributes = Object.entries(entry).map(
      ([type, value]) => new Attribute({ type, values: toValues(value) }),
    );
    await this.client.add(dn, attributes);
  }

  /** Replace the given attributes on an existing entry (leaves others intact). */
  async replaceAttrs(dn: string, entry: LdapEntry): Promise<void> {
    const changes = Object.entries(entry).map(
      ([type, value]) =>
        new Change({ operation: "replace", modification: new Attribute({ type, values: toValues(value) }) }),
    );
    if (changes.length) await this.client.modify(dn, changes);
  }

  async del(dn: string): Promise<void> {
    await this.client.del(dn);
  }

  /** DNs of entries under baseDn matching filter (one-level by default). */
  async searchDns(baseDn: string, filter: string, scope: "base" | "one" | "sub" = "one"): Promise<string[]> {
    const { searchEntries } = await this.client.search(baseDn, { scope, filter, attributes: ["1.1"] });
    return searchEntries.map((e) => e.dn);
  }

  /**
   * Entries under baseDn matching filter, each as a flat attribute record (string
   * values). `attributes` restricts which the server returns (plus the dn) — used
   * to project a stable assertion subset; omit for all (user) attributes.
   */
  async searchAttrs(
    baseDn: string,
    filter: string,
    scope: "base" | "one" | "sub" = "one",
    attributes?: string[],
  ): Promise<Array<Record<string, string | string[]>>> {
    const { searchEntries } = await this.client.search(baseDn, {
      scope,
      filter,
      ...(attributes && attributes.length ? { attributes } : {}),
    });
    return searchEntries.map((e) => {
      const rec: Record<string, string | string[]> = { dn: e.dn };
      for (const [k, v] of Object.entries(e)) {
        if (k === "dn") continue;
        // ldapts returns a REQUESTED-but-absent attribute as []. An LDAP attribute
        // always has >=1 value when it exists, so [] means absent — omit it, so the
        // read matches a raw ldapsearch (which simply does not return the attribute)
        // rather than reporting a phantom empty value downstream.
        if (Array.isArray(v) && v.length === 0) continue;
        rec[k] = Array.isArray(v) ? v.map((x) => x.toString()) : (v as string | Buffer).toString();
      }
      return rec;
    });
  }
}

/** Bind, run `fn`, then always unbind. ldaps:// uses relaxed TLS (dev self-signed). */
export async function withLdap<T>(conn: LdapConnection, fn: (ops: LdapOps) => Promise<T>): Promise<T> {
  // Only attach tlsOptions for ldaps:// — passing them on a plain ldap:// URL
  // makes ldapts attempt a TLS handshake the server rejects (ECONNRESET).
  const tls = conn.url.toLowerCase().startsWith("ldaps");
  const client = new Client({ url: conn.url, ...(tls ? { tlsOptions: { rejectUnauthorized: false } } : {}) });
  await client.bind(conn.bindDn, conn.bindPw);
  try {
    return await fn(new LdapOps(client));
  } finally {
    await client.unbind().catch(() => {});
  }
}
