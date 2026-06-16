/**
 * Unit: group manifest — the JSON Schema and the pure order helpers
 * (validateGroupOrder / orderIndexOf / baseScenarioId). No filesystem.
 */
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import {
  buildGroupSchema, validateGroupOrder, orderIndexOf, baseScenarioId, type Group,
} from "./group.ts";

const chain: Group = {
  id: "employee-lifecycle",
  reset: "none",
  order: ["joiner", "mover", "leaver"],
  dir: "/abs/jml/employee-lifecycle",
};

describe("group schema", () => {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(buildGroupSchema());

  it("accepts a well-formed group", () => {
    expect(validate({ id: "employee-lifecycle", reset: "none", order: ["joiner", "leaver"] })).toBe(true);
    expect(validate({ id: "g", reset: "none", order: ["a"] })).toBe(true);
  });

  it("requires id and reset", () => {
    expect(validate({ reset: "none", order: ["a"] })).toBe(false);
    expect(validate({ id: "g" })).toBe(false);
  });

  it("rejects an unknown reset policy (including the dropped 'snapshot')", () => {
    expect(validate({ id: "g", reset: "per-scenario" })).toBe(false);
    expect(validate({ id: "g", reset: "snapshot" })).toBe(false);
  });

  it("rejects a bad id pattern and unknown properties (incl. the dropped 'baseline')", () => {
    expect(validate({ id: "Has Space", reset: "none", order: ["a"] })).toBe(false);
    expect(validate({ id: "g", reset: "none", order: ["a"], produces: "x" })).toBe(false);
    expect(validate({ id: "g", reset: "none", order: ["a"], baseline: "std" })).toBe(false);
  });
});

describe("validateGroupOrder", () => {
  it("passes when order is a permutation of the members", () => {
    expect(() => validateGroupOrder(chain, ["leaver", "joiner", "mover"])).not.toThrow();
  });

  it("throws when order lists a member that does not exist", () => {
    // order has leaver, but the discovered members do not → unknown.
    expect(() => validateGroupOrder(chain, ["joiner", "mover"])).toThrow(/unknown member\(s\): leaver/);
  });

  it("throws when a member is missing from order", () => {
    // rehire is a member but absent from order.
    expect(() => validateGroupOrder(chain, ["joiner", "mover", "leaver", "rehire"])).toThrow(
      /absent from order: rehire/,
    );
  });

  it("throws on a duplicate id in order", () => {
    const dup: Group = { ...chain, order: ["joiner", "joiner", "mover", "leaver"] };
    expect(() => validateGroupOrder(dup, ["joiner", "mover", "leaver"])).toThrow(/duplicate id in `order`/);
  });

  it("is a no-op when no order is declared", () => {
    const unordered: Group = { id: "v", reset: "none", dir: "/abs/v" };
    expect(() => validateGroupOrder(unordered, ["a", "b"])).not.toThrow();
  });
});

describe("orderIndexOf", () => {
  it("returns the position in the order", () => {
    expect(orderIndexOf(chain, "joiner")).toBe(0);
    expect(orderIndexOf(chain, "leaver")).toBe(2);
  });
  it("returns 0 when unordered or unknown", () => {
    expect(orderIndexOf({ ...chain, order: undefined }, "mover")).toBe(0);
    expect(orderIndexOf(chain, "unknown")).toBe(0);
  });
});

describe("baseScenarioId", () => {
  it("strips a [case] suffix and leaves a plain id untouched", () => {
    expect(baseScenarioId("menu[administrator]")).toBe("menu");
    expect(baseScenarioId("joiner-basic")).toBe("joiner-basic");
  });
});
