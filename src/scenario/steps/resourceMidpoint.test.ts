/**
 * Unit: resolveResourceMidpoint — which midPoint instance a connector-mediated
 * `resource` is driven through (its version is the discriminator here). No stack.
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveResourceMidpoint } from "./resourceMidpoint.ts";
import type { Suite, ResourceSystemConfig } from "../suite.ts";
import type { Config } from "../../config.ts";

const cfg = { midpoint: { baseUrl: "http://default/midpoint", user: "u", password: "p" } } as Config;

/** A midpoint system whose connection NAMES `<prefix>_URL/_USER/_PW`. */
const mp = (version: string, prefix: string) => ({
  midpoint: { baseUrlEnv: `${prefix}_URL`, usernameEnv: `${prefix}_USER`, passwordEnv: `${prefix}_PW`, version },
});
const csv = { csv: { fileName: "x", columns: ["a"], idColumn: "a" } };
const suiteOf = (systems: Record<string, unknown>): Suite => ({ systems }) as unknown as Suite;
const res = (midpoint?: string): ResourceSystemConfig => ({ objectClass: "ri:x", midpoint });

const ENV = ["MP_A_URL", "MP_A_USER", "MP_A_PW", "MP_B_URL", "MP_B_USER", "MP_B_PW"];
afterEach(() => ENV.forEach((k) => delete process.env[k]));
const setEnv = (prefix: string) => {
  process.env[`${prefix}_URL`] = `http://${prefix}/midpoint`;
  process.env[`${prefix}_USER`] = "u";
  process.env[`${prefix}_PW`] = "p";
};

describe("resolveResourceMidpoint", () => {
  it("uses the sole midPoint when `midpoint` is omitted (falls back to MIDPOINT_* defaults)", () => {
    // env vars unset → the sole instance falls back to cfg.midpoint, so it still resolves.
    const { version } = resolveResourceMidpoint(suiteOf({ idm: mp("4.10", "MP_A") }), res(), cfg);
    expect(version).toBe("4.10");
  });

  it("routes to the NAMED instance when several midPoints exist (not the first/primary)", () => {
    setEnv("MP_B");
    const suite = suiteOf({ idm: mp("4.10", "MP_A"), ac: mp("4.0", "MP_B") });
    expect(resolveResourceMidpoint(suite, res("ac"), cfg).version).toBe("4.0");
  });

  it("REQUIRES `midpoint` when several midPoints exist (no silent default)", () => {
    const suite = suiteOf({ idm: mp("4.10", "MP_A"), ac: mp("4.0", "MP_B") });
    expect(() => resolveResourceMidpoint(suite, res(), cfg)).toThrow(/the suite has 2 midPoint systems/);
  });

  it("throws when the named instance is not a declared midPoint (a csv by that name is not a candidate)", () => {
    const suite = suiteOf({ idm: mp("4.10", "MP_A"), ac: csv });
    expect(() => resolveResourceMidpoint(suite, res("ac"), cfg)).toThrow(/no such midPoint system is declared/);
  });

  it("throws when no midPoint system is declared", () => {
    expect(() => resolveResourceMidpoint(suiteOf({ app: csv }), res(), cfg)).toThrow(/none declared/);
  });

  it("a NAMED instance is strict — its own env vars must be set (no fallback to the defaults)", () => {
    const suite = suiteOf({ idm: mp("4.10", "MP_A"), ac: mp("4.0", "MP_B") });
    expect(() => resolveResourceMidpoint(suite, res("ac"), cfg)).toThrow(/MP_B_URL is not set/);
  });
});
