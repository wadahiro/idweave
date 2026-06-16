/**
 * Step: smoke-test that a principal can LOG IN through the GUI and reach the
 * authenticated dashboard. The login IS the assertion — the driven system's login
 * provider (a midPoint instance's native/SSO form per its `auth`, or a Keycloak
 * console) throws if it never lands on the post-login page. Used to verify the auth
 * wiring (notably SSO) without driving a full request/approve journey.
 *
 * With `expectFailure`, the assertion is INVERTED: the login MUST fail (e.g. a user
 * whose registration errored has no usable password) — the step throws if it
 * unexpectedly succeeds.
 */
import { guiPassword, resolveLogin } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface LoginUiStep {
  "login-ui": {
    /** Login of the principal to authenticate as (GUI password from env). */
    as: string;
    /** Password to authenticate with (default: the principal's GUI password / env). */
    password?: string;
    /** Named login from suite `gui.logins` to drive (target system + route). Omit → the suite default. */
    to?: string;
    /** Assert the login FAILS instead of succeeds (negative test). */
    expectFailure?: boolean;
  };
}

export const loginUiStep: StepHandler<LoginUiStep> = {
  kind: "login-ui",
  phase: "act",
  appliesTo: ["midpoint", "keycloak"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["login-ui"],
    description: "Smoke: log in via the GUI as a principal and reach the dashboard (verifies auth wiring, incl. SSO).",
    properties: {
      "login-ui": {
        type: "object",
        additionalProperties: false,
        required: ["as"],
        properties: {
          as: { type: "string", description: "Login of the principal to authenticate as (GUI password from env)." },
          password: { type: "string", description: "Password to authenticate with (default: the principal's GUI password)." },
          to: { type: "string", description: "Named login from suite gui.logins to drive (target system + route); omit for the suite default." },
          expectFailure: { type: "boolean", description: "Assert the login FAILS instead of succeeds (negative test)." },
        },
      },
    },
  },

  match(step): step is LoginUiStep {
    return typeof step === "object" && step !== null && "login-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const { as, password, to, expectFailure } = step["login-ui"];
    const pw = password ?? guiPassword(ctx.suite, as, ctx.cfg.gui.password);
    // A named login (gui.logins) selects the provider + target; omit → suite default.
    const via = to ? resolveLogin(ctx.suite, to) : undefined;
    // Fresh login each time (not the cached session), so the same user can be
    // checked with different passwords and a negative check really re-authenticates.
    const ok = await ctx.ui.verifyLogin(as, pw, via);
    const where = to ? ` (to: ${to})` : "";
    if (expectFailure && ok) throw new Error(`Expected login as "${as}"${where} to FAIL, but it succeeded.`);
    if (!expectFailure && !ok) throw new Error(`Expected login as "${as}"${where} to succeed, but it failed.`);
  },

  token() {
    return "login-ui";
  },

  detail(step) {
    const s = step["login-ui"];
    return `**login-ui** as \`${s.as}\`${s.to ? ` → \`${s.to}\`` : ""}${s.expectFailure ? " (expect failure)" : ""}`;
  },
};
