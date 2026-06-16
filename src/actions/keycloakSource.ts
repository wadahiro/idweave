/**
 * actions — Keycloak realm-user source domain actions (the WRITE side; the READ/assert
 * side lives in verify/keycloakTarget.ts).
 *
 * Drives the Keycloak admin REST API so idweave can CRUD a realm user as a test
 * fixture — arrange a pre-existing IdP user (e.g. for a correlation/link test), or
 * clean one up — the same uniform way it drives a CSV file, an LDAP directory, or a
 * SCIM endpoint.
 *
 * A "row" maps to a realm user keyed by `username`. The KNOWN top-level user fields
 * (username/email/firstName/lastName/enabled/emailVerified) land at the top level;
 * every other column becomes a custom realm-user attribute (`{ key: [value] }`),
 * mirroring the assert-side projection that flattens both namespaces. `enabled` /
 * `emailVerified` of exactly "true"/"false" coerce to booleans; blanks are skipped.
 *
 * `reset`/`set` are deliberately UNSUPPORTED: a realm is a SHARED, flat namespace that
 * also holds the admin and service-account users (unlike a CSV file or an OU subtree),
 * so a blanket "empty the source" would wipe accounts the adapter never created. Use
 * per-user `add`/`replace`/`remove` (or the `search-federated-user` precondition) instead.
 */
import type { SystemSpec, KeycloakSystemConfig } from "../scenario/suite.ts";
import type { CsvRow } from "./csvSource.ts";
import { keycloakAdminConnection } from "../scenario/suite.ts";
import { KeycloakAdmin } from "../clients/keycloakAdmin.ts";

/** Top-level Keycloak user fields; any other column is a custom realm-user attribute. */
const TOP_LEVEL = new Set(["username", "email", "firstName", "lastName", "enabled", "emailVerified"]);
const BOOLEAN_FIELDS = new Set(["enabled", "emailVerified"]);

function keycloakConfig(system: SystemSpec): KeycloakSystemConfig {
  if (!system.keycloak) throw new Error("expected a Keycloak system, got a non-keycloak one");
  return system.keycloak;
}

function admin(system: SystemSpec): KeycloakAdmin {
  return new KeycloakAdmin(keycloakAdminConnection(keycloakConfig(system)));
}

/** A row's identity is its `username` (the realm-user key). */
function requireUsername(row: CsvRow): string {
  const u = row.username;
  if (u === undefined || u === "") throw new Error('Keycloak row is missing its "username"');
  return u;
}

/** Build a Keycloak user representation from a row: known fields at top level, the rest
 *  as custom attributes. `rep` (the existing rep, for replace) is updated in place. */
export function applyRow(rep: Record<string, unknown>, row: CsvRow): Record<string, unknown> {
  const attributes = { ...((rep.attributes as Record<string, string[]>) ?? {}) };
  for (const [k, v] of Object.entries(row)) {
    if (v === "") continue;
    if (TOP_LEVEL.has(k)) rep[k] = BOOLEAN_FIELDS.has(k) ? v === "true" : v;
    else attributes[k] = [v];
  }
  if (Object.keys(attributes).length) rep.attributes = attributes;
  return rep;
}

/** Blanket source-emptying is unsafe on a shared realm (would delete admin/service users). */
export function resetSource(_hostDir: string, _system: SystemSpec): Promise<void> {
  throw new Error(
    "keycloak source: `reset`/`set` is not supported (a realm is a shared namespace incl. admin/service users — a blanket wipe is unsafe). Use add/replace/remove or search-federated-user.",
  );
}

/** `set` (empty + recreate) is unsafe on a shared realm — see resetSource. */
export function setSource(_hostDir: string, _system: SystemSpec, _rows: CsvRow[]): Promise<void> {
  return resetSource(_hostDir, _system);
}

/** add: create NEW realm users (a duplicate username is an error — use replace to update). */
export async function addSourceRows(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const kc = admin(system);
  for (const row of rows) {
    requireUsername(row);
    await kc.createUserRep(applyRow({}, row));
  }
}

/** replace: update EXISTING realm users in place (overlay the row onto the current rep). */
export async function replaceSourceRows(_hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const kc = admin(system);
  for (const row of rows) {
    const username = requireUsername(row);
    const current = await kc.getByUsername(username);
    if (!current || typeof current.id !== "string") throw new Error(`keycloak replace: user "${username}" not found`);
    await kc.updateUserRep(current.id, applyRow({ ...current }, row));
  }
}

/** remove: delete realm users by username. Idempotent (absent = no-op). */
export async function removeSourceRows(_hostDir: string, system: SystemSpec, ids: string[]): Promise<void> {
  const kc = admin(system);
  for (const id of ids) await kc.deleteByUsername(id);
}
