/**
 * Unit: db-mutate handler — resolves `:id` from the focus's linkFrom value(s),
 * resolves a `now…` `:value` against the injected clock, and runs the suite system's
 * `update` once per value. No live DB: the db client's execUpdate is mocked and we
 * assert the (system, bindings) it is called with.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { execUpdate } = vi.hoisted(() => ({
  execUpdate: vi.fn(async (_system: unknown, _bindings: { id: string; value: string }) => 1),
}));
vi.mock("../../clients/db.ts", () => ({ execUpdate }));

import { dbMutateStep } from "./db-mutate.ts";
import type { RunContext } from "./types.ts";
import type { Suite, SystemSpec } from "../suite.ts";

const NOW = Date.UTC(2026, 5, 5, 12, 0, 0); // 2026-06-05T12:00:00Z

const dbMock: SystemSpec = {
  db: {
    url: "postgres://app@db:15432/external_server",
    passwordEnv: "PW",
    query: "SELECT 1",
    update: "UPDATE external_items SET expires_at = cast(:value as timestamptz) WHERE item_key = split_part(:id,'/',2)",
    linkFrom: { path: "extension/externalRef" },
  },
};

function ctxWith(user: Record<string, unknown> | null, systems: Record<string, SystemSpec>): RunContext {
  const rest = { searchByName: async () => (user ? [user] : []) };
  const suite = { systems } as unknown as Suite;
  return { rest, suite, now: () => NOW } as unknown as RunContext;
}

beforeEach(() => execUpdate.mockClear());

describe("db-mutate handler", () => {
  it("runs the update once per linkFrom value, with a resolved relative-time :value", async () => {
    const ctx = ctxWith(
      { oid: "u1", extension: { externalRef: ["15/15-aaa/fp/s/e", "15/15-bbb/fp/s/e"] } },
      { "db-mock": dbMock },
    );
    await dbMutateStep.run(
      { "db-mutate": { system: "db-mock", identifier: "idwtest@x", value: "now+P15D" } },
      ctx,
    );
    expect(execUpdate).toHaveBeenCalledTimes(2);
    expect(execUpdate.mock.calls[0]![1]).toEqual({ id: "15/15-aaa/fp/s/e", value: "2026-06-20T12:00:00.000Z" });
    expect(execUpdate.mock.calls[1]![1]).toEqual({ id: "15/15-bbb/fp/s/e", value: "2026-06-20T12:00:00.000Z" });
  });

  it("passes a non-time literal value through unchanged", async () => {
    const ctx = ctxWith({ oid: "u1", extension: { externalRef: "15/15-aaa/fp/s/e" } }, { "db-mock": dbMock });
    await dbMutateStep.run({ "db-mutate": { system: "db-mock", identifier: "idwtest@x", value: "2020-01-01T00:00:00Z" } }, ctx);
    expect(execUpdate.mock.calls[0]![1]).toMatchObject({ value: "2020-01-01T00:00:00Z" });
  });

  it("throws when the system is not in the suite or is not a db system", async () => {
    const ctx = ctxWith({ oid: "u1" }, { "db-mock": dbMock });
    await expect(
      dbMutateStep.run({ "db-mutate": { system: "missing", identifier: "x", value: "now" } }, ctx),
    ).rejects.toThrow(/not in suite/);
  });

  it("throws when the focus is absent", async () => {
    const ctx = ctxWith(null, { "db-mock": dbMock });
    await expect(
      dbMutateStep.run({ "db-mutate": { system: "db-mock", identifier: "ghost", value: "now" } }, ctx),
    ).rejects.toThrow(/not found/);
  });
});
