/**
 * Unit: per-principal GUI password resolution — no running stack. A suite may name a
 * per-principal env var (only the secret is in env); an unlisted login falls back
 * to the shared GUI_PASSWORD.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  guiPassword,
  primaryMidpointSystem,
  midpointConnection,
  drivenGuiSystem,
  type Suite,
  type SystemSpec,
} from "./suite.ts";

const suite = (principals?: Record<string, { passwordEnv: string }>): Suite =>
  ({ systems: {}, gui: { principals } }) as Suite;

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});

describe("guiPassword", () => {
  it("falls back to the shared password when the login isn't listed", () => {
    expect(guiPassword(suite(), "alice", "shared")).toBe("shared");
    expect(guiPassword(suite({ "101n": { passwordEnv: "X" } }), "alice", "shared")).toBe("shared");
  });

  it("reads the principal's named env var when listed", () => {
    process.env.IDW_GUI_101N = "p@ssw0rd";
    expect(guiPassword(suite({ "101n": { passwordEnv: "IDW_GUI_101N" } }), "101n", "shared")).toBe("p@ssw0rd");
  });

  it("falls back gracefully when there is no gui section at all", () => {
    expect(guiPassword({ systems: {} } as Suite, "bob", "shared")).toBe("shared");
  });

  it("throws a clear error when the named env var is unset", () => {
    delete process.env.MISSING_ENV;
    expect(() => guiPassword(suite({ admin: { passwordEnv: "MISSING_ENV" } }), "admin", "shared")).toThrow(
      /GUI password env "MISSING_ENV" for principal "admin" is not set/,
    );
  });
});

describe("primaryMidpointSystem", () => {
  const mid = (version: string): SystemSpec => ({
    midpoint: { baseUrlEnv: "U", usernameEnv: "N", passwordEnv: "P", version },
  });
  const csv: SystemSpec = { csv: { fileName: "x.csv", columns: ["a"], idColumn: "a" } };

  it("resolves the sole midpoint system's GUI version (ignoring external systems)", () => {
    const suite = { systems: { hr: csv, idm: mid("4.8") } } as unknown as Suite;
    expect(primaryMidpointSystem(suite)?.version).toBe("4.8");
  });

  it("returns undefined when there is no midpoint system (e.g. a Keycloak-only suite)", () => {
    const suite = { systems: { hr: csv } } as unknown as Suite;
    expect(primaryMidpointSystem(suite)).toBeUndefined();
  });

  it("returns undefined when several midpoints are declared (a step must name one with system:)", () => {
    const suite = { systems: { idm: mid("4.10"), ac: mid("4.4") } } as unknown as Suite;
    expect(primaryMidpointSystem(suite)).toBeUndefined();
  });
});

describe("midpointConnection", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });
  const m = { baseUrlEnv: "MP_URL", usernameEnv: "MP_USER", passwordEnv: "MP_PW", version: "4.10" };

  it("reads the named env vars", () => {
    process.env.MP_URL = "http://mp:8080/midpoint";
    process.env.MP_USER = "administrator";
    process.env.MP_PW = "secret";
    expect(midpointConnection(m)).toEqual({ baseUrl: "http://mp:8080/midpoint", user: "administrator", password: "secret" });
  });

  it("uses the fallback connection for unset vars (single-instance MIDPOINT_* defaults)", () => {
    delete process.env.MP_URL;
    delete process.env.MP_USER;
    delete process.env.MP_PW;
    const fb = { baseUrl: "http://localhost:8080/midpoint", user: "administrator", password: "Test5ecr3t" };
    expect(midpointConnection(m, fb)).toEqual(fb);
  });

  it("throws (no silent wrong instance) when a var is unset and no fallback is given", () => {
    delete process.env.MP_URL;
    expect(() => midpointConnection(m)).toThrow(/env var MP_URL is not set/);
  });
});

describe("drivenGuiSystem", () => {
  const mid = (version: string): SystemSpec => ({
    midpoint: { baseUrlEnv: "U", usernameEnv: "N", passwordEnv: "P", version },
  });
  const kc: SystemSpec = { keycloak: { urlEnv: "KU", realmEnv: "KR", clientIdEnv: "KC" } };

  it("defaults to the sole midpoint system (midPoint journeys are the default)", () => {
    const suite = { systems: { idm: mid("4.10"), sso: kc } } as unknown as Suite;
    expect(drivenGuiSystem(suite)).toEqual({ name: "idm", kind: "midpoint", midpoint: (suite.systems.idm as { midpoint: unknown }).midpoint });
  });

  it("defaults to the sole driveable system in a Keycloak-only suite", () => {
    const suite = { systems: { sso: kc } } as unknown as Suite;
    expect(drivenGuiSystem(suite)).toEqual({ name: "sso", kind: "keycloak" });
  });

  it("resolves a named system regardless of kind", () => {
    const suite = { systems: { idm: mid("4.10"), sso: kc } } as unknown as Suite;
    expect(drivenGuiSystem(suite, "sso")).toEqual({ name: "sso", kind: "keycloak" });
  });

  it("throws when the named system is not GUI-driveable", () => {
    const suite = { systems: { hr: { csv: { fileName: "x.csv", columns: ["a"], idColumn: "a" } }, idm: mid("4.10") } } as unknown as Suite;
    expect(() => drivenGuiSystem(suite, "hr")).toThrow(/not a GUI-driveable/);
  });

  it("throws (ambiguous) when several driveable systems exist and none is named", () => {
    const suite = { systems: { idm: mid("4.10"), ac: mid("4.4") } } as unknown as Suite;
    expect(() => drivenGuiSystem(suite)).toThrow(/ambiguous GUI target/);
  });
});
