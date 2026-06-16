/**
 * Unit: set-assignment handler — seeds the selected assignment's validTo/validFrom
 * by container id, resolving relative dates against the injected clock, raw by
 * default. No running stack; asserts the REST delta it issues.
 */
import { describe, it, expect } from "vitest";
import { setAssignmentStep } from "./set-assignment.ts";
import type { RunContext } from "./types.ts";

const NOW = Date.UTC(2026, 5, 5, 12, 0, 0); // 2026-06-05T12:00:00Z

interface ModifyCall { type: string; oid: string; delta: Array<Record<string, unknown>>; opts?: { raw?: boolean }; }

function ctxWith(assignments: unknown): { ctx: RunContext; calls: ModifyCall[] } {
  const calls: ModifyCall[] = [];
  const rest = {
    searchByName: async (type: string) => (type === "users" ? [{ oid: "user-1" }] : [{ oid: "role-1" }]),
    getObject: async () => ({ assignment: assignments }),
    modifyObject: async (type: string, oid: string, delta: ModifyCall["delta"], opts?: { raw?: boolean }) => {
      calls.push({ type, oid, delta, opts });
    },
  };
  return { ctx: { rest, now: () => NOW } as unknown as RunContext, calls };
}

describe("set-assignment handler", () => {
  it("raw-seeds the matching assignment's validTo, resolving a relative date (4.0 `id`)", async () => {
    const { ctx, calls } = ctxWith([
      { id: 5, targetRef: { oid: "other" } },
      { id: 7, targetRef: { oid: "role-1" } },
    ]);
    await setAssignmentStep.run({ "set-assignment": { user: "jdoe", role: "App", validTo: "now-P1D" } }, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "users", oid: "user-1", opts: { raw: true } });
    expect(calls[0]!.delta[0]).toEqual({
      modificationType: "replace",
      path: "assignment[7]/activation/validTo",
      value: "2026-06-04T12:00:00.000Z",
    });
  });

  it("supports 4.4 `@id` and both validFrom + validTo", async () => {
    const { ctx, calls } = ctxWith([{ "@id": 9, targetRef: { oid: "role-1" } }]);
    await setAssignmentStep.run(
      { "set-assignment": { user: "jdoe", role: "App", validFrom: "now", validTo: "now+P1D", raw: false } },
      ctx,
    );
    expect(calls[0]).toMatchObject({ opts: { raw: false } });
    expect(calls[0]!.delta.map((d) => d.path)).toEqual([
      "assignment[9]/activation/validFrom",
      "assignment[9]/activation/validTo",
    ]);
  });

  it("throws when the user has no assignment to that role", async () => {
    const { ctx } = ctxWith([{ id: 1, targetRef: { oid: "unrelated" } }]);
    await expect(
      setAssignmentStep.run({ "set-assignment": { user: "jdoe", role: "App", validTo: "now-P1D" } }, ctx),
    ).rejects.toThrow(/No assignment of role/);
  });
});
