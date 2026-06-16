/**
 * Unit: assign/unassign handlers run with an injected fake RunContext — no running stack.
 * Demonstrates the testability the registry split buys: a handler is pure glue
 * over actions verbs, exercised by asserting the REST deltas it issues.
 */
import { describe, it, expect } from "vitest";
import { assignStep } from "./assign.ts";
import { unassignStep } from "./unassign.ts";
import type { RunContext } from "./types.ts";

interface ModifyCall { type: string; oid: string; delta: Array<Record<string, unknown>>; }

function ctxWith(rest: Record<string, unknown>): RunContext {
  return { rest } as unknown as RunContext;
}

describe("assign handler", () => {
  it("adds an assignment targeting the resolved user and role", async () => {
    const calls: ModifyCall[] = [];
    const rest = {
      searchByName: async (type: string) => (type === "users" ? [{ oid: "user-1" }] : [{ oid: "role-1" }]),
      modifyObject: async (type: string, oid: string, delta: ModifyCall["delta"]) => { calls.push({ type, oid, delta }); },
    };
    await assignStep.run({ assign: { user: "jdoe", role: "App" } }, ctxWith(rest));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "users", oid: "user-1" });
    expect(calls[0]!.delta[0]).toMatchObject({
      modificationType: "add",
      path: "assignment",
      value: { targetRef: { oid: "role-1", type: "RoleType" } },
    });
  });

  it("throws when the user is not found", async () => {
    const rest = { searchByName: async () => [] };
    await expect(assignStep.run({ assign: { user: "ghost", role: "App" } }, ctxWith(rest)))
      .rejects.toThrow(/not found/);
  });
});

describe("unassign handler", () => {
  it("deletes the assignment matching the role, by container @id", async () => {
    const calls: ModifyCall[] = [];
    const rest = {
      searchByName: async (type: string) => (type === "users" ? [{ oid: "user-1" }] : [{ oid: "role-1" }]),
      getObject: async () => ({
        assignment: [
          { "@id": 7, targetRef: { oid: "role-1" } },
          { "@id": 8, targetRef: { oid: "other-role" } },
        ],
      }),
      modifyObject: async (type: string, oid: string, delta: ModifyCall["delta"]) => { calls.push({ type, oid, delta }); },
    };
    await unassignStep.run({ unassign: { user: "jdoe", role: "App" } }, ctxWith(rest));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.delta[0]).toMatchObject({
      modificationType: "delete",
      path: "assignment",
      value: { "@id": 7 },
    });
  });

  it("throws when the role has no matching assignment", async () => {
    const rest = {
      searchByName: async (type: string) => (type === "users" ? [{ oid: "user-1" }] : [{ oid: "role-1" }]),
      getObject: async () => ({ assignment: [{ "@id": 8, targetRef: { oid: "other-role" } }] }),
    };
    await expect(unassignStep.run({ unassign: { user: "jdoe", role: "App" } }, ctxWith(rest)))
      .rejects.toThrow(/No assignment/);
  });
});
