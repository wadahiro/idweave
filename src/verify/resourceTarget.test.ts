/**
 * Unit: projectResourceObject — projecting the attribute record read through the
 * connector (as the executeScript returns it: `{ attr: [values] }`) into the stable
 * record the check asserts. No midPoint.
 */
import { describe, it, expect } from "vitest";
import { projectResourceObject } from "./resourceTarget.ts";

// As the read script returns it: local-name keys, string-array values.
const ATTRS: Record<string, unknown> = {
  login: ["carol"],
  firstname: ["Carol"],
  lastname: ["Req"],
  email: ["carol@example.com"],
  groups: ["b", "a", "c"],
};

describe("projectResourceObject", () => {
  it("with an allowlist keeps only declared attributes, sorting multi-valued ones", () => {
    const out = projectResourceObject(ATTRS, ["login", "email", "groups"]);
    expect(out).toEqual({ login: ["carol"], email: ["carol@example.com"], groups: ["a", "b", "c"] });
  });

  it("without an allowlist keeps every attribute, dropping @-meta keys", () => {
    const out = projectResourceObject({ ...ATTRS, "@ns": "x" });
    expect(out).toEqual({
      login: ["carol"],
      firstname: ["Carol"],
      lastname: ["Req"],
      email: ["carol@example.com"],
      groups: ["a", "b", "c"],
    });
    expect((out as Record<string, unknown>)["@ns"]).toBeUndefined();
  });

  it("masks a declared attribute's value to a stable token", () => {
    const out = projectResourceObject(ATTRS, ["login", "email"], ["email"]);
    expect(out).toEqual({ login: ["carol"], email: "<dynamic>" });
  });

  it("omits a declared attribute the object does not have, and an empty-array attribute", () => {
    const out = projectResourceObject({ login: ["carol"], title: [] }, ["login", "title", "missing"]);
    expect(out).toEqual({ login: ["carol"] });
  });

  it("returns empty for an object with no attributes", () => {
    expect(projectResourceObject({})).toEqual({});
  });
});
