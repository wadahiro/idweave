/**
 * actions — LookupTable row reset, used as a scenario PRECONDITION.
 *
 * Some deployed tasks checkpoint their progress in a midPoint LookupTable (a row
 * keyed by the task OID, holding "last processed object + date") so a same-day
 * re-run RESUMES rather than reprocesses — and therefore SKIPS objects already
 * handled today. A connected test that re-drives such a task needs it to process
 * the test subject again, so it must clear that checkpoint first. Deleting the row
 * by key resets the task to "nothing done today".
 */
import type { MidpointRest } from "../clients/midpointRest.ts";

/**
 * Delete the row(s) with `key` from LookupTable `tableOid`. Idempotent: a delete of
 * a non-existent key is a no-op (so a re-run that already cleared it still passes).
 */
export async function clearLookupRow(rest: MidpointRest, tableOid: string, key: string): Promise<void> {
  await rest.modifyObject("lookupTables", tableOid, [
    { modificationType: "delete", path: "row", value: { key } },
  ]);
}

/**
 * Set the row with `key` to `value` in LookupTable `tableOid` — used as a scenario
 * PRECONDITION to drive a LookupTable-keyed task (e.g. queue a restrict-user run by
 * adding a `{status:"pending",...}` row for a per-key input file). Idempotent and
 * re-runnable: deletes any existing row for `key` first, then adds the new one (one
 * modify, deltas applied in order), so a re-run replaces rather than duplicates.
 */
export async function setLookupRow(
  rest: MidpointRest,
  tableOid: string,
  key: string,
  value: string,
): Promise<void> {
  await rest.modifyObject("lookupTables", tableOid, [
    { modificationType: "delete", path: "row", value: { key } },
    { modificationType: "add", path: "row", value: { key, value } },
  ]);
}
