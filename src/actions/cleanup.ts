/**
 * actions — namespace reset.
 *
 * by design: tests own their namespace. Before applying a scenario we remove
 * any focus users it owns (by name) and their linked projection shadows, so
 * each run starts from a known state and the check stays deterministic.
 */
import type { MidpointRest, MidpointObject } from "../clients/midpointRest.ts";

function asArray(value: unknown): MidpointObject[] {
  if (Array.isArray(value)) return value as MidpointObject[];
  if (value && typeof value === "object") return [value as MidpointObject];
  return [];
}

/** Focus object type -> REST collection (mirrors the verify dispatch). */
const TYPE_COLLECTION: Record<string, string> = {
  user: "users",
  role: "roles",
  org: "orgs",
  service: "services",
};

/**
 * Delete the named object(s) of the given type, if present — FAITHFUL to midPoint's own
 * delete (`DELETE /{type}/{oid}`), with `raw` matching `?options=raw`. The `delete-object`
 * step. NOTE: this does NOT tidy the linked shadows — a `raw` delete leaves them orphaned,
 * exactly as midPoint does. For a setup teardown that also cleans the shadows (and, by
 * default, deprovisions the external accounts), use `clear-focus`.
 *  - `raw: false` (default) — a NORMAL model delete: the projector deprovisions the linked
 *    accounts. The clockwork runs, so a deletion-approval policy could open a WORKFLOW.
 *  - `raw: true` — a REPOSITORY-only delete of just the object: no projector, no
 *    deprovision, no workflow (shadows are left orphaned, like midPoint's raw delete).
 */
export async function deleteObjectByName(
  rest: MidpointRest,
  type: string,
  name: string,
  opts: { raw?: boolean } = {},
): Promise<void> {
  const collection = TYPE_COLLECTION[type];
  if (!collection) throw new Error(`Cannot delete unsupported object type "${type}"`);
  const found = await rest.searchByName(collection, name);
  for (const obj of found) {
    const oid = String((obj as Record<string, unknown>)["oid"]);
    await rest.deleteObject(collection, oid, opts.raw === true);
  }
}

/**
 * Repository-only teardown of a focus AND its shadows (no connector, no projector, no
 * workflow): drop each `linkRef` shadow, then the focus. The `clear-focus` step with
 * `deprovision: false` — for host-managed externals (an all-CSV suite empties the file
 * host-side via `clear-system`), it removes the repo footprint WITHOUT touching the
 * external systems and WITHOUT leaving orphan shadows. Refuses an `indestructible` focus
 * (a guard against force-removing a baseline object matched only by name). Idempotent.
 */
export async function cleanupFocusRepo(rest: MidpointRest, type: string, name: string): Promise<void> {
  const collection = TYPE_COLLECTION[type];
  if (!collection) throw new Error(`clear-focus: unsupported focus type "${type}"`);
  const found = await rest.searchByName(collection, name);
  for (const obj of found) {
    const rec = obj as Record<string, unknown>;
    if (rec["indestructible"] === true) {
      throw new Error(`clear-focus refused: ${type} "${name}" is marked indestructible (a baseline object — not test data?)`);
    }
    const oid = String(rec["oid"]);
    for (const link of asArray(rec["linkRef"])) {
      const shadowOid = (link as Record<string, unknown>)["oid"];
      if (typeof shadowOid === "string") {
        // A dangling/broken shadow link is fine to ignore — the goal is just no shadow remains.
        await rest.deleteObject("shadows", shadowOid, true).catch(() => undefined);
      }
    }
    await rest.deleteObject(collection, oid, true);
  }
}
