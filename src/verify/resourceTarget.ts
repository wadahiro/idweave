/**
 * verify — connector-mediated resource object projection check.
 *
 * Project the attribute record read THROUGH midPoint's connector (no shadow; see
 * actions/resourceObject.ts) into the stable record the check asserts. The oracle is
 * midPoint-mediated but SIDE-EFFECT-FREE (no shadow persisted) — the generic fallback
 * for targets idweave has no native client for; standardized protocols keep their
 * direct readers.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";
import type { ResourceSystemConfig } from "../scenario/suite.ts";
import { readResourceObject, readAllResourceObjects } from "../actions/resourceObject.ts";
import { MASK_TOKEN } from "./normalize.ts";

const isPrimitive = (v: unknown): boolean => v === null || (typeof v !== "object" && typeof v !== "function");
const isAbsent = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.length === 0);
/** Sort a multi-valued primitive array for an order-independent compare; leave others as-is. */
const norm = (v: unknown): unknown => (Array.isArray(v) && v.every(isPrimitive) ? [...v].sort() : v);

/**
 * Project the resource object's attributes (a `{ attr: value | [values] }` record the
 * script returned) into the asserted subset:
 * - with an `attributes` allowlist → only those (by name), in declared order;
 * - without one → every attribute (any `@`-prefixed meta key is always dropped).
 * Multi-valued attributes are sorted (order-insensitive); `mask` collapses a declared
 * attribute's value to a stable token (assert presence, not value).
 */
export function projectResourceObject(
  attrs: Record<string, unknown>,
  attributes?: string[],
  mask?: string[],
): Record<string, unknown> {
  const all: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("@")) continue; // defensive: meta keys
    if (!isAbsent(v)) all[k] = v;
  }

  const out: Record<string, unknown> = {};
  if (attributes && attributes.length) {
    for (const a of attributes) {
      if (a in all && !isAbsent(all[a])) out[a] = norm(all[a]);
    }
  } else {
    for (const [k, v] of Object.entries(all)) out[k] = norm(v);
  }

  if (mask && mask.length) {
    const m = new Set(mask);
    for (const k of Object.keys(out)) if (m.has(k)) out[k] = MASK_TOKEN;
  }
  return out;
}

/**
 * Read the resource object whose identifier attribute equals `identifier` through the
 * connector and project it (see projectResourceObject). Returns null if absent.
 */
export async function readResourceObjectProjection(
  rest: MidpointRest,
  version: string,
  cfg: ResourceSystemConfig,
  identifier: string,
): Promise<Record<string, unknown> | null> {
  const attrs = await readResourceObject(rest, version, cfg, identifier);
  if (!attrs) return null;
  return projectResourceObject(attrs, cfg.attributes, cfg.mask);
}

/**
 * List + project EVERY object of the resource through the connector, as an
 * order-independent set (sorted), for asserting a whole-target dump.
 */
export async function readAllResourceObjectsProjection(
  rest: MidpointRest,
  version: string,
  cfg: ResourceSystemConfig,
): Promise<Array<Record<string, unknown>>> {
  const objs = await readAllResourceObjects(rest, version, cfg);
  const projected = objs.map((o) => projectResourceObject(o, cfg.attributes, cfg.mask));
  projected.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return projected;
}
