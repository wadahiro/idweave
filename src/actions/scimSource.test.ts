/**
 * Unit: the pure row -> SCIM mappers used by the scim source adapter. No SCIM server.
 */
import { describe, it, expect } from "vitest";
import { rowToScimBody, rowToScimPatchOps } from "./scimSource.ts";
import type { ScimSystemConfig } from "../scenario/suite.ts";

const cfg: ScimSystemConfig = { url: "http://h/scim/v2", resourceType: "Users", filterAttr: "userName" };

describe("rowToScimBody", () => {
  it("builds nested JSON from slash paths, coerces booleans, adds the core schema, skips blanks", () => {
    const body = rowToScimBody(cfg, {
      userName: "alice",
      "name/givenName": "Alice",
      "name/familyName": "Liddell",
      displayName: "Alice Liddell",
      active: "true",
      title: "",
    });
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "alice",
      name: { givenName: "Alice", familyName: "Liddell" },
      displayName: "Alice Liddell",
      active: true,
    });
  });

  it("uses the Group core schema for a Groups resource type", () => {
    const body = rowToScimBody({ ...cfg, resourceType: "Groups", filterAttr: "displayName" }, { displayName: "admins" });
    expect(body.schemas).toEqual(["urn:ietf:params:scim:schemas:core:2.0:Group"]);
  });
});

describe("rowToScimPatchOps", () => {
  it("emits replace ops with dotted paths and the identity attribute left untouched", () => {
    const ops = rowToScimPatchOps(cfg, {
      userName: "alice",
      "name/givenName": "Alicia",
      active: "false",
      title: "",
    });
    expect(ops).toEqual([
      { op: "replace", path: "name.givenName", value: "Alicia" },
      { op: "replace", path: "active", value: false },
    ]);
  });
});
