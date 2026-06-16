/**
 * Unit: projectKeycloakUser — the pure projection of a Keycloak user representation
 * into the stable record the check asserts. No Keycloak server.
 */
import { describe, it, expect } from "vitest";
import { projectKeycloakUser } from "./keycloakTarget.ts";
import type { KeycloakUser } from "../clients/keycloakAdmin.ts";

const RAW: KeycloakUser = {
  id: "8f3a-volatile-uuid",
  createdTimestamp: 1700000000000,
  username: "jdoe",
  enabled: true,
  emailVerified: true,
  firstName: "John",
  lastName: "Doe",
  email: "jdoe@example.com",
  federationLink: "ldap-provider-uuid",
  access: { manageGroupMembership: true },
  attributes: {
    department: ["Sales"],
    roles: ["b", "a", "c"],
  },
};

describe("projectKeycloakUser", () => {
  it("with an allowlist keeps only declared names (top-level field OR custom attribute)", () => {
    const out = projectKeycloakUser(RAW, ["username", "email", "enabled", "department", "roles"]);
    expect(out).toEqual({
      username: "jdoe",
      email: "jdoe@example.com",
      enabled: true,
      department: ["Sales"],
      roles: ["a", "b", "c"], // multi-valued sorted
    });
  });

  it("without an allowlist keeps every field except the volatile denylist, flattening attributes", () => {
    const out = projectKeycloakUser(RAW);
    expect(out).toEqual({
      username: "jdoe",
      enabled: true,
      emailVerified: true,
      firstName: "John",
      lastName: "Doe",
      email: "jdoe@example.com",
      department: ["Sales"],
      roles: ["a", "b", "c"],
    });
    // id / createdTimestamp / federationLink / access stripped as volatile.
    expect(out.id).toBeUndefined();
    expect(out.federationLink).toBeUndefined();
    expect(out.access).toBeUndefined();
  });

  it("masks a declared field's value to a stable token (asserts presence)", () => {
    const out = projectKeycloakUser(RAW, ["username", "department"], ["department"]);
    expect(out).toEqual({ username: "jdoe", department: "<dynamic>" });
  });

  it("omits a declared name the user does not have", () => {
    const out = projectKeycloakUser(RAW, ["username", "telephone"]);
    expect(out).toEqual({ username: "jdoe" });
  });

  it("omits a custom attribute present as an empty array (absent, not a phantom present)", () => {
    const user: KeycloakUser = { username: "jdoe", attributes: { department: [] } };
    expect(projectKeycloakUser(user, ["username", "department"])).toEqual({ username: "jdoe" });
    expect(projectKeycloakUser(user)).toEqual({ username: "jdoe" });
  });

  it("matches names case-sensitively (Keycloak attribute names are case-sensitive)", () => {
    const out = projectKeycloakUser(RAW, ["Department"]);
    expect(out).toEqual({}); // "Department" != "department"
  });
});
