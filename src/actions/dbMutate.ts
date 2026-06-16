/**
 * actions — mutate an external `db` system's state, used as a scenario PRECONDITION.
 *
 * The mirror of the db ASSERT path (verify/dbTarget): the same `linkFrom` that finds
 * the row(s) to assert finds the row(s) to REWIND. A scenario uses this to put an
 * external-service mock into a "threshold crossed" state without moving any clock —
 * e.g. rewind a row's `expires_at` so a scheduled task treats it as past/at the
 * threshold. The project-specific SQL lives in the suite system's `update` (DATA);
 * this verb resolves `:id` from the focus and supplies `:value`.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";
import type { SystemSpec } from "../scenario/suite.ts";
import { execUpdate } from "../clients/db.ts";

const COLLECTION: Record<string, string> = {
  user: "users",
  role: "roles",
  org: "orgs",
  service: "services",
};

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const readPath = (obj: unknown, path: string): unknown =>
  path.split("/").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );

/**
 * Run the system's `update` once per linking value, binding `:id` = each value and
 * `:value` = `value`. The value(s) come from `linkFrom.path` read LIVE from the focus
 * named by `identifier` (a multi-value property is supported — a focus may hold several
 * values); a plain (no-linkFrom) system binds `:id` = `identifier` itself. Returns the
 * total affected row count (or -1 if the driver doesn't report it). Throws if the
 * focus is absent (a precondition expects the journey already produced it).
 */
export async function dbMutate(
  rest: MidpointRest,
  system: SystemSpec,
  identifier: string,
  value: string,
): Promise<number> {
  if (!system.db) throw new Error("db-mutate: expected a DB system, got a non-db one");
  const db = system.db;

  let ids: string[];
  if (!db.linkFrom) {
    ids = [identifier];
  } else if (db.linkFrom.path) {
    const collection = COLLECTION[db.linkFrom.type ?? "user"];
    if (!collection) throw new Error(`db-mutate: linkFrom.type "${db.linkFrom.type}" is not a focus type`);
    const found = await rest.searchByName(collection, identifier);
    if (found.length === 0) throw new Error(`db-mutate: focus "${identifier}" not found`);
    ids = asArray(readPath(found[0], db.linkFrom.path)).map(String);
  } else {
    // `linkFrom: { capture }` is an assert-time notion (a value the run destroyed);
    // a mutate runs against live state, so a path (or no linkFrom) is required.
    throw new Error("db-mutate: linkFrom must use `path` (live) — `capture` is assert-only");
  }

  let affected = 0;
  for (const id of ids) {
    const n = await execUpdate(db, { id, value });
    affected += n < 0 ? 0 : n;
  }
  return affected;
}
