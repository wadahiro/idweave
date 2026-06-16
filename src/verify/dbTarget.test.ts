/**
 * Unit: db target linkFrom value sourcing — `path` reads the linking value(s) live
 * from the focus; `capture` uses value(s) a capture-focus step recorded earlier (to
 * assert a row whose value the run since destroyed). `queryRow` is mocked: each
 * `:id` echoes back as a row, so we assert WHICH ids drove the queries (sorted set).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRow = vi.fn();
vi.mock("../clients/db.ts", () => ({ queryRow: (...a: unknown[]) => queryRow(...a) }));

import { readDbAccountProjection } from "./dbTarget.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";
import type { SystemSpec } from "../scenario/suite.ts";

const db = (linkFrom: Record<string, unknown>): SystemSpec =>
  ({ db: { url: "postgres://u@h/d", passwordEnv: "X", query: "SELECT :id", columns: ["id"], linkFrom } }) as unknown as SystemSpec;

// queryRow echoes the id it was called with, so the resulting set reveals the ids.
beforeEach(() => {
  queryRow.mockReset();
  queryRow.mockImplementation(async (_db: unknown, id: string) => ({ id }));
});

describe("readDbAccountProjection linkFrom sourcing", () => {
  it("path: reads the linking value(s) live from the focus", async () => {
    const rest = { searchByName: async () => [{ extension: { externalRef: ["c-A", "c-B"] } }] } as unknown as MidpointRest;
    const rows = await readDbAccountProjection(rest, db({ path: "extension/externalRef" }), "jdoe", { prev: ["IGNORED"] });
    expect(rows).toEqual([{ id: "c-A" }, { id: "c-B" }]);
  });

  it("capture: uses the recorded slot, NOT the live focus", async () => {
    const rest = { searchByName: async () => [{ extension: { externalRef: ["c-NEW"] } }] } as unknown as MidpointRest;
    const rows = await readDbAccountProjection(rest, db({ capture: "prev" }), "jdoe", { prev: ["c-OLD"] });
    expect(rows).toEqual([{ id: "c-OLD" }]);
    // The identifier's focus must NOT have been queried for the capture path.
    expect(queryRow).toHaveBeenCalledTimes(1);
    expect(queryRow).toHaveBeenCalledWith(expect.anything(), "c-OLD");
  });

  it("capture: a missing/empty slot yields no rows (assertable as absent)", async () => {
    const rest = { searchByName: async () => [] } as unknown as MidpointRest;
    expect(await readDbAccountProjection(rest, db({ capture: "prev" }), "jdoe", {})).toBeNull();
    expect(await readDbAccountProjection(rest, db({ capture: "prev" }), "jdoe", { prev: [] })).toBeNull();
    expect(queryRow).not.toHaveBeenCalled();
  });
});
