/**
 * Unit: capture-account + expect-account-changed — capture an LDAP attribute and
 * poll until it differs. The LDAP read is mocked (no directory); asserts the slot
 * value and the change/no-change outcomes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { readLdapAccountAttr } = vi.hoisted(() => ({ readLdapAccountAttr: vi.fn(async (_s: unknown, _id: string, _a: string) => [] as string[]) }));
vi.mock("../../actions/ldapAttr.ts", () => ({ readLdapAccountAttr }));

import { captureAccountStep } from "./capture-account.ts";
import { expectAccountChangedStep } from "./expect-account-changed.ts";
import type { RunContext } from "./types.ts";
import type { Suite, SystemSpec } from "../suite.ts";

const ldapSys: SystemSpec = { ldap: {} } as unknown as SystemSpec;

function ctx(state: RunContext["state"] = {}): RunContext {
  return {
    suite: { systems: { "example-ldap": ldapSys } } as unknown as Suite,
    cfg: { poll: { timeoutMs: 200, intervalMs: 0 } },
    state,
  } as unknown as RunContext;
}

beforeEach(() => readLdapAccountAttr.mockReset());

describe("capture-account", () => {
  it("captures the attribute value(s) into the slot", async () => {
    readLdapAccountAttr.mockResolvedValue(["{SSHA}aaa"]);
    const c = ctx();
    await captureAccountStep.run({ "capture-account": { system: "example-ldap", identifier: "u", attr: "userPassword", as: "pw" } }, c);
    expect(c.state.captures?.pw).toEqual(["{SSHA}aaa"]);
  });

  it("rejects a non-LDAP system", async () => {
    const c = ctx();
    c.suite.systems["db"] = { db: {} } as unknown as SystemSpec;
    await expect(
      captureAccountStep.run({ "capture-account": { system: "db", identifier: "u", attr: "x", as: "y" } }, c),
    ).rejects.toThrow(/not an LDAP system/);
  });
});

describe("expect-account-changed", () => {
  it("passes once the value differs from the captured baseline", async () => {
    readLdapAccountAttr
      .mockResolvedValueOnce(["{SSHA}aaa"]) // unchanged
      .mockResolvedValueOnce(["{SSHA}bbb"]); // changed
    const c = ctx({ captures: { pw: ["{SSHA}aaa"] } });
    await expect(
      expectAccountChangedStep.run({ "expect-account-changed": { system: "example-ldap", identifier: "u", attr: "userPassword", from: "pw" } }, c),
    ).resolves.toBeUndefined();
    expect(readLdapAccountAttr).toHaveBeenCalledTimes(2);
  });

  it("throws when the value never changes (poll times out)", async () => {
    readLdapAccountAttr.mockResolvedValue(["{SSHA}aaa"]);
    const c = ctx({ captures: { pw: ["{SSHA}aaa"] } });
    await expect(
      expectAccountChangedStep.run({ "expect-account-changed": { system: "example-ldap", identifier: "u", attr: "userPassword", from: "pw" } }, c),
    ).rejects.toThrow(/did NOT change/);
  });

  it("throws when the capture slot is missing", async () => {
    const c = ctx({});
    await expect(
      expectAccountChangedStep.run({ "expect-account-changed": { system: "example-ldap", identifier: "u", attr: "userPassword", from: "absent" } }, c),
    ).rejects.toThrow(/no capture slot/);
  });
});
