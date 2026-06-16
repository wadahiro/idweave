/**
 * CTRF JSON reporter — the tool-agnostic shape the harness already consumes
 * (results.{tool,summary,tests}; the offline triage hook reads it). Written
 * directly from a SuiteResult, parallel to the JUnit reporter.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SuiteResult } from "../scenario/runSuite.ts";

export function buildCtrf(result: SuiteResult): unknown {
  const { summary, tests } = result;
  return {
    results: {
      tool: { name: "idweave" },
      summary: {
        tests: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        pending: 0,
        skipped: summary.skipped,
        other: 0,
        start: summary.start,
        stop: summary.stop,
      },
      tests: tests.map((t) => ({
        name: `${t.id} [${t.requirement}]`,
        status: t.status,
        duration: t.durationMs,
        filePath: t.file,
        ...(t.message ? { message: t.message } : {}),
      })),
    },
  };
}

export async function writeCtrf(result: SuiteResult, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(buildCtrf(result), null, 2) + "\n", "utf-8");
}
