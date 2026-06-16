/**
 * JUnit XML reporter — written directly from a SuiteResult (the `run` CLI path
 * doesn't go through the test runner, so it emits its own report). The `<failure>`
 * message is the scenario's plain, escape-free error message; rich diagnostics
 * (colors, diffs, code frames) are console-only, never in the artifact.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SuiteResult } from "../scenario/runSuite.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderJUnit(result: SuiteResult): string {
  const { tests, summary } = result;
  const suiteTime = ((summary.stop - summary.start) / 1000).toFixed(3);
  const cases = tests
    .map((t) => {
      const open =
        `    <testcase name="${esc(`${t.id} [${t.requirement}]`)}"` +
        ` classname="${esc(t.id)}" file="${esc(t.file)}" time="${(t.durationMs / 1000).toFixed(3)}"`;
      if (t.status === "passed") return `${open} />`;
      if (t.status === "skipped") {
        const reason = esc((t.message ?? "skipped").replace(/\s*\n\s*/g, " · "));
        return `${open}>\n      <skipped message="${reason}" />\n    </testcase>`;
      }
      const message = t.message ?? "failed";
      // Attribute = one line (CI tools render it inline); full text in the body.
      const attr = esc(message.replace(/\s*\n\s*/g, " · "));
      return `${open}>\n      <failure message="${attr}">${esc(message)}</failure>\n    </testcase>`;
    })
    .join("\n");
  const head = `tests="${summary.total}" failures="${summary.failed}" skipped="${summary.skipped}" time="${suiteTime}"`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="idweave" ${head}>\n` +
    `  <testsuite name="connected scenarios" ${head}>\n` +
    `${cases}\n` +
    `  </testsuite>\n` +
    `</testsuites>\n`
  );
}

export async function writeJUnit(result: SuiteResult, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderJUnit(result), "utf-8");
}
