/**
 * verify — normalization (centralized here, by design).
 *
 * Strips volatile/operational/generated noise from a midPoint object so a
 * expected comparison asserts intent, not run-specific values: OIDs, versions,
 * metadata, timestamps, object references (which carry generated OIDs), and
 * derived fields. Empty containers left behind are pruned.
 */
import type { MidpointObject } from "../clients/midpointRest.ts";

/** Exact keys removed wherever they appear. */
const VOLATILE_KEYS = new Set<string>([
  "@metadata",
  "metadata",
  "@id",
  "id", // PCV container id — "@id" in 4.4+ JSON, plain "id" in 4.0 (generated, volatile)
  "@ns",
  "@type",
  "version",
  "oid",
  "iteration",
  "iterationToken",
  "fetchResult",
  "operationExecution", // per-operation execution records (status + timestamps)
  "effectiveStatus", // derived from administrativeStatus + validity
  "credentials", // secrets; the encrypted value re-encrypts differently each run
  "behavior", // runtime authentication history (login timestamps, source IP)
]);

function isVolatileKey(key: string): boolean {
  if (VOLATILE_KEYS.has(key)) return true;
  if (key.endsWith("Timestamp")) return true; // create/modify/enable/...
  // Object references carry generated OIDs (linkRef, *TaskRef, targetRef, ...).
  if (key.endsWith("Ref")) return true;
  return false;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Recursively normalize a value, returning a stripped, pruned copy. */
export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out = value.map(normalize).filter((v) => !isEmpty(v));
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (isVolatileKey(key)) continue;
      const norm = normalize(raw);
      if (!isEmpty(norm)) out[key] = norm;
    }
    return out;
  }
  return value;
}

export function normalizeObject(obj: MidpointObject): Record<string, unknown> {
  return normalize(obj) as Record<string, unknown>;
}

/** Stable token a masked (volatile) value is replaced with. */
export const MASK_TOKEN = "<dynamic>";

/**
 * Replace the value at each `a/b/c` path with a stable token — for project-specific
 * VOLATILE fields whose value changes every run (e.g. a run-minted id with random
 * components/dates), so the expected pins the field's PRESENCE, not its
 * value. Applied to both the captured expected and the live read, so they match.
 * A path that isn't present is skipped (no-op).
 */
export function applyMask(obj: Record<string, unknown>, paths: readonly string[], token = MASK_TOKEN): void {
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cur: Record<string, unknown> | undefined = obj;
    for (let i = 0; i < parts.length - 1 && cur; i++) {
      const next: unknown = cur[parts[i]!];
      cur = next && typeof next === "object" && !Array.isArray(next) ? (next as Record<string, unknown>) : undefined;
    }
    const last = parts[parts.length - 1]!;
    if (cur && last in cur) cur[last] = token;
  }
}
