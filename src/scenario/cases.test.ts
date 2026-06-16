/**
 * Unit: parameterized-scenario expansion. Pure (no running stack): the {from-case}
 * resolution, the interpolation guardrail, and the case-template schema's
 * accept/reject behavior are the interesting parts.
 */
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { hasCases, expandCases, assertNoInterpolation, type ParameterizedScenario } from "./cases.ts";
import { buildCaseTemplateSchema } from "./steps/registry.ts";

const BASE: ParameterizedScenario = {
  id: "login-menu",
  requirement: "REQ-SSO-MENU-001",
  description: "Each user type sees only its authorized menu.",
  cases: [
    { name: "employee", as: "emp-rep", expected: "expected/menu.employee.json" },
    { name: "admin", as: "adm-rep", expected: "expected/menu.admin.json" },
  ],
  steps: [
    { "expect-menu": { as: { "from-case": "as" }, expected: { "from-case": "expected" } } },
  ],
};

describe("hasCases", () => {
  it("detects a cases table", () => {
    expect(hasCases(BASE)).toBe(true);
    expect(hasCases({ id: "x", requirement: "r", steps: [] })).toBe(false);
    expect(hasCases(null)).toBe(false);
    expect(hasCases({ cases: "not-an-array" })).toBe(false);
  });
});

describe("expandCases", () => {
  it("expands to one scenario per case with id[name] and resolved {from-case}", () => {
    const out = expandCases(BASE);
    expect(out.map((s) => s.id)).toEqual(["login-menu[employee]", "login-menu[admin]"]);
    expect(out[0]!.requirement).toBe("REQ-SSO-MENU-001");
    expect(out[0]!.description).toBe("Each user type sees only its authorized menu.");
    expect(out[0]!.steps).toEqual([
      { "expect-menu": { as: "emp-rep", expected: "expected/menu.employee.json" } },
    ]);
    expect(out[1]!.steps).toEqual([
      { "expect-menu": { as: "adm-rep", expected: "expected/menu.admin.json" } },
    ]);
  });

  it("does not mutate the template's steps", () => {
    const base = structuredClone(BASE);
    expandCases(base);
    expect(base.steps[0]).toEqual({
      "expect-menu": { as: { "from-case": "as" }, expected: { "from-case": "expected" } },
    });
  });

  it("throws when {from-case} references a field absent from the case", () => {
    const bad: ParameterizedScenario = {
      ...BASE,
      cases: [{ name: "employee", as: "emp-rep" }],
      steps: [{ "expect-menu": { as: { "from-case": "as" }, expected: { "from-case": "expected" } } }],
    };
    expect(() => expandCases(bad)).toThrow(/from-case: expected.*absent from case "employee"/s);
  });

  it("lets a case override the base requirement (traceability)", () => {
    const perCase: ParameterizedScenario = {
      id: "menu",
      requirement: "REQ-BASE",
      cases: [
        { name: "administrator", requirement: "REQ-SSO-MENU-001", expected: "expected/menu.administrator.json" },
        { name: "enduser", expected: "expected/menu.enduser.json" },
      ],
      steps: [{ "expect-menu": { as: { "from-case": "name" }, expected: { "from-case": "expected" } } }],
    };
    const out = expandCases(perCase);
    expect(out[0]!.requirement).toBe("REQ-SSO-MENU-001"); // overridden
    expect(out[1]!.requirement).toBe("REQ-BASE"); // falls back to base
  });

  it("throws when a case has no requirement and no base requirement is declared", () => {
    const noReq: ParameterizedScenario = {
      id: "menu",
      cases: [{ name: "administrator", expected: "x" }],
      steps: [{ "expect-menu": { as: { "from-case": "name" }, expected: { "from-case": "expected" } } }],
    };
    expect(() => expandCases(noReq)).toThrow(/no requirement/);
  });

  it("throws on a duplicate case name", () => {
    const dup: ParameterizedScenario = {
      ...BASE,
      cases: [
        { name: "employee", as: "a", expected: "x" },
        { name: "employee", as: "b", expected: "y" },
      ],
    };
    expect(() => expandCases(dup)).toThrow(/Duplicate case name "employee"/);
  });
});

describe("assertNoInterpolation", () => {
  it("passes a template that uses only {from-case}", () => {
    expect(() => assertNoInterpolation(BASE.steps)).not.toThrow();
  });

  it("rejects {{...}} interpolation anywhere in the steps", () => {
    expect(() => assertNoInterpolation([{ "expect-menu": { as: "{{login}}" } }])).toThrow(/Interpolation is not allowed/);
    expect(() => assertNoInterpolation([{ set: [{ login: "x-{{y}}" }] }])).toThrow(/Interpolation is not allowed/);
  });
});

describe("case-template schema", () => {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(buildCaseTemplateSchema());

  it("accepts a well-formed parameterized template", () => {
    expect(validate(BASE)).toBe(true);
  });

  it("rejects a case field whose value is not a string", () => {
    expect(validate({ ...BASE, cases: [{ name: "employee", as: 42 }] })).toBe(false);
  });

  it("rejects a case missing a name", () => {
    expect(validate({ ...BASE, cases: [{ as: "emp-rep" }] })).toBe(false);
  });

  it("rejects a bad case-name pattern", () => {
    expect(validate({ ...BASE, cases: [{ name: "Has Space", as: "x" }] })).toBe(false);
  });

  it("rejects an empty cases table", () => {
    expect(validate({ ...BASE, cases: [] })).toBe(false);
  });
});
