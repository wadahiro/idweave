/**
 * actions — SCIM 2.0 source domain actions.
 *
 * Mirrors csvSource/ldapSource's contract (reset/set/add/replace/remove) but drives
 * a SCIM Service Provider directly, so idweave can CRUD a SCIM endpoint as a test
 * fixture (arrange a pre-existing resource, or verify the endpoint on its own) the
 * same way it does a CSV file or an LDAP directory. The READ side lives in
 * verify/scimTarget.ts; this is the WRITE side.
 *
 * A "row" maps to a SCIM resource: its identity is the value of `filterAttr`
 * (default userName). The row's keys are attribute PATHS navigated by slash —
 * `name/givenName` builds `{name:{givenName: ...}}` — mirroring the assert-side
 * `attributes` projection, so a column and its asserted path read the same. A value
 * of exactly "true"/"false" becomes a boolean (SCIM `active`); blanks are skipped.
 * Connection (url + token/basic) is suite data; secrets come from env.
 */
import type { SystemSpec, ScimSystemConfig } from "../scenario/suite.ts";
import type { CsvRow } from "./csvSource.ts";
import {
  readScimResource, listScimResources, createScimResource, patchScimResource, deleteScimResource,
} from "../clients/scim.ts";

export function scimConfig(system: SystemSpec): ScimSystemConfig {
  if (!system.scim) throw new Error("expected a SCIM system, got a non-scim one");
  return system.scim;
}

function idAttr(cfg: ScimSystemConfig): string {
  return cfg.filterAttr ?? "userName";
}

/** A row's identity is the value of its filter attribute (e.g. userName). */
function requireId(cfg: ScimSystemConfig, row: CsvRow): string {
  const id = row[idAttr(cfg)];
  if (id === undefined || id === "") throw new Error(`row is missing its SCIM id attribute "${idAttr(cfg)}"`);
  return id;
}

/** SCIM `active` is a boolean; everything else stays a string. */
function coerce(v: string): string | boolean {
  return v === "true" ? true : v === "false" ? false : v;
}

const CORE_SCHEMA: Record<string, string> = {
  Users: "urn:ietf:params:scim:schemas:core:2.0:User",
  Groups: "urn:ietf:params:scim:schemas:core:2.0:Group",
};

/** Set a slash path (`name/givenName`) into a nested object, creating hops as needed. */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split("/");
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

/** Build a SCIM resource body (for create) from a row: slash paths -> nested JSON. */
export function rowToScimBody(cfg: ScimSystemConfig, row: CsvRow): Record<string, unknown> {
  const schema = CORE_SCHEMA[cfg.resourceType ?? "Users"] ?? CORE_SCHEMA.Users!;
  const body: Record<string, unknown> = { schemas: [schema] };
  for (const [k, v] of Object.entries(row)) {
    if (v === "") continue;
    setPath(body, k, coerce(v));
  }
  return body;
}

/** Build PATCH replace ops (for an update) from a row — slash paths -> dotted SCIM
 *  paths; the identity attribute is left untouched (you don't re-key a resource). */
export function rowToScimPatchOps(cfg: ScimSystemConfig, row: CsvRow): Array<{ op: string; path: string; value: unknown }> {
  const id = idAttr(cfg);
  const ops: Array<{ op: string; path: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(row)) {
    if (k === id || v === "") continue;
    ops.push({ op: "replace", path: k.replace(/\//g, "."), value: coerce(v) });
  }
  return ops;
}

/** Delete the resource identified by `identifier` (filter attr value), if present. */
async function deleteByIdentifier(cfg: ScimSystemConfig, identifier: string): Promise<void> {
  const resource = await readScimResource(cfg, identifier);
  const id = resource?.id;
  if (typeof id === "string") await deleteScimResource(cfg, id);
}

/** reset: delete every resource at the endpoint (= empty the source). */
export async function resetSource(_hostDir: string, system: SystemSpec): Promise<void> {
  const cfg = scimConfig(system);
  for (const r of await listScimResources(cfg)) {
    if (typeof r.id === "string") await deleteScimResource(cfg, r.id);
  }
}

/** set: empty the endpoint, then create exactly these resources (full replace). */
export async function setSource(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const cfg = scimConfig(system);
  await resetSource(_hostDir, system);
  for (const row of rows) await createScimResource(cfg, rowToScimBody(cfg, row));
}

/** add: create NEW resources (the provider rejects a duplicate filter-attr value). */
export async function addSourceRows(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const cfg = scimConfig(system);
  for (const row of rows) await createScimResource(cfg, rowToScimBody(cfg, row));
}

/** replace: PATCH attributes of EXISTING resources (rejects a missing identifier). */
export async function replaceSourceRows(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const cfg = scimConfig(system);
  for (const row of rows) {
    const identifier = requireId(cfg, row);
    const resource = await readScimResource(cfg, identifier);
    const id = resource?.id;
    if (typeof id !== "string") throw new Error(`SCIM replace: "${identifier}" not found`);
    await patchScimResource(cfg, id, rowToScimPatchOps(cfg, row));
  }
}

/** remove: delete resources by identifier (filter-attr value). Idempotent (absent = no-op). */
export async function removeSourceRows(_hostDir: string, system: SystemSpec, ids: string[]): Promise<void> {
  const cfg = scimConfig(system);
  for (const id of ids) await deleteByIdentifier(cfg, id);
}
