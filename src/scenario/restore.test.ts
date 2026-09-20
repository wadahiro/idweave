/**
 * Unit: the restore-participant wiring — which system TYPE yields an
 * `afterRestore` hook, and that a keycloak/midpoint participant resolves its
 * connection from the named env vars. No running stack (the hook itself isn't invoked).
 */
import { describe, it, expect, afterEach } from "vitest";
import { restoreParticipant, restoreParticipants } from "./restore.ts";
import type { Suite, SystemSpec } from "./suite.ts";
import type { Config } from "../config.ts";

const cfg = { poll: { timeoutMs: 1000, intervalMs: 100 } } as Config;

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});

const keycloakSys: SystemSpec = {
  keycloak: { urlEnv: "KC_URL", realmEnv: "KC_REALM", clientIdEnv: "KC_CID", secretEnv: "KC_SECRET" },
};
const midpointSys: SystemSpec = {
  midpoint: { baseUrlEnv: "MP_URL", usernameEnv: "MP_USER", passwordEnv: "MP_PW", version: "4.10" },
};

function setKcEnv() {
  process.env.KC_URL = "http://kc:8080/";
  process.env.KC_REALM = "demo";
  process.env.KC_CID = "idweave-admin";
  process.env.KC_SECRET = "s3cr3t";
}

describe("restoreParticipant", () => {
  it("builds a keycloak participant labelled with url + realm (trailing slash trimmed)", () => {
    setKcEnv();
    const p = restoreParticipant("kc", keycloakSys, cfg);
    expect(p).not.toBeNull();
    expect(p!.label).toBe("keycloak:kc (http://kc:8080, realm demo)");
    expect(typeof p!.afterRestore).toBe("function");
  });

  it("throws a clear error when a keycloak env var is unset", () => {
    setKcEnv();
    delete process.env.KC_SECRET;
    expect(() => restoreParticipant("kc", keycloakSys, cfg)).toThrow(/KC_SECRET is not set/);
  });

  it("builds a midpoint participant (unchanged)", () => {
    process.env.MP_URL = "http://mp:8080/midpoint";
    process.env.MP_USER = "administrator";
    process.env.MP_PW = "pw";
    const p = restoreParticipant("idm", midpointSys, cfg);
    expect(p!.label).toContain("midpoint:idm");
    expect(typeof p!.beforeRestore).toBe("function");
    expect(p!.requiredAfterRestore).toBe(true);
  });

  it("returns null for external systems (csv/ldap/db — rolled back by snapshot)", () => {
    const csv: SystemSpec = { csv: { fileName: "x.csv", columns: ["a"], idColumn: "a" } };
    expect(restoreParticipant("hr", csv, cfg)).toBeNull();
  });
});

describe("restoreParticipants", () => {
  it("collects only the instance systems (keycloak + midpoint), skipping csv", () => {
    setKcEnv();
    process.env.MP_URL = "http://mp:8080/midpoint";
    process.env.MP_USER = "administrator";
    process.env.MP_PW = "pw";
    const suite = {
      systems: {
        hr: { csv: { fileName: "x.csv", columns: ["a"], idColumn: "a" } },
        kc: keycloakSys,
        idm: midpointSys,
      },
    } as unknown as Suite;
    const labels = restoreParticipants(suite, cfg).map((p) => p.label);
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l.startsWith("keycloak:kc"))).toBe(true);
    expect(labels.some((l) => l.startsWith("midpoint:idm"))).toBe(true);
  });
});
