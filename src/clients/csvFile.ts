/**
 * clients — CSV file reader (protocol adapter for a CSV target system).
 *
 * Reads the real CSV file the running system provisions into, so the check asserts the
 * external end-state (by design), not midPoint's shadow. No test logic here.
 */
import { readFile } from "node:fs/promises";

/** Parse RFC-4180-ish CSV (quoted fields, "" escaping) into rows of fields. */
export function parseCsv(text: string, delimiter = ",", quote = '"'): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let started = false; // distinguishes a trailing empty line from a real row

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    started = true;
    if (inQuotes) {
      if (c === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === quote) {
      inQuotes = true;
    } else if (c === delimiter) {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else if (c === "\r") {
      // ignore; handled by the following \n
    } else {
      field += c;
    }
  }
  if (started || field.length > 0 || row.length > 0) pushRow();
  return rows;
}

export type CsvRecord = Record<string, string>;

/** Read a CSV file into records keyed by its header row. Missing file -> []. */
export async function readCsvRecords(
  filePath: string,
  delimiter = ",",
  quote = '"',
): Promise<CsvRecord[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const rows = parseCsv(text, delimiter, quote).filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return [];
  const header = rows[0]!;
  return rows.slice(1).map((cols) => {
    const rec: CsvRecord = {};
    header.forEach((h, idx) => {
      rec[h] = cols[idx] ?? "";
    });
    return rec;
  });
}
