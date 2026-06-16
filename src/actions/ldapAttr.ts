/**
 * actions — read a SINGLE LDAP account attribute, including operational/secret ones the
 * assertion projection normally hides (e.g. `userPassword`). Used to verify a
 * credential CHANGED deterministically: an {SSHA} hash is salted, so the stored
 * value differs on every password set — capture it before, poll until it differs
 * after, instead of guessing a wait for asynchronous propagation.
 */
import type { SystemSpec } from "../scenario/suite.ts";
import { withLdap } from "../clients/ldap.ts";
import { ldapConfig, ldapConnection } from "./ldapSource.ts";

/** Escape an LDAP filter assertion value (RFC 4515). */
function escapeFilterValue(v: string): string {
  return v.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

/**
 * Read `attr` of the account whose RDN value is `identifier` from an LDAP system,
 * as comparable string value(s) (binary, e.g. a password hash, is base64-encoded).
 * Returns `[]` if the account or attribute is absent. Throws if `system` is not LDAP.
 */
export async function readLdapAccountAttr(system: SystemSpec, identifier: string, attr: string): Promise<string[]> {
  if (!system.ldap) throw new Error("expected an LDAP system to read an account attribute from");
  const cfg = ldapConfig(system);
  return withLdap(ldapConnection(cfg), async (ops) => {
    const filter = `(${cfg.rdnAttr}=${escapeFilterValue(identifier)})`;
    const entries = await ops.searchAttrs(cfg.containerDn, filter, "one", [attr]);
    if (entries.length === 0) return [];
    const byLower = new Map(Object.entries(entries[0]!).map(([k, v]) => [k.toLowerCase(), v]));
    const v = byLower.get(attr.toLowerCase());
    if (v === undefined) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((x) => (Buffer.isBuffer(x) ? x.toString("base64") : String(x))).sort();
  });
}
