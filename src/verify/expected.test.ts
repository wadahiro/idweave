/** Unit: the git-style expected/actual diff renderer (pure, no running stack). */
import { describe, it, expect } from "vitest";
import { renderUnifiedDiff, compareToExpected } from "./expected.ts";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderUnifiedDiff", () => {
  it("marks expected lines with - and actual lines with +, keeping context", () => {
    const out = strip(renderUnifiedDiff({ a: 1, b: "x" }, { a: 1, b: "y" }));
    expect(out).toContain('-   "b": "x"'); // expected (committed)
    expect(out).toContain('+   "b": "y"'); // actual (live system)
    expect(out).toContain('"a": 1'); // unchanged context, no -/+
    expect(out).toContain("- expected (committed)");
    expect(out).toContain("+ actual (live system)");
  });

  it("shows added/removed array elements", () => {
    const out = strip(renderUnifiedDiff({ orgs: ["Eng"] }, { orgs: ["Eng", "Sales"] }));
    expect(out).toContain('+     "Sales"');
  });
});

describe("compareToExpected — order-insensitive arrays", () => {
  it("matches multi-value arrays regardless of order (scalars)", () => {
    expect(compareToExpected({ subtype: ["b", "a", "c"] }, { subtype: ["a", "b", "c"] }).match).toBe(true);
  });

  it("matches arrays of objects (assignment/inducement) regardless of order", () => {
    const expected = { assignment: [{ target: "metarole" }, { target: "Eng", type: "OrgType" }] };
    const actual = { assignment: [{ target: "Eng", type: "OrgType" }, { target: "metarole" }] };
    expect(compareToExpected(actual, expected).match).toBe(true);
  });

  it("still flags a genuinely different element set (missing / extra)", () => {
    const r = compareToExpected({ inducement: [{ s: "role-a" }] }, { inducement: [{ s: "role-a" }, { s: "role-b" }] });
    expect(r.match).toBe(false);
  });

  it("still flags a value difference inside an otherwise-aligned array", () => {
    const r = compareToExpected({ a: [{ k: "x", v: 1 }] }, { a: [{ k: "x", v: 2 }] });
    expect(r.match).toBe(false);
  });
});
