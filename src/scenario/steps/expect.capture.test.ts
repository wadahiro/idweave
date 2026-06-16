/**
 * Unit: expect handler, capture mode — the capture-collision guard. Two expect
 * targets that write the SAME expected file with DIFFERENT content in one scenario
 * must fail loudly (they share a file across states it can't both represent), while
 * identical content is allowed. Drives the `projections` capture path with
 * readLiveProjections mocked; writes into a temp dir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { readLiveProjections } = vi.hoisted(() => ({ readLiveProjections: vi.fn() }));
vi.mock("../../verify/projections.ts", () => ({ readLiveProjections }));

import { expectStep } from "./expect.ts";
import type { RunContext } from "./types.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "idw-capture-"));
  readLiveProjections.mockReset();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function captureCtx(): RunContext {
  return {
    rest: {},
    cfg: { poll: { timeoutMs: 1000, intervalMs: 0 } },
    captureExpected: true,
    scenarioDir: dir,
    scenarioId: "s1",
    state: {},
  } as unknown as RunContext;
}

describe("expect capture-collision guard", () => {
  it("throws when two targets capture the same file with DIFFERENT content", async () => {
    readLiveProjections
      .mockResolvedValueOnce([{ resource: "A", kind: "account", intent: "default" }])
      .mockResolvedValueOnce([{ resource: "B", kind: "account", intent: "default" }]);
    await expect(
      expectStep.run(
        {
          expect: {
            projections: [
              { owner: "u1", expected: "shared.json" },
              { owner: "u2", expected: "shared.json" },
            ],
          },
        },
        captureCtx(),
      ),
    ).rejects.toThrow(/capture collision/i);
  });

  it("allows two targets capturing the same file with IDENTICAL content", async () => {
    const same = [{ resource: "A", kind: "account", intent: "default" }];
    readLiveProjections.mockResolvedValue(same);
    const ctx = captureCtx();
    await expectStep.run(
      {
        expect: {
          projections: [
            { owner: "u1", expected: "shared.json" },
            { owner: "u2", expected: "shared.json" },
          ],
        },
      },
      ctx,
    );
    const written = JSON.parse(await readFile(join(dir, "shared.json"), "utf-8"));
    expect(written).toEqual(same);
  });

  it("writes distinct files without collision", async () => {
    readLiveProjections
      .mockResolvedValueOnce([{ resource: "A", kind: "account", intent: "default" }])
      .mockResolvedValueOnce([{ resource: "B", kind: "account", intent: "default" }]);
    const ctx = captureCtx();
    await expectStep.run(
      {
        expect: {
          projections: [
            { owner: "u1", expected: "a.json" },
            { owner: "u2", expected: "b.json" },
          ],
        },
      },
      ctx,
    );
    expect(JSON.parse(await readFile(join(dir, "a.json"), "utf-8"))[0].resource).toBe("A");
    expect(JSON.parse(await readFile(join(dir, "b.json"), "utf-8"))[0].resource).toBe("B");
  });
});
