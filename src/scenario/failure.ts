/**
 * scenario — failure location + developer-facing failure reporting.
 *
 * When a step throws, the runner tags the error with WHERE it failed (scenario,
 * step index, scenario.yaml line). `reportFailure` then renders that to the
 * console — the failing step in source, a git-style diff — shared by every
 * entry point (the vitest self-test and the `run` CLI), so they look the
 * same. The tag is non-enumerable so runners that dump an error's own properties
 * (some runners) do not echo it.
 */
import { readFileSync } from "node:fs";
import type { StepFailureLocation } from "./steps/types.ts";
import { ExpectedMismatchError, renderUnifiedDiff } from "../verify/expected.ts";
import { codeFrame } from "../util/codeFrame.ts";
import { fileLink } from "../util/terminal.ts";

const KEY = "stepLocation";

export function attachStepLocation(err: unknown, location: StepFailureLocation): unknown {
  if (err instanceof Error) {
    Object.defineProperty(err, KEY, { value: location, enumerable: false, configurable: true });
  }
  return err;
}

export function getStepLocation(err: unknown): StepFailureLocation | undefined {
  if (!(err instanceof Error)) return undefined;
  return (err as { stepLocation?: StepFailureLocation }).stepLocation;
}

/** Strip the listing's Markdown emphasis/backticks for a plain console one-liner. */
export function plainDetail(markdown: string): string {
  return markdown.replace(/[*`]/g, "").trim();
}

/**
 * Trim a leading echo of the step kind from its detail, so a header reads
 * "expect" (not "expect — expect") and "assign — role X" (not "assign — assign
 * role X").
 */
export function dropIfKind(detail: string, kind: string): string {
  if (detail === kind) return "";
  return detail.startsWith(`${kind} `) ? detail.slice(kind.length + 1) : detail;
}

/**
 * Render developer-facing failure diagnostics to the console (never to JUnit/CTRF
 * — the error `message` stays plain there). Points at the failing step in
 * scenario.yaml (clickable line + source excerpt, with the immediately preceding
 * step as context for an `expect`), then, for an expectation mismatch, a
 * git-style colored expected/actual diff and the dump link (if dumping is on).
 */
export function reportFailure(err: unknown): void {
  const tty = Boolean(process.stdout.isTTY);
  const loc = getStepLocation(err);
  if (loc) {
    const s = loc.step;
    const detail = s.detail ? ` — ${s.detail}` : "";
    console.error(`\n✗ ${loc.scenarioId} · step ${s.index + 1}/${s.count}: ${s.kind}${detail}`);
    if (s.line > 0) {
      console.error(`  ${fileLink(`${loc.file}:${s.line}`, tty)}`);
      // One contiguous excerpt with the failing step marked. For an `expect`,
      // begin at the preceding step (adjacent in the file) — that prior action
      // produced the asserted state, so it's usually where the real problem is.
      const from = s.kind === "expect" && loc.prev?.line ? loc.prev.line : s.line;
      try {
        console.error(codeFrame(readFileSync(loc.file, "utf-8"), from, s.endLine, { markLine: s.line }));
      } catch {
        /* best-effort source excerpt */
      }
    }
  }
  if (err instanceof ExpectedMismatchError) {
    console.error("\n" + renderUnifiedDiff(err.expected, err.actual));
    if (err.dumpDir) console.error(`↳ dump: ${fileLink(err.dumpDir, tty)}`);
  }
}
