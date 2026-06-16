/**
 * actions — clean up a focus AND everything it provisioned, in ONE bulk action (the
 * `clear-focus` step). A thorough teardown that triggers no approval workflow: unlike a model delete (which runs
 * the clockwork — outbound mappings decide, and a deletion-approval policy could open a
 * workflow), this drives the provisioning layer DIRECTLY, below the model — for every
 * `linkRef` shadow it connector-deletes the real resource object (keyed by the shadow's
 * primary identifier) and removes the shadow, then repo-deletes the focus. So an external
 * TARGET account is guaranteed gone with no workflow; a protected/read-only SOURCE object
 * is left intact (only its shadow dropped). An `indestructible` focus is refused. Only
 * applies to a FOCUS (it is the projection owner). See clients/resourceObjectScript.ts ›
 * buildPurgeFocusScript for the mechanism. Idempotent: an absent focus is a no-op.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";
import { buildPurgeFocusScript, ABSENT_MARKER, INDESTRUCTIBLE_MARKER } from "../clients/resourceObjectScript.ts";

/** Focus object type -> REST collection (focuses own projections; mirrors actions/cleanup.ts). */
const TYPE_COLLECTION: Record<string, string> = {
  user: "users",
  role: "roles",
  org: "orgs",
  service: "services",
};

/**
 * Clean up the named focus of `type` if present: connector-delete its linked accounts +
 * the focus itself. `version` selects the application-context holder (the only per-major
 * bit). Returns the number of accounts the connector deleted across all matching focuses,
 * or null if no such focus exists. Throws if a match is `indestructible`.
 */
export async function purgeFocus(
  rest: MidpointRest,
  version: string,
  type: string,
  name: string,
): Promise<number | null> {
  const collection = TYPE_COLLECTION[type];
  if (!collection) throw new Error(`clear-focus: unsupported focus type "${type}"`);
  const found = await rest.searchByName(collection, name);
  if (found.length === 0) return null;
  let total = 0;
  for (const obj of found) {
    const oid = String((obj as Record<string, unknown>)["oid"]);
    const out = await rest.executeScriptOutput(buildPurgeFocusScript({ version, focusType: type, focusOid: oid }));
    const value = out[0] ?? "";
    if (value === ABSENT_MARKER) continue;
    if (value === INDESTRUCTIBLE_MARKER) {
      throw new Error(`clear-focus refused: ${type} "${name}" is marked indestructible (a baseline object — not test data?)`);
    }
    const m = value.match(/^PURGED:(\d+)$/);
    if (!m) throw new Error(`clear-focus failed for "${name}": ${value || "(no output)"}`);
    total += Number(m[1]);
  }
  return total;
}
