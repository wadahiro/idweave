/**
 * Unit: projectScimResource — the pure projection of a SCIM 2.0 resource into the
 * stable record the check asserts. No SCIM server.
 */
import { describe, it, expect } from "vitest";
import { projectScimResource } from "./scimTarget.ts";

const RAW: Record<string, unknown> = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id: "2819c223-volatile",
  meta: { resourceType: "User", created: "2024-01-01T00:00:00Z" },
  userName: "jdoe",
  active: true,
  name: { givenName: "John", familyName: "Doe" },
  emails: [{ value: "jdoe@example.com", primary: true }],
  groups: ["b", "a"],
};

describe("projectScimResource", () => {
  it("with an allowlist projects each slash path under the path as a flat key", () => {
    const out = projectScimResource(RAW, ["userName", "active", "name/givenName", "name/familyName"]);
    expect(out).toEqual({
      userName: "jdoe",
      active: true,
      "name/givenName": "John",
      "name/familyName": "Doe",
    });
  });

  it("sorts an array of primitives, leaves an array of objects whole", () => {
    const out = projectScimResource(RAW, ["groups", "emails"]);
    expect(out).toEqual({
      groups: ["a", "b"], // primitives sorted
      emails: [{ value: "jdoe@example.com", primary: true }], // objects untouched
    });
  });

  it("without an allowlist keeps top-level fields except the volatile denylist", () => {
    const out = projectScimResource(RAW);
    expect(out).toEqual({
      userName: "jdoe",
      active: true,
      name: { givenName: "John", familyName: "Doe" },
      emails: [{ value: "jdoe@example.com", primary: true }],
      groups: ["a", "b"],
    });
    // schemas / id / meta stripped as volatile.
    expect(out.id).toBeUndefined();
    expect(out.meta).toBeUndefined();
    expect(out.schemas).toBeUndefined();
  });

  it("masks a declared path's value to a stable token (asserts presence)", () => {
    const out = projectScimResource(RAW, ["userName", "name/givenName"], ["name/givenName"]);
    expect(out).toEqual({ userName: "jdoe", "name/givenName": "<dynamic>" });
  });

  it("omits a declared path the resource does not have", () => {
    const out = projectScimResource(RAW, ["userName", "name/middleName", "phoneNumbers"]);
    expect(out).toEqual({ userName: "jdoe" });
  });
});
