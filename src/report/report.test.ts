/** Unit: the junit/ctrf reporters render a SuiteResult correctly (pure, no running stack). */
import { describe, it, expect } from "vitest";
import { renderJUnit } from "./junit.ts";
import { buildCtrf } from "./ctrf.ts";
import type { SuiteResult } from "../scenario/runSuite.ts";

const RESULT: SuiteResult = {
  tests: [
    { id: "joiner-basic", requirement: "REQ-1", file: "/s/a.yaml", status: "passed", durationMs: 1200 },
    {
      id: "mover-rename",
      requirement: "REQ-2",
      file: "/s/b.yaml",
      status: "failed",
      durationMs: 800,
      message: 'Expected mismatch:\n  fullName: expected "A & B" <x>, actual "C"',
    },
    {
      id: "leaver-delete",
      requirement: "REQ-3",
      file: "/s/c.yaml",
      status: "skipped",
      durationMs: 0,
      message: 'blocked: an earlier scenario in chain "jml" failed',
    },
  ],
  summary: { total: 3, passed: 1, failed: 1, skipped: 1, start: 1000, stop: 3000 },
};

describe("renderJUnit", () => {
  const xml = renderJUnit(RESULT);
  it("reports suite + case counts and times", () => {
    expect(xml).toContain('<testsuites name="idweave" tests="3" failures="1" skipped="1" time="2.000">');
    expect(xml).toContain('name="joiner-basic [REQ-1]"');
    expect(xml).toContain('time="1.200"');
  });
  it("emits a self-closing testcase for a pass, a <failure> for a fail, a <skipped> for a skip", () => {
    expect(xml).toMatch(/name="joiner-basic \[REQ-1\]"[^>]*\/>/);
    expect(xml).toContain("<failure message=");
    expect(xml).toContain("</failure>");
    expect(xml).toMatch(/name="leaver-delete \[REQ-3\]"[^>]*>\n\s*<skipped message="blocked: an earlier[^"]*" \/>/);
  });
  it("collapses the message attribute to one line but keeps full text in the body", () => {
    expect(xml).toContain('message="Expected mismatch: · fullName:'); // newline -> " · "
    expect(xml).toMatch(/<failure[^>]*>Expected mismatch:\n/); // body keeps the newline
  });
  it("XML-escapes special characters", () => {
    expect(xml).toContain("&amp;"); // & in "A & B"
    expect(xml).toContain("&lt;x&gt;"); // <x>
    expect(xml).not.toMatch(/expected "A & B"/); // raw & must not survive
  });
});

describe("buildCtrf", () => {
  const ctrf = buildCtrf(RESULT) as {
    results: { tool: { name: string }; summary: Record<string, number>; tests: Array<Record<string, unknown>> };
  };
  it("uses the idweave tool name and a correct summary", () => {
    expect(ctrf.results.tool.name).toBe("idweave");
    expect(ctrf.results.summary).toMatchObject({ tests: 3, passed: 1, failed: 1, skipped: 1, start: 1000, stop: 3000 });
  });
  it("maps each scenario with status/duration/filePath, message only on failures", () => {
    expect(ctrf.results.tests[0]).toMatchObject({
      name: "joiner-basic [REQ-1]",
      status: "passed",
      duration: 1200,
      filePath: "/s/a.yaml",
    });
    expect(ctrf.results.tests[0]!.message).toBeUndefined();
    expect(ctrf.results.tests[1]!.message).toContain("Expected mismatch");
  });
});
