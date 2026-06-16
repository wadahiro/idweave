/**
 * Unit: capture-focus handler — snapshots a focus property's (multi-value) values
 * into a named state slot for a later db `linkFrom: { capture }` assert. No running stack;
 * asserts what lands in ctx.state.captures.
 */
import { describe, it, expect } from "vitest";
import { captureFocusStep } from "./capture-focus.ts";
import type { RunContext } from "./types.ts";

function ctxWith(user: Record<string, unknown> | null): RunContext {
  const rest = { searchByName: async () => (user ? [user] : []) };
  return { rest, state: {} } as unknown as RunContext;
}

const step = (as: string) => ({
  "capture-focus": { name: "idwtest-user", source: "extension/externalRef", as },
});

describe("capture-focus handler", () => {
  it("captures a multi-value property as an array under the slot name", async () => {
    const ctx = ctxWith({ oid: "u1", extension: { externalRef: ["15/15-a/fp1", "15/15-b/fp2"] } });
    await captureFocusStep.run(step("prevRef"), ctx);
    expect(ctx.state.captures).toEqual({ prevRef: ["15/15-a/fp1", "15/15-b/fp2"] });
  });

  it("captures a single value as a one-element array", async () => {
    const ctx = ctxWith({ oid: "u1", extension: { externalRef: "15/15-a/fp1/start/end" } });
    await captureFocusStep.run(step("prevRef"), ctx);
    expect(ctx.state.captures!.prevRef).toEqual(["15/15-a/fp1/start/end"]);
  });

  it("captures an empty set when the property is absent (assertable later)", async () => {
    const ctx = ctxWith({ oid: "u1", extension: {} });
    await captureFocusStep.run(step("prevRef"), ctx);
    expect(ctx.state.captures!.prevRef).toEqual([]);
  });

  it("preserves other slots already captured", async () => {
    const ctx = ctxWith({ oid: "u1", extension: { externalRef: "15/15-a/fp" } });
    ctx.state.captures = { other: ["keep"] };
    await captureFocusStep.run(step("prevRef"), ctx);
    expect(ctx.state.captures).toEqual({ other: ["keep"], prevRef: ["15/15-a/fp"] });
  });

  it("throws when the focus is absent", async () => {
    const ctx = ctxWith(null);
    await expect(captureFocusStep.run(step("prevRef"), ctx)).rejects.toThrow(/not found/);
  });
});
