/**
 * Unit: org actions — createOrg builds the assignment-based payload and resolves
 * the parent by name; deleteOrgTree walks the parentOrgRef subtree and deletes
 * parented roles + descendant orgs leaf-first. The rest client is mocked.
 */
import { describe, it, expect, vi } from "vitest";
import { createOrg, deleteOrgTree } from "./org.ts";
import type { MidpointRest } from "../clients/midpointRest.ts";

function restMock(over: Partial<Record<keyof MidpointRest, unknown>> = {}) {
  return {
    searchByName: vi.fn(async () => []),
    listObjects: vi.fn(async () => []),
    addObject: vi.fn(async () => "new-oid"),
    deleteObject: vi.fn(async () => {}),
    ...over,
  } as unknown as MidpointRest & Record<string, ReturnType<typeof vi.fn>>;
}

describe("createOrg", () => {
  it("attaches the parent as an assignment (not a raw parentOrgRef) and returns the new oid", async () => {
    const rest = restMock({ searchByName: vi.fn(async () => [{ oid: "parent-1" }]) });
    const oid = await createOrg(rest, "idwtest", "example-project-root-org", "example-projects-root");
    expect(oid).toBe("new-oid");
    expect((rest as any).addObject).toHaveBeenCalledWith("orgs", {
      org: {
        name: "idwtest",
        subtype: "example-project-root-org",
        assignment: [{ targetRef: { oid: "parent-1", type: "OrgType" } }],
      },
    });
  });

  it("omits the assignment when no parent is given", async () => {
    const rest = restMock();
    await createOrg(rest, "root-project", "example-role-project");
    expect((rest as any).addObject).toHaveBeenCalledWith("orgs", { org: { name: "root-project", subtype: "example-role-project" } });
    expect((rest as any).searchByName).not.toHaveBeenCalled();
  });

  it("throws when the named parent does not exist", async () => {
    const rest = restMock({ searchByName: vi.fn(async () => []) });
    await expect(createOrg(rest, "c", "example-project-org", "ghost")).rejects.toThrow(/parent org "ghost" not found/);
  });
});

describe("deleteOrgTree", () => {
  it("deletes parented roles, then descendant orgs leaf-first; skips unrelated objects; no-op if absent", async () => {
    const orgs = [
      { oid: "project-root", parentOrgRef: { oid: "root" } },
      { oid: "project", parentOrgRef: { oid: "project-root" } },
      { oid: "other", parentOrgRef: { oid: "root" } },
    ];
    const roles = [
      { oid: "role-project", parentOrgRef: [{ oid: "project" }] },
      { oid: "role-project-root", parentOrgRef: { oid: "project-root" } },
      { oid: "role-other", parentOrgRef: { oid: "other" } },
    ];
    const rest = restMock({
      searchByName: vi.fn(async () => [{ oid: "project-root", parentOrgRef: { oid: "root" } }]),
      listObjects: vi.fn(async (type: string) => (type === "orgs" ? orgs : roles)),
    });
    await deleteOrgTree(rest, "idwtest-project-root");

    const calls = (rest as any).deleteObject.mock.calls.map((c: unknown[]) => `${c[0]}:${c[1]}`);
    // both subtree roles deleted, unrelated role untouched
    expect(calls).toContain("roles:role-project");
    expect(calls).toContain("roles:role-project-root");
    expect(calls).not.toContain("roles:role-other");
    // orgs leaf-first: project before project-root; 'other' untouched
    expect(calls).toContain("orgs:project");
    expect(calls).toContain("orgs:project-root");
    expect(calls).not.toContain("orgs:other");
    expect(calls.indexOf("orgs:project")).toBeLessThan(calls.indexOf("orgs:project-root"));
    // roles deleted before orgs
    expect(calls.indexOf("roles:role-project")).toBeLessThan(calls.indexOf("orgs:project"));
  });

  it("is a no-op when the root org is absent", async () => {
    const rest = restMock({ searchByName: vi.fn(async () => []) });
    await deleteOrgTree(rest, "nope");
    expect((rest as any).listObjects).not.toHaveBeenCalled();
    expect((rest as any).deleteObject).not.toHaveBeenCalled();
  });
});
