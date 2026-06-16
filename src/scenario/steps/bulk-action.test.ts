/**
 * Unit: bulk-action handler — runs an executeScript script via the actions action.
 * `{file}` reads the XML from a scenario-relative path; `{xml}` passes inline
 * content through. The actions runBulkAction and fs readFile are mocked; we assert the
 * XML it forwards (and that the file path resolves against scenarioDir).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

const { runBulkAction } = vi.hoisted(() => ({
  runBulkAction: vi.fn(async (_rest: unknown, _xml: string) => {}),
}));
vi.mock("../../actions/bulkAction.ts", () => ({ runBulkAction }));

const { readFile } = vi.hoisted(() => ({
  readFile: vi.fn(async (path: string) => `<executeScript>from ${path}</executeScript>`),
}));
vi.mock("node:fs/promises", () => ({ readFile }));

import { bulkActionStep } from "./bulk-action.ts";
import type { RunContext } from "./types.ts";

const SCENARIO_DIR = "/scn/access/bulk";
function ctx(): RunContext {
  const rest = {} as unknown;
  return { rest, scenarioDir: SCENARIO_DIR } as unknown as RunContext;
}

beforeEach(() => {
  runBulkAction.mockClear();
  readFile.mockClear();
});

describe("bulk-action handler", () => {
  it("reads the file (resolved against scenarioDir) and runs its XML", async () => {
    const c = ctx();
    await bulkActionStep.run({ "bulk-action": { file: "scripts/manager.xml" } }, c);
    const expectedPath = resolve(SCENARIO_DIR, "scripts/manager.xml");
    expect(readFile).toHaveBeenCalledWith(expectedPath, "utf8");
    expect(runBulkAction).toHaveBeenCalledTimes(1);
    expect(runBulkAction.mock.calls[0]![1]).toBe(`<executeScript>from ${expectedPath}</executeScript>`);
  });

  it("passes inline xml through without touching the filesystem", async () => {
    const c = ctx();
    await bulkActionStep.run({ "bulk-action": { xml: "<executeScript>inline</executeScript>" } }, c);
    expect(readFile).not.toHaveBeenCalled();
    expect(runBulkAction.mock.calls[0]![1]).toBe("<executeScript>inline</executeScript>");
  });

  it("matches only a bulk-action step and renders a token/detail", () => {
    expect(bulkActionStep.match({ "bulk-action": { xml: "x" } })).toBe(true);
    expect(bulkActionStep.match({ mutate: {} })).toBe(false);
    expect(bulkActionStep.token({ "bulk-action": { xml: "x" } })).toBe("bulk-action");
    expect(bulkActionStep.detail({ "bulk-action": { file: "f.xml" } }, {} as never)).toContain("f.xml");
  });
});
