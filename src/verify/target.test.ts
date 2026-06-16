/**
 * verify — target dispatch: the whole-set (`all: true`) read is only natural for the
 * container-of-objects readers (csv/ldap/scim); a db/keycloak target has no full-set
 * read and must be rejected with a clear error (not silently mis-routed).
 */
import { describe, it, expect } from "vitest";
import type { SystemSpec } from "../scenario/suite.ts";
import { readAllAccountProjections } from "./target.ts";

describe("readAllAccountProjections dispatch", () => {
  it("rejects a db target (custom by-id SELECT has no full-set read)", () => {
    const db = { url: "postgres://u@h/d", passwordEnv: "P", query: "select 1" } as SystemSpec["db"];
    expect(() => readAllAccountProjections("/tmp", { db } as SystemSpec)).toThrow(/not supported for a db target/);
  });

  it("rejects a keycloak target (realm mixes provisioned/service/admin users)", () => {
    const keycloak = { urlEnv: "KC_URL", realmEnv: "KC_REALM", clientIdEnv: "KC_CID" } as unknown as SystemSpec["keycloak"];
    expect(() => readAllAccountProjections("/tmp", { keycloak } as SystemSpec)).toThrow(/not supported for a keycloak target/);
  });
});
