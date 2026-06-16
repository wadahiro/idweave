/** Unit: the step registry invariants and the assembled scenario schema. */
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { STEP_HANDLERS, handlerFor, buildScenarioSchema } from "./registry.ts";
import type { DescribeContext } from "./types.ts";

const SAMPLES: Array<[kind: string, step: unknown]> = [
  ["mutate", { set: [{ login: "a" }] }],
  ["mutate", { add: [{ login: "a" }] }],
  ["mutate", { replace: [{ login: "a" }] }],
  ["mutate", { remove: ["a"] }],
  ["mutate", { set: { file: "x.csv" } }],
  ["trigger", { trigger: "import" }],
  ["trigger", { trigger: "recon" }],
  ["assign", { assign: { user: "u", role: "r" } }],
  ["unassign", { unassign: { user: "u", role: "r" } }],
  ["expect", { expect: { objects: [{ type: "user", name: "u", absent: true }] } }],
];

const describeCtx = { suite: { sources: { hr: {} }, targets: {} } } as unknown as DescribeContext;

describe("step registry", () => {
  it("has unique kinds", () => {
    const kinds = STEP_HANDLERS.map((h) => h.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("assembles a JSON Schema that compiles", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    expect(() => ajv.compile(buildScenarioSchema())).not.toThrow();
  });

  it("routes each sample step to exactly one handler", () => {
    for (const [kind, step] of SAMPLES) {
      const matched = STEP_HANDLERS.filter((h) => h.match(step)).map((h) => h.kind);
      expect(matched).toEqual([kind]);
      expect(handlerFor(step)?.kind).toBe(kind);
    }
  });

  it("renders token/detail as strings without throwing", () => {
    for (const [, step] of SAMPLES) {
      const h = handlerFor(step)!;
      expect(typeof h.token(step)).toBe("string");
      expect(typeof h.detail(step, describeCtx)).toBe("string");
    }
  });

  it("exposes assertions only for the expect handler", () => {
    const withAssertions = STEP_HANDLERS.filter((h) => h.assertions).map((h) => h.kind);
    expect(withAssertions).toEqual(["expect"]);
  });
});

describe("scenario schema validation", () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(buildScenarioSchema());
  const base = { id: "x", requirement: "REQ-1" };

  it("accepts a valid multi-step scenario", () => {
    const ok = validate({
      ...base,
      steps: [
        { set: [{ login: "jdoe" }] },
        { trigger: "import" },
        { assign: { user: "jdoe", role: "App" } },
        { expect: { objects: [{ type: "user", name: "jdoe", expected: "u.json" }] } },
      ],
    });
    expect(ok).toBe(true);
  });

  it("rejects a mutate step with two operations", () => {
    expect(validate({ ...base, steps: [{ set: [], remove: ["a"] }] })).toBe(false);
  });

  it("rejects an unknown step key", () => {
    expect(validate({ ...base, steps: [{ frobnicate: {} }] })).toBe(false);
  });

  it("accepts an optional setup block (same step contract)", () => {
    const ok = validate({
      ...base,
      setup: [{ "clear-system": "app-target" }, { "delete-object": { name: "jdoe", raw: true } }],
      steps: [{ set: [{ login: "jdoe" }] }],
    });
    expect(ok).toBe(true);
  });

  it("validates setup steps with the same contract (rejects an unknown setup step)", () => {
    expect(validate({ ...base, setup: [{ frobnicate: {} }], steps: [{ trigger: "import" }] })).toBe(false);
  });

  it("rejects an expect object with neither expected nor absent", () => {
    expect(validate({ ...base, steps: [{ expect: { objects: [{ type: "user", name: "u" }] } }] })).toBe(false);
  });

  it("accepts an expect account whole-set assertion (`all: true` + expected, no identifier)", () => {
    const ok = validate({ ...base, steps: [{ expect: { accounts: [{ system: "ldap", all: true, expected: "all.json" }] } }] });
    expect(ok).toBe(true);
  });

  it("rejects an expect account with neither identifier nor all", () => {
    expect(validate({ ...base, steps: [{ expect: { accounts: [{ system: "ldap", expected: "u.json" }] } }] })).toBe(false);
  });

  it("rejects an empty steps array", () => {
    expect(validate({ ...base, steps: [] })).toBe(false);
  });
});
