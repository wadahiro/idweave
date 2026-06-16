/**
 * Unit: the `<system>/<kind>` step-key prefix normalization (applySystemPrefix) — no
 * files, no stack. The loader rewrites a prefixed key to the bare kind with the system
 * injected into the handler's declared param, so handlers run unchanged.
 */
import { describe, it, expect } from "vitest";
import { applySystemPrefix, validateScenarioSystems } from "./loader.ts";
import type { LoadedScenario } from "./steps/types.ts";
import type { Suite } from "./suite.ts";

describe("applySystemPrefix", () => {
  it("injects into the value object for a nested step (delete-object → midpoint)", () => {
    const step: Record<string, unknown> = { "idm/delete-object": { name: "jdoe" } };
    applySystemPrefix(step);
    expect(step).toEqual({ "delete-object": { name: "jdoe", midpoint: "idm" } });
  });

  it("injects as a sibling for a flat step (mutate → system)", () => {
    const step: Record<string, unknown> = { "ldap/set": [{ uid: "a" }] };
    applySystemPrefix(step);
    expect(step).toEqual({ set: [{ uid: "a" }], system: "ldap" });
  });

  it("injects as a sibling for trigger (string value)", () => {
    const step: Record<string, unknown> = { "hr/trigger": "import" };
    applySystemPrefix(step);
    expect(step).toEqual({ trigger: "import", system: "hr" });
  });

  it("is a no-op for an un-prefixed step", () => {
    const step: Record<string, unknown> = { "delete-object": { name: "jdoe" } };
    applySystemPrefix(step);
    expect(step).toEqual({ "delete-object": { name: "jdoe" } });
  });

  it("rejects a prefix on a kind that does not opt in (clear-system)", () => {
    expect(() => applySystemPrefix({ "app/clear-system": "x" })).toThrow(/does not accept a "<system>\/" prefix/);
  });

  it("rejects an unknown kind", () => {
    expect(() => applySystemPrefix({ "idm/frobnicate": {} })).toThrow(/unknown step kind/);
  });

  it("rejects a prefix that also sets the param inline (nested)", () => {
    expect(() => applySystemPrefix({ "idm/delete-object": { name: "x", midpoint: "idm2" } })).toThrow(/also sets/);
  });

  it("rejects an empty prefix", () => {
    expect(() => applySystemPrefix({ "/delete-object": { name: "x" } })).toThrow(/empty system prefix/);
  });
});

describe("validateScenarioSystems", () => {
  // System kind only depends on which key is present (systemKind reads the key).
  const suite = {
    systems: { hr: { csv: {} }, dir: { ldap: {} }, store: { db: {} }, kc: { keycloak: {} } },
  } as unknown as Suite;

  // Build a one-step LoadedScenario carrying just what the validator reads.
  const scenarioWith = (step: Record<string, unknown>): LoadedScenario =>
    ({
      file: "/s/scenario.yaml",
      scenario: { id: "s", requirement: "R", steps: [step] },
      stepLines: [7],
    }) as unknown as LoadedScenario;

  it("passes a step naming a system its kind can act on (mutate on ldap)", () => {
    expect(() => validateScenarioSystems([scenarioWith({ set: [{ uid: "a" }], system: "dir" })], suite)).not.toThrow();
  });

  it("rejects a step naming a system its kind can't act on (mutate on db), with the source line", () => {
    expect(() => validateScenarioSystems([scenarioWith({ set: [{ uid: "a" }], system: "store" })], suite)).toThrow(
      /scenario\.yaml:7: step `mutate` cannot act on system "store" \(a db system\) — it applies to: csv, ldap, scim, keycloak/,
    );
  });

  it("rejects a nested-param mismatch (clear-focus targets a non-midpoint system)", () => {
    expect(() => validateScenarioSystems([scenarioWith({ "clear-focus": { name: "x", midpoint: "kc" } })], suite)).toThrow(
      /step `clear-focus` cannot act on system "kc" \(a keycloak system\)/,
    );
  });

  it("rejects an unknown system name", () => {
    expect(() => validateScenarioSystems([scenarioWith({ trigger: "import", system: "nope" })], suite)).toThrow(
      /names unknown system "nope"/,
    );
  });

  it("skips a step that names no system (resolved at run time)", () => {
    expect(() => validateScenarioSystems([scenarioWith({ set: [{ uid: "a" }] })], suite)).not.toThrow();
  });
});
