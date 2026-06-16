/**
 * verify — CSV target projection check.
 *
 * Read the REAL target file and return the provisioned account row as a record,
 * so the expected asserts what was actually written to the external system
 * (by design), not midPoint's shadow.
 */
import type { SystemSpec } from "../scenario/suite.ts";
import { readCsvRecords, type CsvRecord } from "../clients/csvFile.ts";
import { csvSystemPath } from "../actions/csvSource.ts";

/**
 * Read the provisioned account identified by `identifier` from a CSV target.
 * Returns the row record, or null if absent. Throws on duplicate identifiers.
 */
export async function readCsvAccountProjection(
  hostDir: string,
  target: SystemSpec,
  identifier: string,
): Promise<CsvRecord | null> {
  if (!target.csv) throw new Error(`expected a CSV target system, got an LDAP one`);
  const idColumn = target.csv.idColumn;
  const records = await readCsvRecords(csvSystemPath(hostDir, target));
  const matches = records.filter((r) => r[idColumn] === identifier);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Expected at most one ${idColumn}="${identifier}" in target, found ${matches.length}`);
  }
  return matches[0]!;
}

/**
 * Read EVERY row of a CSV target as an order-independent set (sorted), for asserting
 * the whole file at once (`expect.accounts` with `all: true`). An empty file is the
 * empty set `[]` — a valid assertable state, not "absent".
 */
export async function readAllCsvAccountProjections(
  hostDir: string,
  target: SystemSpec,
): Promise<Array<CsvRecord>> {
  if (!target.csv) throw new Error(`expected a CSV target system, got an LDAP one`);
  const records = await readCsvRecords(csvSystemPath(hostDir, target));
  records.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return records;
}
