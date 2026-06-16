/**
 * actions — CSV system domain actions (source mutations + target reset).
 *
 * The CSV connector reads a file inside the midPoint container; that path is
 * bind-mounted from the host, so mutating a CSV system means writing its file on
 * the host. Attribute names come from the suite (and scenario data) — this module
 * is value-agnostic. Source mutations mirror an HR feed: full replace (set) or
 * deltas (add/replace/remove) against whatever the file currently holds.
 */
import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import type { SystemSpec, CsvSystemConfig } from "../scenario/suite.ts";
import { readCsvRecords } from "../clients/csvFile.ts";

export type CsvRow = Record<string, string>;

/** The CSV config of a system; errors if the system is not a CSV one. */
function csvConfig(system: SystemSpec): CsvSystemConfig {
  if (!system.csv) throw new Error(`expected a CSV system, got an LDAP one`);
  return system.csv;
}

/** Host path of a CSV system's file. */
export function csvSystemPath(hostDir: string, system: SystemSpec): string {
  return resolve(process.cwd(), join(hostDir, csvConfig(system).fileName));
}

function quoteField(value: string): string {
  // quoteMode ALL in the resource config: every field is quoted, embedded
  // quotes doubled.
  return `"${value.replace(/"/g, '""')}"`;
}

/** Write a CSV file = header (column order) + the given rows. */
async function writeCsv(path: string, columns: string[], rows: CsvRow[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const lines = [columns.map(quoteField).join(",")];
  for (const row of rows) lines.push(columns.map((c) => quoteField(row[c] ?? "")).join(","));
  // Write atomically (temp + rename): the running system's CSV connector reads this same
  // file through a bind mount, and an in-place write can be read mid-flight — the
  // connector then fails with "EOF reached before encapsulated token finished".
  // rename swaps the complete file in, so a reader sees only old-complete or
  // new-complete, never a partial line.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, lines.join("\n") + "\n", "utf-8");
  await rename(tmp, path);
}

async function readRows(hostDir: string, system: SystemSpec): Promise<CsvRow[]> {
  return readCsvRecords(csvSystemPath(hostDir, system));
}

/** Reset a CSV system to a header-only (empty) file. */
export async function resetSource(hostDir: string, system: SystemSpec): Promise<void> {
  await writeCsv(csvSystemPath(hostDir, system), csvConfig(system).columns, []);
}

/** set: replace the file's full content with these rows. */
export async function setSource(hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  await writeCsv(csvSystemPath(hostDir, system), csvConfig(system).columns, rows);
}

/** add: insert NEW rows (by idColumn); error on an existing id. */
export async function addSourceRows(hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const { columns, idColumn } = csvConfig(system);
  const current = await readRows(hostDir, system);
  const ids = new Set(current.map((r) => r[idColumn]));
  for (const row of rows) {
    const id = row[idColumn];
    if (ids.has(id)) throw new Error(`add: ${idColumn}="${id}" already exists in source`);
    ids.add(id);
  }
  await writeCsv(csvSystemPath(hostDir, system), columns, [...current, ...rows]);
}

/** replace: update EXISTING rows by idColumn (full-row replace); error if absent. */
export async function replaceSourceRows(hostDir: string, system: SystemSpec, rows: CsvRow[]): Promise<void> {
  const { columns, idColumn } = csvConfig(system);
  const byId = new Map((await readRows(hostDir, system)).map((r) => [r[idColumn], r]));
  for (const row of rows) {
    const id = row[idColumn];
    if (!byId.has(id)) throw new Error(`replace: ${idColumn}="${id}" not found in source`);
    byId.set(id, row);
  }
  await writeCsv(csvSystemPath(hostDir, system), columns, [...byId.values()]);
}

/** remove: delete rows whose idColumn value is in `ids`. */
export async function removeSourceRows(hostDir: string, system: SystemSpec, ids: string[]): Promise<void> {
  const { columns, idColumn } = csvConfig(system);
  const drop = new Set(ids);
  const kept = (await readRows(hostDir, system)).filter((r) => !drop.has(r[idColumn] ?? ""));
  await writeCsv(csvSystemPath(hostDir, system), columns, kept);
}

/** Reset a CSV system used as a target to a header-only file. */
export async function resetCsvTarget(hostDir: string, target: SystemSpec): Promise<void> {
  await writeCsv(csvSystemPath(hostDir, target), csvConfig(target).columns, []);
}
