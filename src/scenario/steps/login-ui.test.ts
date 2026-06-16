/**
 * Unit: the login-ui smoke step — no running stack, no browser. Covers the handler's
 * declaration surface (match/token/detail/schema) and that `run` drives the auth
 * via the UI driver's session (logging in as the named principal with the GUI
 * password), with a fake driver so no browser is launched.
 */
import { describe, it, expect } from "vitest";
import { loginUiStep } from "./login-ui.ts";
import type { RunContext } from "./types.ts";

describe("login-ui step", () => {
  it("matches its own declaration and nothing else", () => {
    expect(loginUiStep.match({ "login-ui": { as: "administrator" } })).toBe(true);
    expect(loginUiStep.match({ "request-ui": { as: "alice" } })).toBe(false);
    expect(loginUiStep.match(null)).toBe(false);
  });

  it("renders a token and a one-line detail naming the principal", () => {
    const step = { "login-ui": { as: "administrator" } };
    expect(loginUiStep.token(step)).toBe("login-ui");
    expect(loginUiStep.detail(step, { suite: {} as never })).toContain("administrator");
  });

  it("logs in as the named principal using the GUI password", async () => {
    const calls: Array<{ login: string; password: string }> = [];
    const ctx = {
      ui: { verifyLogin: async (login: string, password: string) => (void calls.push({ login, password }), true) },
      cfg: { gui: { password: "s3cret" } },
      suite: { systems: {} }, // no gui.principals → falls back to the shared password
    } as unknown as RunContext;
    await loginUiStep.run({ "login-ui": { as: "administrator" } }, ctx);
    expect(calls).toEqual([{ login: "administrator", password: "s3cret" }]);
  });

  it("resolves a named login (`to`) and passes its provider+target to verifyLogin", async () => {
    const calls: Array<{ login: string; password: string; via: unknown }> = [];
    const ctx = {
      ui: { verifyLogin: async (login: string, password: string, via: unknown) => (void calls.push({ login, password, via }), true) },
      cfg: { gui: { password: "s3cret" } },
      suite: { systems: {}, gui: { version: "4.10", logins: { admin: { auth: "keycloak", target: "/admin/" } } } },
    } as unknown as RunContext;
    await loginUiStep.run({ "login-ui": { as: "admin", password: "admin", to: "admin" } }, ctx);
    expect(calls).toEqual([{ login: "admin", password: "admin", via: { auth: "keycloak", target: "/admin/" } }]);
  });

  it("throws a clear error when `to` names an undeclared login", async () => {
    const ctx = {
      ui: { verifyLogin: async () => true },
      cfg: { gui: { password: "s3cret" } },
      suite: { systems: {}, gui: { version: "4.10", logins: { account: { auth: "keycloak" } } } },
    } as unknown as RunContext;
    await expect(loginUiStep.run({ "login-ui": { as: "x", to: "admin" } }, ctx)).rejects.toThrow(
      /"to: admin" is not declared.*known: account/,
    );
  });

  it("uses the password override when given, and asserts failure for expectFailure", async () => {
    const calls: Array<{ login: string; password: string }> = [];
    const ctx = {
      ui: { verifyLogin: async (login: string, password: string) => (void calls.push({ login, password }), false) },
      cfg: { gui: { password: "s3cret" } },
      suite: { systems: {} },
    } as unknown as RunContext;
    // override password + expectFailure (login returns false) → passes
    await loginUiStep.run({ "login-ui": { as: "107n", password: "p@ssw0rd", expectFailure: true } }, ctx);
    expect(calls).toEqual([{ login: "107n", password: "p@ssw0rd" }]);
    // a login that unexpectedly succeeds where failure was expected → throws
    const okCtx = {
      ui: { verifyLogin: async () => true },
      cfg: { gui: { password: "s3cret" } },
      suite: { systems: {} },
    } as unknown as RunContext;
    await expect(loginUiStep.run({ "login-ui": { as: "107n", expectFailure: true } }, okCtx)).rejects.toThrow();
  });
});
