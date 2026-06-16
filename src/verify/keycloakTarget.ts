/**
 * verify — Keycloak target projection check.
 *
 * Read the REAL realm user over Keycloak admin REST and return its fields as a
 * record, so the expected asserts what midPoint actually provisioned to the IdP
 * (by design), not midPoint's shadow. Read-only (assert-only), like the db target.
 */
import type { SystemSpec } from "../scenario/suite.ts";
import { keycloakAdminConnection } from "../scenario/suite.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";
import { KeycloakAdmin, type KeycloakUser } from "../clients/keycloakAdmin.ts";
import { MASK_TOKEN } from "./normalize.ts";
import { applyConsistency } from "./consistency.ts";

/**
 * Server-managed/env-specific fields that pollute a stable expected — stripped when
 * no `attributes` allowlist is declared. (Case-sensitive: Keycloak field/attribute
 * names are case-sensitive, unlike LDAP.)
 */
const VOLATILE_FIELDS = new Set([
  "id",
  "createdTimestamp",
  "access",
  "disableableCredentialTypes",
  "notBefore",
  "totp",
  "origin",
  "self",
  "federationLink",
  "serviceAccountClientId",
]);

/** An absent value (undefined, or an empty custom-attribute array) — omitted so it never reads as a phantom present. */
const isAbsent = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.length === 0);
const norm = (v: unknown): unknown => (Array.isArray(v) ? [...v].sort() : v);

/**
 * Project a Keycloak user into the stable record the check asserts. Top-level fields
 * and custom `attributes` are FLATTENED into one namespace (a custom attribute may
 * therefore be asserted by its bare name, like a top-level field):
 * - with an `attributes` allowlist → only those names (top-level field OR custom
 *   attribute), in declared order;
 * - without one → every field except the volatile denylist.
 * Multi-valued attributes are sorted (order-insensitive); `mask` collapses a declared
 * field's value to a stable token (assert presence, not value).
 */
export function projectKeycloakUser(
  user: KeycloakUser,
  attributes?: string[],
  mask?: string[],
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(user)) {
    if (k === "attributes") continue;
    flat[k] = v;
  }
  // Custom attributes share the namespace (and win on a name clash — the more specific).
  for (const [k, v] of Object.entries(user.attributes ?? {})) flat[k] = v;

  const out: Record<string, unknown> = {};
  if (attributes && attributes.length) {
    for (const a of attributes) {
      if (a in flat && !isAbsent(flat[a])) out[a] = norm(flat[a]);
    }
  } else {
    for (const [k, v] of Object.entries(flat)) {
      if (VOLATILE_FIELDS.has(k) || isAbsent(v)) continue;
      out[k] = norm(v);
    }
  }

  if (mask && mask.length) {
    const m = new Set(mask);
    for (const k of Object.keys(out)) if (m.has(k)) out[k] = MASK_TOKEN;
  }
  return out;
}

/**
 * Read the realm user whose username is `identifier` from a Keycloak target,
 * projected to the assertion subset (see projectKeycloakUser). Returns null if absent.
 */
export async function readKeycloakAccountProjection(
  target: SystemSpec,
  identifier: string,
  rest?: MidpointRest,
): Promise<Record<string, unknown> | null> {
  if (!target.keycloak) throw new Error("expected a Keycloak target system, got a non-keycloak one");
  const kc = new KeycloakAdmin(keycloakAdminConnection(target.keycloak));
  const user = await kc.getByUsername(identifier);
  if (!user) return null;
  const projected = projectKeycloakUser(user, target.keycloak.attributes, target.keycloak.mask);
  // Cross-check each consistentWith field against the focus (account identifier = user name).
  if (target.keycloak.consistentWith && rest) await applyConsistency(rest, projected, identifier, target.keycloak.consistentWith);
  return projected;
}
