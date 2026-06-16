/**
 * actions — LDAP/AD source domain actions.
 *
 * Mirrors csvSource's contract (reset/set/add/replace/remove) but writes the
 * accounts as directory ENTRIES instead of CSV rows. The suite OWNS the container
 * subtree as a test dataset: like emptying a CSV file, `reset` wipes the account
 * entries directly under `containerDn` and the scenario repopulates them. Only
 * entries of the configured object class, one level under the container, are
 * touched — sub-OUs/groups and the container node are left alone.
 *
 * A "row" maps to an entry: DN = <rdnAttr>=<row[rdnAttr]>,<containerDn>; the
 * row's keys are the attributes; objectClasses + baseAttrs are added; an optional
 * password attribute is encoded for AD (unicodePwd). Connection: the `url` and
 * bind `dn` are suite data; the bind password comes from the env var named by
 * `bind.passwordEnv` (by design: secrets from env).
 */
import type { SystemSpec, LdapSystemConfig } from "../scenario/suite.ts";
import type { CsvRow } from "./csvSource.ts";
import { withLdap, type LdapConnection, type LdapEntry, type LdapOps } from "../clients/ldap.ts";

export function ldapConfig(system: SystemSpec): LdapSystemConfig {
  if (!system.ldap) throw new Error(`expected an LDAP system, got a CSV one`);
  return system.ldap;
}

/** Resolve the bind connection: url + bind dn from the suite, password from env. */
export function ldapConnection(cfg: LdapSystemConfig): LdapConnection {
  const bindPw = process.env[cfg.bind.passwordEnv];
  if (!bindPw) {
    throw new Error(`LDAP bind password env "${cfg.bind.passwordEnv}" is not set`);
  }
  return { url: cfg.url, bindDn: cfg.bind.dn, bindPw };
}

/** A row's identity is the value of its RDN attribute (e.g. cn / uid). */
function requireId(cfg: LdapSystemConfig, row: CsvRow): string {
  const id = row[cfg.rdnAttr];
  if (id === undefined || id === "") throw new Error(`row is missing its RDN attribute "${cfg.rdnAttr}"`);
  return id;
}

/** Minimal RFC 4514 escaping for an RDN value used inside a DN. */
function escapeRdnValue(v: string): string {
  return v.replace(/([\\,+"<>;=])/g, "\\$1").replace(/^[ #]| $/g, (m) => "\\" + m);
}

export function entryDn(cfg: LdapSystemConfig, id: string): string {
  return `${cfg.rdnAttr}=${escapeRdnValue(id)},${cfg.containerDn}`;
}

/** AD password encoding: UTF-16LE of the double-quoted password. */
export function encodePassword(pw: string): Buffer {
  return Buffer.from(`"${pw}"`, "utf16le");
}

/** Build an LDAP entry's attributes from a row (the row's keys ARE the attributes). */
export function rowToEntry(cfg: LdapSystemConfig, row: CsvRow): LdapEntry {
  const pwFrom = cfg.password?.from;
  const entry: LdapEntry = { objectClass: cfg.objectClasses };
  for (const [k, v] of Object.entries(cfg.baseAttrs ?? {})) entry[k] = v;
  for (const attr of Object.keys(row)) {
    if (attr === pwFrom) continue; // the cleartext password is encoded below, not copied
    const val = row[attr];
    if (val !== undefined && val !== "") entry[attr] = val;
  }
  entry[cfg.rdnAttr] = requireId(cfg, row); // RDN attribute must be present
  if (pwFrom) {
    const pw = row[pwFrom];
    if (pw) entry[cfg.password?.to ?? "unicodePwd"] = encodePassword(pw);
  }
  return entry;
}

/** Attributes to send on a `replace` (modify) — never the structural ones. */
function modifiableAttrs(cfg: LdapSystemConfig, row: CsvRow): LdapEntry {
  const entry = rowToEntry(cfg, row);
  delete entry.objectClass;
  delete entry[cfg.rdnAttr];
  return entry;
}

async function washAccounts(cfg: LdapSystemConfig, ops: LdapOps): Promise<void> {
  const dns = await ops.searchDns(cfg.containerDn, `(objectClass=${cfg.objectClasses[0]})`, "one");
  for (const dn of dns) await ops.del(dn);
}

/** reset: wipe the account entries under the container (= empty the source). */
export async function resetSource(_hostDir: string, system: SystemSpec): Promise<void> {
  const cfg = ldapConfig(system);
  await withLdap(ldapConnection(cfg), (ops) => washAccounts(cfg, ops));
}

/** set: wash, then create exactly these entries (full replace). */
export async function setSource(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const cfg = ldapConfig(system);
  await withLdap(ldapConnection(cfg), async (ops) => {
    await washAccounts(cfg, ops);
    for (const row of rows) await ops.add(entryDn(cfg, requireId(cfg, row)), rowToEntry(cfg, row));
  });
}

/** add: create NEW entries (the directory rejects a duplicate DN). */
export async function addSourceRows(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const cfg = ldapConfig(system);
  await withLdap(ldapConnection(cfg), async (ops) => {
    for (const row of rows) await ops.add(entryDn(cfg, requireId(cfg, row)), rowToEntry(cfg, row));
  });
}

/** replace: modify EXISTING entries' attributes (the directory rejects a missing DN). */
export async function replaceSourceRows(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const cfg = ldapConfig(system);
  await withLdap(ldapConnection(cfg), async (ops) => {
    for (const row of rows) await ops.replaceAttrs(entryDn(cfg, requireId(cfg, row)), modifiableAttrs(cfg, row));
  });
}

/** remove: delete entries by id (RDN value). Idempotent — an already-absent entry
 *  is a no-op (a precondition reset removing a row that isn't there should pass,
 *  mirroring clear-focus). LDAP NoSuchObject is code 32 (0x20). */
export async function removeSourceRows(_hostDir: string, system: SystemSpec, ids: string[]): Promise<void> {
  const cfg = ldapConfig(system);
  await withLdap(ldapConnection(cfg), async (ops) => {
    for (const id of ids) {
      try {
        await ops.del(entryDn(cfg, id));
      } catch (e) {
        const code = (e as { code?: number })?.code;
        if (code !== 32 && !/does not exist/i.test(String((e as { message?: string })?.message))) throw e;
      }
    }
  });
}
