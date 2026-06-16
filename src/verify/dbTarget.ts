/**
 * verify — read a provisioned account from a SQL `db` target. The returned row(s) are
 * the real external end-state (e.g. an external-service mock's table); absence is
 * how "removed / never created" is asserted.
 *
 * Two shapes, decided by the system's `linkFrom`:
 *  - plain: `:id` = the identifier, returns the single matching row (or null).
 *  - linkFrom: run the query once per linking value (`:id` = each value) and return
 *    the UNION as a SORTED SET — order-independent, like `expect.projections` (a focus
 *    may hold many values). The value(s) come from EITHER `path` (read LIVE from the
 *    focus named by the identifier) OR `capture` (values a `capture-focus` step
 *    recorded earlier — to assert a row whose value the run since destroyed, e.g. a
 *    value removed by a scheduled task). Empty set / missing focus -> null (assertable absent).
 */
import type { MidpointRest } from "../clients/midpointRest.ts";
import type { SystemSpec } from "../scenario/suite.ts";
import type { DbSystemConfig } from "../scenario/suite.ts";
import { queryRow } from "../clients/db.ts";
import { applyConsistency } from "./consistency.ts";

const COLLECTION: Record<string, string> = {
  user: "users",
  role: "roles",
  org: "orgs",
  service: "services",
};

function asArray(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

/** Navigate a slash path (e.g. `extension/externalRef`) into an object. */
function readPath(obj: unknown, path: string): unknown {
  return path.split("/").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

/** Project the asserted columns (allowlist), dropping volatile ones. */
function project(db: DbSystemConfig, row: Record<string, unknown>): Record<string, unknown> {
  if (!db.columns) return row;
  return Object.fromEntries(db.columns.filter((c) => c in row).map((c) => [c, row[c]]));
}

/** Read the row(s) for `identifier` from a db target (null if absent). `captures`
 * supplies the value(s) for a `linkFrom: { capture }` target (recorded earlier by a
 * `capture-focus` step); ignored otherwise. */
export async function readDbAccountProjection(
  rest: MidpointRest,
  target: SystemSpec,
  identifier: string,
  captures: Record<string, string[]> = {},
): Promise<Record<string, unknown> | Array<Record<string, unknown>> | null> {
  if (!target.db) throw new Error("expected a DB target system, got a non-db one");
  const db = target.db;
  // Project the row, then verify any `consistentWith` columns against the focus (the
  // account identifier is the user name) — collapses a match to a token, else diffs.
  const finalize = async (row: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const projected = project(db, row);
    if (db.consistentWith) await applyConsistency(rest, projected, identifier, db.consistentWith);
    return projected;
  };

  if (!db.linkFrom) {
    const row = await queryRow(db, identifier);
    return row ? await finalize(row) : null;
  }

  // linkFrom: run the query once per linking value and assert the union as a sorted
  // set. Source the value(s) from a recorded capture, else read them live from the
  // focus named by `identifier`.
  let values: unknown[];
  if (db.linkFrom.capture !== undefined) {
    values = captures[db.linkFrom.capture] ?? [];
  } else {
    const collection = COLLECTION[db.linkFrom.type ?? "user"];
    if (!collection) throw new Error(`linkFrom.type "${db.linkFrom.type}" is not a focus type`);
    const found = await rest.searchByName(collection, identifier);
    if (found.length === 0) return null; // focus absent -> no rows
    values = asArray(readPath(found[0], db.linkFrom.path!));
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const v of values) {
    const row = await queryRow(db, String(v));
    if (row) rows.push(await finalize(row));
  }
  if (rows.length === 0) return null;
  // Sort for an order-independent set comparison (the check compares arrays
  // positionally; both the captured expected and the live set are sorted the same).
  rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return rows;
}
