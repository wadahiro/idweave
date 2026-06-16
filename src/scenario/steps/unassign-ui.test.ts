/**
 * Unit: the unassign-ui step — no running stack, no browser. Covers the declaration
 * surface (match/token/detail/schema, incl. the exactly-one-target oneOf) and that `run`
 * resolves the externally-tagged target and drives the admin-assign page object's
 * `unassign` as the named operator with the GUI password.
 */
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { unassignUiStep } from "./unassign-ui.ts";
import type { RunContext } from "./types.ts";

const validate = new Ajv({ allErrors: true, strict: false }).compile(unassignUiStep.schema);

describe("unassign-ui step", () => {
  it("matches its own declaration and nothing else", () => {
    expect(unassignUiStep.match({ "unassign-ui": { as: "administrator", user: "alice", role: "R" } })).toBe(true);
    expect(unassignUiStep.match({ "assign-ui": { as: "administrator", user: "alice", role: "R" } })).toBe(false);
    expect(unassignUiStep.match(null)).toBe(false);
  });

  it("renders a token and a one-line detail naming target + user + operator", () => {
    const step = { "unassign-ui": { as: "administrator", user: "alice", role: "Catalog Browser" } };
    expect(unassignUiStep.token(step)).toBe("unassign-ui");
    const d = unassignUiStep.detail(step, { suite: {} as never });
    expect(d).toContain("Catalog Browser");
    expect(d).toContain("alice");
    expect(d).toContain("administrator");
  });

  it("accepts exactly one target and rejects zero, two, or a missing user (schema)", () => {
    expect(validate({ "unassign-ui": { as: "a", user: "u", role: "R" } })).toBe(true);
    expect(validate({ "unassign-ui": { as: "a", user: "u", org: "O" } })).toBe(true);
    expect(validate({ "unassign-ui": { as: "a", user: "u", service: "S" } })).toBe(true);
    expect(validate({ "unassign-ui": { as: "a", user: "u" } })).toBe(false); // no target
    expect(validate({ "unassign-ui": { as: "a", user: "u", role: "R", org: "O" } })).toBe(false); // two targets
    expect(validate({ "unassign-ui": { as: "a", role: "R" } })).toBe(false); // no user
  });

  it("drives the admin-assign page object's unassign with the resolved (kind, name) as the operator", async () => {
    const calls: unknown[][] = [];
    const session = { adminAssign: { unassign: async (...args: unknown[]) => void calls.push(args) } };
    const ctx = {
      ui: { sessionFor: async () => session },
      cfg: { gui: { password: "s3cret" } },
      suite: { systems: {} }, // no per-principal password → shared GUI_PASSWORD
    } as unknown as RunContext;
    await unassignUiStep.run({ "unassign-ui": { as: "administrator", user: "alice", role: "Catalog Browser" } }, ctx);
    expect(calls).toEqual([["alice", "role", "Catalog Browser"]]);
  });

  it("errors clearly when the GUI version has no admin-assign page object", async () => {
    const ctx = {
      ui: { sessionFor: async () => ({}) }, // session without adminAssign
      cfg: { gui: { password: "s3cret" } },
      suite: { systems: {} },
    } as unknown as RunContext;
    await expect(
      unassignUiStep.run({ "unassign-ui": { as: "administrator", user: "alice", org: "Some Org" } }, ctx),
    ).rejects.toThrow(/admin-assign page object/);
  });
});
