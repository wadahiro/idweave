/**
 * Unit: purgeShadows — resource-agnostic orphan/tombstone shadow purge by secondary
 * identifier (the shadow `name`). An LDAP system scopes by `containerDn` (the name is a
 * DN suffix); a flat-id system (csv/scim/…) passes no scope and matches the name exactly.
 * The rest client is mocked.
 */
import { describe, it, expect, vi } from "vitest";
import { purgeShadows } from "./purgeShadows.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";

function restMock(shadows: Array<{ oid: string; name: string }>) {
  return {
    searchShadowsByNameSubstring: vi.fn(async () => shadows),
    deleteObject: vi.fn(async () => {}),
  } as unknown as MidpointRest & Record<string, ReturnType<typeof vi.fn>>;
}

describe("purgeShadows", () => {
  it("scopes an LDAP purge by containerDn (DN suffix), leaving other resources' shadows", async () => {
    const rest = restMock([
      { oid: "s1", name: "cn=idwtest-001,ou=people,dc=example,dc=org" },
      { oid: "s2", name: "cn=idwtest-001,ou=people,dc=other,dc=org" }, // another tree
    ]);
    const n = await purgeShadows(rest, "idwtest-001", "ou=people,dc=example,dc=org");
    expect(n).toBe(1);
    expect((rest as any).deleteObject).toHaveBeenCalledOnce();
    expect((rest as any).deleteObject).toHaveBeenCalledWith("shadows", "s1", true);
  });

  it("matches a flat-id system (no scope) by exact name, not a substring bleed", async () => {
    const rest = restMock([
      { oid: "s1", name: "idwtest-001" },        // exact
      { oid: "s2", name: "idwtest-001-old" },    // substring hit from the search, must NOT delete
    ]);
    const n = await purgeShadows(rest, "idwtest-001");
    expect(n).toBe(1);
    expect((rest as any).deleteObject).toHaveBeenCalledWith("shadows", "s1", true);
  });

  it("raw-deletes (the `true` flag) and tolerates a delete failure", async () => {
    const rest = restMock([{ oid: "s1", name: "jdoe" }]);
    (rest as any).deleteObject = vi.fn(async () => {
      throw new Error("boom");
    });
    const n = await purgeShadows(rest, "jdoe");
    expect(n).toBe(1); // counted despite the swallowed error
  });
});
