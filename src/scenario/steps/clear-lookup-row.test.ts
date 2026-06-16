/**
 * Unit: clear-lookup-row handler — deletes a LookupTable row by key (resets a task's
 * per-day progress checkpoint). No running stack; asserts the REST delta it issues.
 */
import { describe, it, expect } from "vitest";
import { clearLookupRowStep } from "./clear-lookup-row.ts";
import type { RunContext } from "./types.ts";

interface ModifyCall { type: string; oid: string; delta: Array<Record<string, unknown>>; opts?: { raw?: boolean }; }

function ctx(): { ctx: RunContext; calls: ModifyCall[] } {
  const calls: ModifyCall[] = [];
  const rest = {
    modifyObject: async (type: string, oid: string, delta: ModifyCall["delta"], opts?: { raw?: boolean }) => {
      calls.push({ type, oid, delta, opts });
    },
  };
  return { ctx: { rest } as unknown as RunContext, calls };
}

describe("clear-lookup-row handler", () => {
  it("deletes the row with the given key from the named LookupTable", async () => {
    const { ctx: c, calls } = ctx();
    await clearLookupRowStep.run(
      { "clear-lookup-row": { table: "lt-oid-1", key: "task-oid-9" } },
      c,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "lookupTables", oid: "lt-oid-1" });
    expect(calls[0]!.delta).toEqual([
      { modificationType: "delete", path: "row", value: { key: "task-oid-9" } },
    ]);
  });
});
