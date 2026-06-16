/**
 * Unit: derive-shadow handler — locates the owner's shadow on a named resource
 * (linkRef → resourceRef match), reads a source path, splits-and-reformats with the
 * shared `delimited` transform (splicing a seeded `{time}`), and raw-replaces each
 * target path. No running stack; asserts the REST deltas and shadow selection.
 */
import { describe, it, expect } from "vitest";
import { deriveShadowStep } from "./derive-shadow.ts";
import type { RunContext } from "./types.ts";

const NOW = Date.UTC(2026, 5, 5, 12, 0, 0); // 2026-06-05T12:00:00Z

interface ModifyCall { type: string; oid: string; delta: Array<Record<string, unknown>>; opts?: { raw?: boolean }; }

function ctxWith(opts: {
  user: Record<string, unknown> | null;
  resourceOid?: string | null;
  shadows?: Record<string, Record<string, unknown>>;
}): { ctx: RunContext; calls: ModifyCall[] } {
  const calls: ModifyCall[] = [];
  const rest = {
    searchByName: async (type: string) => {
      if (type === "users") return opts.user ? [opts.user] : [];
      if (type === "resources") return opts.resourceOid ? [{ oid: opts.resourceOid }] : [];
      return [];
    },
    getObject: async (_type: string, oid: string) => opts.shadows?.[oid] ?? null,
    modifyObject: async (type: string, oid: string, delta: ModifyCall["delta"], o?: { raw?: boolean }) => {
      calls.push({ type, oid, delta, opts: o });
    },
  };
  return { ctx: { rest, now: () => NOW } as unknown as RunContext, calls };
}

const extShadow = (oid: string, resourceOid: string, extId: string) => ({
  oid,
  resourceRef: { oid: resourceOid },
  primaryIdentifierValue: extId,
  attributes: { extName: extId.split("/").slice(0, 2).join("/"), extId },
});

describe("derive-shadow handler", () => {
  it("rewinds the shadow trailing date across both identifier paths (raw default)", async () => {
    const { ctx, calls } = ctxWith({
      user: { oid: "u1", linkRef: [{ oid: "sh-other" }, { oid: "sh-match" }] },
      resourceOid: "res-match",
      shadows: {
        "sh-other": extShadow("sh-other", "res-ldap", "x/y"),
        "sh-match": extShadow("sh-match", "res-match", "15/15-abc/fp/20000101000000/20990101000000"),
      },
    });
    await deriveShadowStep.run(
      {
        "derive-shadow": {
          owner: "idwtest@x",
          resource: "Example External API",
          source: "attributes/extId",
          targets: ["primaryIdentifierValue", "attributes/extId"],
          delimited: {
            delimiter: "/",
            names: ["a", "b", "fp", "start", "end"],
            format: "{a}/{b}/{fp}/{start}/{time}",
          },
          time: "now+P15D|yyyyMMddHHmmss",
        },
      },
      ctx,
    );
    // only the matching-resource shadow is touched
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "shadows", oid: "sh-match", opts: { raw: true } });
    const rewound = "15/15-abc/fp/20000101000000/20260620120000"; // now+15d, UTC, seconds
    expect(calls[0]!.delta).toEqual([
      { modificationType: "replace", path: "primaryIdentifierValue", value: rewound },
      { modificationType: "replace", path: "attributes/extId", value: rewound },
    ]);
  });

  it("throws when the user has no shadow on the resource", async () => {
    const { ctx } = ctxWith({
      user: { oid: "u1", linkRef: [{ oid: "sh-other" }] },
      resourceOid: "res-match",
      shadows: { "sh-other": extShadow("sh-other", "res-ldap", "x/y") },
    });
    await expect(
      deriveShadowStep.run(
        {
          "derive-shadow": {
            owner: "idwtest@x",
            resource: "Example External API",
            source: "attributes/extId",
            targets: ["primaryIdentifierValue"],
            delimited: { delimiter: "/", format: "{0}" },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/no shadow on resource/);
  });

  it("throws when the owner or resource is absent", async () => {
    const { ctx } = ctxWith({ user: null, resourceOid: "res-match" });
    await expect(
      deriveShadowStep.run(
        {
          "derive-shadow": {
            owner: "ghost",
            resource: "Example External API",
            source: "attributes/extId",
            targets: ["primaryIdentifierValue"],
            delimited: { delimiter: "/", format: "{0}" },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});
