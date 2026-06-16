/**
 * verify — LDAP/AD target projection check.
 *
 * Read the REAL provisioned entry from the directory and return its attributes
 * as a record, so the expected asserts what midPoint actually wrote to the
 * external directory (by design), not midPoint's shadow.
 */
import type { SystemSpec } from "../scenario/suite.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";
import { withLdap } from "../clients/ldap.ts";
import { ldapConfig, ldapConnection } from "../actions/ldapSource.ts";
import { MASK_TOKEN } from "./normalize.ts";
import { applyConsistency } from "./consistency.ts";

/** Escape an LDAP filter assertion value (RFC 4515). */
function escapeFilterValue(v: string): string {
  return v.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

/**
 * Server-managed/operational/secret attributes that pollute a stable expected —
 * stripped when no `attributes` allowlist is declared (lower-cased; LDAP attribute
 * names are case-insensitive).
 */
const VOLATILE_ATTRS = new Set([
  "userpassword",
  "entryuuid",
  "entrycsn",
  "createtimestamp",
  "modifytimestamp",
  "creatorsname",
  "modifiersname",
  "structuralobjectclass",
  "pwdchangedtime",
  "pwdhistory",
  "hassubordinates",
]);

/**
 * Project a raw directory entry into the stable record the check asserts:
 * - with an `attributes` allowlist → only those (case-insensitive match), output
 *   under the DECLARED name so the expected is stable regardless of server casing;
 * - without one → every attribute except the volatile/secret denylist.
 * Multi-valued attributes are sorted so the compare is order-insensitive; the dn
 * (the entry's identity) is always kept.
 */
export function projectLdapEntry(
  entry: Record<string, string | string[]>,
  attributes?: string[],
  mask?: string[],
): Record<string, string | string[]> {
  const norm = (v: string | string[]): string | string[] => (Array.isArray(v) ? [...v].sort() : v);
  const out: Record<string, string | string[]> = {};
  if (entry.dn !== undefined) out.dn = entry.dn;

  // An empty-array value means the attribute is absent (a present LDAP attribute
  // always has >=1 value) — omit it so it never reads as a phantom empty present.
  const isAbsent = (v: string | string[] | undefined): boolean =>
    v === undefined || (Array.isArray(v) && v.length === 0);
  if (attributes && attributes.length) {
    const byLower = new Map(Object.entries(entry).map(([k, v]) => [k.toLowerCase(), v]));
    for (const a of attributes) {
      if (a.toLowerCase() === "dn") continue; // already kept
      const v = byLower.get(a.toLowerCase());
      if (!isAbsent(v)) out[a] = norm(v!);
    }
  } else {
    for (const [k, v] of Object.entries(entry)) {
      if (k === "dn" || VOLATILE_ATTRS.has(k.toLowerCase())) continue;
      if (!isAbsent(v)) out[k] = norm(v);
    }
  }

  // Mask declared volatile attribute values to a stable token (assert presence).
  if (mask && mask.length) {
    const maskLower = new Set(mask.map((m) => m.toLowerCase()));
    for (const k of Object.keys(out)) {
      if (k !== "dn" && maskLower.has(k.toLowerCase())) out[k] = MASK_TOKEN;
    }
  }
  return out;
}

/**
 * Read the provisioned entry whose RDN value is `identifier` from an LDAP target,
 * one level under the container, projected to the assertion subset (see
 * projectLdapEntry). Returns null if absent; throws on duplicates. `rest` is used
 * only when the system declares `consistentWith` (to read the linking focus).
 */
export async function readLdapAccountProjection(
  _hostDir: string,
  target: SystemSpec,
  identifier: string,
  rest?: MidpointRest,
): Promise<Record<string, string | string[]> | null> {
  const cfg = ldapConfig(target);
  const projected = await withLdap(ldapConnection(cfg), async (ops) => {
    const filter = `(${cfg.rdnAttr}=${escapeFilterValue(identifier)})`;
    const entries = await ops.searchAttrs(cfg.containerDn, filter, "one", cfg.attributes);
    if (entries.length === 0) return null;
    if (entries.length > 1) {
      throw new Error(`Expected at most one ${cfg.rdnAttr}=${identifier} in target, found ${entries.length}`);
    }
    return projectLdapEntry(entries[0]!, cfg.attributes, cfg.mask);
  });
  if (!projected || !cfg.consistentWith || !rest) return projected;
  // Cross-check each consistentWith attribute against the focus (the account
  // identifier is the user name); collapse a match to the token, else leave actual.
  await applyConsistency(rest, projected, identifier, cfg.consistentWith);
  return projected;
}

/**
 * Read EVERY account entry one level under the container as an order-independent set
 * (sorted), for asserting the whole directory at once (`expect.accounts` with
 * `all: true`). Each entry is projected like the single read (the stable `dn` is
 * kept as its identity). `consistentWith` is NOT applied here — it is a per-account
 * focus cross-check keyed by the account identifier, which a set read has no single
 * identifier for. An empty container is the empty set `[]`.
 */
export async function readAllLdapAccountProjections(
  _hostDir: string,
  target: SystemSpec,
): Promise<Array<Record<string, string | string[]>>> {
  const cfg = ldapConfig(target);
  const projected = await withLdap(ldapConnection(cfg), async (ops) => {
    const filter = `(objectClass=${cfg.objectClasses[0]})`;
    const entries = await ops.searchAttrs(cfg.containerDn, filter, "one", cfg.attributes);
    return entries.map((e) => projectLdapEntry(e, cfg.attributes, cfg.mask));
  });
  projected.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return projected;
}
