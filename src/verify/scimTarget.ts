/**
 * verify — SCIM 2.0 target projection check.
 *
 * Read the REAL provisioned resource from the Service Provider and return its
 * attributes as a record, so the expected asserts what midPoint actually provisioned
 * to the SCIM endpoint (by design), not midPoint's shadow. Read-only, like the db target.
 */
import type { SystemSpec } from "../scenario/suite.ts";
import type { ScimSystemConfig } from "../scenario/suite.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";
import { readScimResource, listScimResources } from "../clients/scim.ts";
import { MASK_TOKEN } from "./normalize.ts";
import { applyConsistency } from "./consistency.ts";

/** Top-level SCIM fields that pollute a stable expected — stripped when no allowlist is declared. */
const VOLATILE_FIELDS = new Set(["id", "meta", "schemas"]);

const isAbsent = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.length === 0);
const isPrimitive = (v: unknown): boolean => v === null || (typeof v !== "object" && typeof v !== "function");
/** Sort an array of primitives for an order-independent compare; leave arrays of objects as-is. */
const norm = (v: unknown): unknown => (Array.isArray(v) && v.every(isPrimitive) ? [...v].sort() : v);

/** Navigate a slash path (e.g. `name/givenName`) into a nested object; undefined if any hop is missing. */
function readPath(obj: unknown, path: string): unknown {
  return path.split("/").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

/**
 * Project a SCIM resource into the stable record the check asserts:
 * - with an `attributes` allowlist → each PATH navigated by slash (`name/givenName`,
 *   `active`), output under the path as a flat key (so the expected stays flat/stable);
 * - without one → every top-level field except the volatile denylist (nested objects
 *   and multi-valued arrays kept whole).
 * Arrays of primitives are sorted (order-insensitive); `mask` collapses a declared
 * path's value to a stable token (assert presence, not value).
 */
export function projectScimResource(
  resource: Record<string, unknown>,
  attributes?: string[],
  mask?: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (attributes && attributes.length) {
    for (const a of attributes) {
      const v = readPath(resource, a);
      if (!isAbsent(v)) out[a] = norm(v);
    }
  } else {
    for (const [k, v] of Object.entries(resource)) {
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
 * Read the resource whose filter attribute equals `identifier` from a SCIM target,
 * projected to the assertion subset (see projectScimResource). Returns null if absent.
 */
export async function readScimAccountProjection(
  target: SystemSpec,
  identifier: string,
  rest?: MidpointRest,
): Promise<Record<string, unknown> | null> {
  if (!target.scim) throw new Error("expected a SCIM target system, got a non-scim one");
  const cfg: ScimSystemConfig = target.scim;
  const resource = await readScimResource(cfg, identifier);
  if (!resource) return null;
  const projected = projectScimResource(resource, cfg.attributes, cfg.mask);
  // Cross-check each consistentWith path against the focus (account identifier = user name).
  if (cfg.consistentWith && rest) await applyConsistency(rest, projected, identifier, cfg.consistentWith);
  return projected;
}

/**
 * Read EVERY resource at the endpoint as an order-independent set (sorted), for
 * asserting the whole provider at once (`expect.accounts` with `all: true`). Each
 * resource is projected like the single read. `consistentWith` is NOT applied here —
 * it is a per-account focus cross-check keyed by the account identifier, which a set
 * read has no single identifier for. An empty endpoint is the empty set `[]`.
 */
export async function readAllScimAccountProjections(
  target: SystemSpec,
): Promise<Array<Record<string, unknown>>> {
  if (!target.scim) throw new Error("expected a SCIM target system, got a non-scim one");
  const cfg: ScimSystemConfig = target.scim;
  const resources = await listScimResources(cfg);
  const projected = resources.map((r) => projectScimResource(r, cfg.attributes, cfg.mask));
  projected.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return projected;
}
