/**
 * Unit: planExecution — the pure execution-order planner. No running stack, no
 * reset wiring (idempotency reset is the standalone snapshot CLI's job, not here).
 */
import { describe, it, expect } from "vitest";
import { planExecution } from "./runSuite.ts";
import type { LoadedScenario, GroupMembership } from "./loader.ts";

function member(id: string, orderIndex = 0): GroupMembership {
  return { id, reset: "none", orderIndex };
}
function ls(id: string, group?: GroupMembership): LoadedScenario {
  return {
    scenario: { id, requirement: "R", steps: [] },
    dir: `/d/${id}`,
    file: `/d/${id}/scenario.yaml`,
    stepLines: [],
    group,
  };
}
/** Compact id-order view of a plan. */
const view = (s: LoadedScenario[]) => planExecution(s).map((p) => p.loaded.scenario.id);

describe("planExecution", () => {
  it("leaves ungrouped scenarios in their given order", () => {
    expect(view([ls("a"), ls("b")])).toEqual(["a", "b"]);
  });

  it("runs ungrouped first, then grouped", () => {
    expect(view([ls("chain1", member("g")), ls("plain"), ls("chain2", member("g"))])).toEqual([
      "plain",
      "chain1",
      "chain2",
    ]);
  });

  it("keeps a group's members contiguous and in their given order", () => {
    const g = "lifecycle";
    expect(
      view([ls("joiner", member(g)), ls("mover", member(g)), ls("leaver", member(g))]),
    ).toEqual(["joiner", "mover", "leaver"]);
  });

  it("keeps distinct groups contiguous, in first-seen order, even when interleaved", () => {
    expect(
      view([
        ls("a1", member("g1")),
        ls("b1", member("g2")),
        ls("a2", member("g1")),
        ls("b2", member("g2")),
      ]),
    ).toEqual(["a1", "a2", "b1", "b2"]);
  });
});
