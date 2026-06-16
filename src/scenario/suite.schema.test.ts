/**
 * Unit: the suite manifest JSON-Schema accepts a `keycloak` system and enforces the
 * externally-tagged one-of (exactly one protocol key, all env-name fields present).
 * No running stack — compiles the same schema `loadSuite` uses.
 */
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import suiteSchema from "./suite.schema.json" with { type: "json" };

const validate = new Ajv({ allErrors: true, strict: false }).compile(suiteSchema);

const withSystems = (systems: Record<string, unknown>) => ({ systems });

const keycloakSys = {
  urlEnv: "KC_URL",
  realmEnv: "KC_REALM",
  clientIdEnv: "KC_CLIENT_ID",
  secretEnv: "KC_SECRET",
};

describe("suite schema: keycloak system", () => {
  it("accepts a well-formed keycloak system", () => {
    expect(validate(withSystems({ kc: { keycloak: keycloakSys } }))).toBe(true);
  });

  it("rejects a keycloak system missing a required env-name field", () => {
    const { secretEnv, ...missing } = keycloakSys;
    expect(validate(withSystems({ kc: { keycloak: missing } }))).toBe(false);
  });

  it("rejects unknown properties on a keycloak system", () => {
    expect(validate(withSystems({ kc: { keycloak: { ...keycloakSys, url: "http://x" } } }))).toBe(false);
  });

  it("rejects mixing keycloak with another protocol key (oneOf)", () => {
    expect(
      validate(withSystems({ kc: { keycloak: keycloakSys, csv: { fileName: "x.csv", columns: ["a"], idColumn: "a" } } })),
    ).toBe(false);
  });

  it("accepts keycloak alongside a separate midpoint and csv system", () => {
    expect(
      validate(
        withSystems({
          kc: { keycloak: keycloakSys },
          idm: { midpoint: { baseUrlEnv: "U", usernameEnv: "N", passwordEnv: "P", version: "4.10" } },
          hr: { csv: { fileName: "hr.csv", columns: ["login"], idColumn: "login" } },
        }),
      ),
    ).toBe(true);
  });
});
