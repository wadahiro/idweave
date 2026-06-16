/**
 * Unit: cross-system consistency check — derive from a focus property via the
 * `fields` transform and compare as an order-independent, de-duplicated set; token
 * on match, actual on mismatch. Covers ldap (multi-value) and db (listSeparator).
 */
import { describe, it, expect } from "vitest";
import { checkConsistency, type ConsistencyRule } from "./consistency.ts";

const CC = "15/15-uuid/fp/20260101000000/20270101000000"; // a focus externalRef value
const TOKEN = "<consistent:extension/externalRef>";

describe("checkConsistency", () => {
  it("named fields: ldap x-externalRef = {a}/{b}/{c}", () => {
    const rule: ConsistencyRule = {
      from: "extension/externalRef",
      delimited: { delimiter: "/", names: ["a", "b", "c"], format: "{a}/{b}/{c}" },
    };
    expect(checkConsistency("15/15-uuid/fp", [CC], rule)).toBe(TOKEN);
  });

  it("positional index format works without names", () => {
    const rule: ConsistencyRule = { from: "extension/externalRef", delimited: { delimiter: "/", format: "{0}/{1}" } };
    expect(checkConsistency("15/15-uuid", [CC], rule)).toBe(TOKEN);
  });

  it("multi-value source/target compared as an order-independent set", () => {
    const rule: ConsistencyRule = {
      from: "extension/externalRef",
      delimited: { delimiter: "/", names: ["a", "b"], format: "{a}/{b}" },
    };
    expect(
      checkConsistency(["15/15-b/fpB", "15/15-a/fpA"].map((x) => x), ["15/15-a/fpA/s/e", "15/15-b/fpB/s/e"], {
        ...rule,
        delimited: { delimiter: "/", names: ["a", "b", "c"], format: "{a}/{b}/{c}" },
      }),
    ).toBe(TOKEN);
  });

  it("listSeparator: a comma-packed single target field is split into a set", () => {
    const rule: ConsistencyRule = {
      from: "extension/externalRef",
      listSeparator: ",",
      delimited: { delimiter: "/", names: ["a", "b"], format: "{a}/{b}" },
    };
    expect(checkConsistency("15/15-uuid", [CC], rule)).toBe(TOKEN);
    expect(
      checkConsistency("15/15-b,15/15-a", ["15/15-a/fpA/s/e", "15/15-b/fpB/s/e"], rule),
    ).toBe(TOKEN);
  });

  it("leaves the actual value (so it diffs) on mismatch", () => {
    const rule: ConsistencyRule = {
      from: "extension/externalRef",
      delimited: { delimiter: "/", names: ["a", "b"], format: "{a}/{b}" },
    };
    expect(checkConsistency("15/15-wrong", [CC], rule)).toBe("15/15-wrong");
  });

  it("returns undefined when the value is absent", () => {
    const rule: ConsistencyRule = { from: "x", delimited: { delimiter: "/", format: "{0}" } };
    expect(checkConsistency(undefined, [CC], rule)).toBeUndefined();
  });

  it("treats an empty actual as absent — never 'consistent' with an empty focus", () => {
    // Regression: an absent target attribute (empty array) and an absent focus must
    // NOT match as two empty sets and emit the token — that reported a phantom value.
    const rule: ConsistencyRule = { from: "extension/externalRef", delimited: { delimiter: "/", format: "{0}" } };
    expect(checkConsistency([], [], rule)).toBeUndefined();
    expect(checkConsistency("", [], rule)).toBeUndefined();
    expect(checkConsistency([], [CC], rule)).toBeUndefined();
  });
});
