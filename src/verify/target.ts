/**
 * verify — target projection dispatch. Reads a provisioned account from whichever
 * external system a target is (csv file / ldap directory / sql db / scim provider /
 * keycloak realm), so the expect step stays protocol-agnostic.
 */
import type { SystemSpec } from "../scenario/suite.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";
import { readCsvAccountProjection, readAllCsvAccountProjections } from "./csvTarget.ts";
import { readLdapAccountProjection, readAllLdapAccountProjections } from "./ldapTarget.ts";
import { readDbAccountProjection } from "./dbTarget.ts";
import { readScimAccountProjection, readAllScimAccountProjections } from "./scimTarget.ts";
import { readKeycloakAccountProjection } from "./keycloakTarget.ts";

/**
 * Read the provisioned account `identifier` from `target` (null if absent). `rest`
 * is used by a `db` target with `linkFrom` (to read the linking focus) and by any
 * target with `consistentWith` (to cross-check against the focus); the csv target
 * ignores it. A db `linkFrom` target returns an order-independent ROW SET.
 * `captures` feeds a db `linkFrom: { capture }` target its linking value(s). The
 * scim/keycloak targets are read-only assert targets (their own REST API).
 */
export function readAccountProjection(
  hostDir: string,
  target: SystemSpec,
  identifier: string,
  rest: MidpointRest,
  captures: Record<string, string[]> = {},
): Promise<Record<string, unknown> | Array<Record<string, unknown>> | null> {
  if (target.ldap) return readLdapAccountProjection(hostDir, target, identifier, rest);
  if (target.db) return readDbAccountProjection(rest, target, identifier, captures);
  if (target.scim) return readScimAccountProjection(target, identifier, rest);
  if (target.keycloak) return readKeycloakAccountProjection(target, identifier, rest);
  return readCsvAccountProjection(hostDir, target, identifier);
}

/**
 * Read the WHOLE account set of `target` as an order-independent (sorted) array, for
 * an `expect.accounts` with `all: true` (assert "exactly these accounts exist"). An
 * empty system reads as the empty set `[]`. Supported for the container-of-objects
 * readers — csv (the file's rows), ldap (entries under the container), scim (every
 * resource). A `db` target (a custom by-id SELECT; use `linkFrom` for set semantics)
 * and a `keycloak` target (the realm mixes provisioned, service, and admin users with
 * no list primitive) have no natural full-set read, so `all` is rejected for them.
 */
export function readAllAccountProjections(
  hostDir: string,
  target: SystemSpec,
): Promise<Array<Record<string, unknown>>> {
  if (target.ldap) return readAllLdapAccountProjections(hostDir, target) as Promise<Array<Record<string, unknown>>>;
  if (target.scim) return readAllScimAccountProjections(target);
  if (target.csv) return readAllCsvAccountProjections(hostDir, target) as Promise<Array<Record<string, unknown>>>;
  const kind = target.db ? "db" : target.keycloak ? "keycloak" : "this";
  throw new Error(`expect.accounts \`all: true\` is not supported for a ${kind} target (no natural full-set read)`);
}
