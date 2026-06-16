/**
 * Unit: expect-fields editable-set comparison (evaluateFields) — pure, no browser.
 */
import { describe, it, expect } from "vitest";
import { evaluateFields } from "./expect-fields.ts";
import type { ProfileField } from "../../clients/ui/contract.ts";

const fields = (...spec: [string, boolean][]): ProfileField[] => spec.map(([label, editable]) => ({ label, editable }));

describe("evaluateFields", () => {
  it("passes when the editable set matches exactly (order-free)", () => {
    const obs = fields(["Family Name", true], ["Given Name", true], ["Email", false]);
    expect(evaluateFields(obs, ["Given Name", "Family Name"])).toEqual([]);
  });

  it("passes when nothing is editable and [] is asserted", () => {
    const obs = fields(["Family Name", false], ["Email", false]);
    expect(evaluateFields(obs, [])).toEqual([]);
  });

  it("flags a field expected editable but read-only", () => {
    const obs = fields(["Family Name", false]);
    expect(evaluateFields(obs, ["Family Name"]).join()).toMatch(/expected editable but NOT: Family Name/);
  });

  it("flags an unexpectedly editable field", () => {
    const obs = fields(["Family Name", true], ["Company", true]);
    expect(evaluateFields(obs, ["Family Name"]).join()).toMatch(/editable but UNEXPECTED: Company/);
  });

  it("reports both missing and unexpected", () => {
    const obs = fields(["Company", true]);
    const f = evaluateFields(obs, ["Family Name"]);
    expect(f.join()).toMatch(/expected editable but NOT: Family Name/);
    expect(f.join()).toMatch(/editable but UNEXPECTED: Company/);
  });
});
