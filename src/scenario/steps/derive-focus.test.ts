/**
 * Unit: derive-focus handler — reads a source focus property, splits-and-reformats
 * each value with the shared `delimited` transform (optionally splicing a seeded
 * `{time}`), and raw-replaces the target property. No running stack; asserts the REST delta.
 */
import { describe, it, expect } from "vitest";
import { deriveFocusStep } from "./derive-focus.ts";
import type { RunContext } from "./types.ts";

const NOW = Date.UTC(2026, 5, 5, 12, 0, 0); // 2026-06-05T12:00:00Z

interface ModifyCall { type: string; oid: string; delta: Array<Record<string, unknown>>; opts?: { raw?: boolean }; }

function ctxWith(user: Record<string, unknown> | null): { ctx: RunContext; calls: ModifyCall[] } {
  const calls: ModifyCall[] = [];
  const rest = {
    searchByName: async () => (user ? [user] : []),
    modifyObject: async (type: string, oid: string, delta: ModifyCall["delta"], opts?: { raw?: boolean }) => {
      calls.push({ type, oid, delta, opts });
    },
  };
  return { ctx: { rest, now: () => NOW } as unknown as RunContext, calls };
}

describe("derive-focus handler", () => {
  it("derives forcedEndDate from the live value, splicing a seeded past date (raw default)", async () => {
    const { ctx, calls } = ctxWith({
      oid: "user-1",
      extension: { externalRef: "15/15-abc-uuid/fp123/20000101000000/20990101000000" },
    });
    await deriveFocusStep.run(
      {
        "derive-focus": {
          name: "idwtest-user",
          source: "extension/externalRef",
          target: "extension/forcedEndDate",
          delimited: {
            delimiter: "/",
            names: ["a", "b", "c", "d", "e"],
            format: "{a}/{b}:{time}",
          },
          time: "now-P1D|yyyy-MM-dd",
        },
      },
      ctx,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "users", oid: "user-1", opts: { raw: true } });
    expect(calls[0]!.delta[0]).toEqual({
      modificationType: "replace",
      path: "extension/forcedEndDate",
      value: ["15/15-abc-uuid:2026-06-04"],
    });
  });

  it("maps EACH value of a multi-value source (order preserved)", async () => {
    const { ctx, calls } = ctxWith({
      oid: "user-1",
      extension: { externalRef: ["15/15-aaa/fp1", "15/15-bbb/fp2"] },
    });
    await deriveFocusStep.run(
      {
        "derive-focus": {
          name: "idwtest-user",
          source: "extension/externalRef",
          target: "extension/forcedEndDate",
          delimited: { delimiter: "/", names: ["a", "b"], format: "{a}/{b}:{time}" },
          time: "now|yyyy-MM-dd",
        },
      },
      ctx,
    );
    expect(calls[0]!.delta[0]!.value).toEqual(["15/15-aaa:2026-06-05", "15/15-bbb:2026-06-05"]);
  });

  it("works without a time (pure reformat) and honours raw:false", async () => {
    const { ctx, calls } = ctxWith({ oid: "user-1", extension: { externalRef: "15/15-ccc/fp/start/end" } });
    await deriveFocusStep.run(
      {
        "derive-focus": {
          name: "idwtest-user",
          source: "extension/externalRef",
          target: "extension/externalRef",
          delimited: { delimiter: "/", format: "{0}/{1}/{2}/{3}/20990101000000" },
          raw: false,
        },
      },
      ctx,
    );
    expect(calls[0]).toMatchObject({ opts: { raw: false } });
    expect(calls[0]!.delta[0]!.value).toEqual(["15/15-ccc/fp/start/20990101000000"]);
  });

  it("throws when the focus is absent", async () => {
    const { ctx } = ctxWith(null);
    await expect(
      deriveFocusStep.run(
        {
          "derive-focus": {
            name: "ghost",
            source: "extension/externalRef",
            target: "extension/forcedEndDate",
            delimited: { delimiter: "/", format: "{0}" },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });

  it("throws when the source property has no value", async () => {
    const { ctx } = ctxWith({ oid: "user-1", extension: {} });
    await expect(
      deriveFocusStep.run(
        {
          "derive-focus": {
            name: "idwtest-user",
            source: "extension/externalRef",
            target: "extension/forcedEndDate",
            delimited: { delimiter: "/", format: "{0}" },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/has no value/);
  });
});
