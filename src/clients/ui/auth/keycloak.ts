/**
 * clients.5 — Keycloak SSO login provider.
 *
 * Used when the midPoint GUI sits behind an OIDC proxy (e.g. oauth2-proxy) that
 * redirects unauthenticated requests to a Keycloak realm login, instead of
 * midPoint's own /login form. This is the ONE screen SSO changes — the
 * request/approve journeys after login stay version-DEPENDENT (see `pages/`).
 *
 * It is selected by the suite (`gui.auth: { type: keycloak }`) and replaces the
 * version module's native `login` factory; everything else is unchanged.
 *
 * The provider is deliberately tied to the IdP (Keycloak), NOT to a midPoint
 * major, so it lives here rather than in a `pages/<version>.ts` module. It drives
 * the stock Keycloak login theme and tolerates both layouts:
 *  • single-page  — `#username` + `#password` on one form (the stock Account /
 *    Admin console login), OR
 *  • identity-first — `#username` first, the password on a second page (a common
 *    SSO realm config).
 * The "logged in" signal is ORIGIN-AGNOSTIC: the login form is gone with no error.
 * That covers an OIDC redirect OFF the IdP (e.g. onto the midPoint dashboard) AND
 * a SAME-ORIGIN landing on a Keycloak console — so the one provider smokes both
 * an SSO-fronted app and Keycloak's own Account/Admin consoles. `loginTarget`
 * (PageContext) is the authenticated route navigated to in order to trigger login
 * (default `/self/dashboard`).
 */
import type { Page } from "playwright";
import type { LoginPage, PageContext } from "../contract.ts";

const DEFAULT_TARGET = "/self/dashboard";

class KeycloakLogin implements LoginPage {
  private readonly target: string;
  constructor(
    private readonly page: Page,
    baseUrl: string,
    /** Cold-start gate: timeout for the first IdP contact (nav + form wait). */
    private readonly loginTimeoutMs: number,
    /** Authenticated route to navigate to so the IdP login is triggered. */
    target: string = DEFAULT_TARGET,
  ) {
    this.target = target.startsWith("http") ? target : `${baseUrl}${target}`;
  }

  async login(user: string, password: string): Promise<void> {
    // If an app hasn't already redirected us to Keycloak, hit an authenticated
    // route so the IdP login is presented (the app's own /login is bypassed).
    if (!(await this.usernameVisible())) {
      await this.reachLoginForm();
    }
    // Stock Keycloak login: #username / #password / #kc-login (the submit input).
    await this.page.fill("#username", user);
    if (await this.passwordVisible()) {
      // Single-page form (stock console login): username + password together.
      await this.page.fill("#password", password);
    } else {
      // Identity-first flow: submit the username, then fill the password page.
      await this.page.click("#kc-login");
      await this.page.locator("#password").waitFor({ state: "visible" });
      await this.page.fill("#password", password);
    }
    await this.page.click("#kc-login");
    await this.awaitOutcome(user);
  }

  /**
   * Resolve once authenticated, throw on rejected credentials — ORIGIN- and
   * theme-agnostic, via the URL. A correct login always navigates OFF the IdP
   * login URLs (Keycloak serves the form at `…/protocol/openid-connect/auth` and
   * re-posts to `…/login-actions/…`) onto the app — an OIDC redirect off the IdP
   * OR a same-origin console route. A rejected login RE-RENDERS the form at the
   * `login-actions` URL (a transient detach of `#kc-login` would falsely read as
   * success, so we key on the URL, not the element). Still on a login URL at the
   * deadline → throw. (Use a tight `loginTimeoutMs` for a deliberate negative
   * check so it fails fast.)
   */
  private async awaitOutcome(user: string): Promise<void> {
    const timeout = Math.min(this.loginTimeoutMs, 30_000);
    const onLoginUrl = (u: URL) =>
      u.pathname.includes("/login-actions/") || u.pathname.endsWith("/protocol/openid-connect/auth");
    try {
      await this.page.waitForURL((url) => !onLoginUrl(url), { timeout });
    } catch {
      throw new Error(`Keycloak login failed for "${user}" (still on the IdP login form — credentials rejected or timed out).`);
    }
    await this.page.waitForLoadState("load").catch(() => {});
  }

  /**
   * Navigate to the authenticated route and wait for the Keycloak login form to
   * appear — POLLING by re-navigation, not a single waitFor.
   *
   * This is the harness's FIRST contact with the stack. Right after a
   * `snapshot-restore` reboot the app path may not be serviceable yet: an OIDC proxy
   * in front of midPoint reboots too, so for a while the target yields a 502 / a
   * redirect loop / even the app's own native login — a page on which `#username`
   * will NEVER appear without re-navigating. A single `waitFor` would sit on that
   * dead page until it times out (observed: 90s wasn't enough). So we re-`goto` on
   * an interval until the Keycloak form actually loads, bounded by `loginTimeoutMs`
   * (default 90s; raise via GUI_LOGIN_TIMEOUT_MS for a very cold environment).
   */
  private async reachLoginForm(): Promise<void> {
    const deadline = Date.now() + this.loginTimeoutMs;
    const navTimeout = Math.min(this.loginTimeoutMs, 30_000);
    let lastErr: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.page.goto(this.target, { timeout: navTimeout });
        // A short per-attempt wait: if the form is here it shows promptly; if this
        // attempt landed on a 502/native-login it won't, so we re-navigate.
        await this.page.locator("#username").waitFor({ state: "visible", timeout: 5_000 });
        return;
      } catch (e) {
        lastErr = e;
        if (Date.now() >= deadline) break;
        // Brief back-off before re-navigating (let the proxy/GUI finish booting).
        await this.page.waitForTimeout(2_000);
      }
    }
    throw new Error(
      `Keycloak login form (#username) did not become reachable at ${this.target} ` +
        `within ${this.loginTimeoutMs}ms (cold-start gate). Last error: ${String(lastErr)}`,
    );
  }

  /**
   * Is the current page a Keycloak login? Waits briefly because an app often
   * client-side-redirects to the IdP AFTER its own page loads, so an instant
   * check right after navigation would miss it. Resolves false (no wait wasted on
   * the happy path: the field appears as soon as the redirect lands).
   */
  async isAtLoginPage(): Promise<boolean> {
    return this.page
      .locator("#username")
      .waitFor({ state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false);
  }

  /** Instant check: is the Keycloak `#username` field already on the page? */
  private async usernameVisible(): Promise<boolean> {
    const u = this.page.locator("#username");
    return (await u.count()) > 0 && (await u.isVisible().catch(() => false));
  }

  /** Is a password field present and visible on the current (username) page? */
  private async passwordVisible(): Promise<boolean> {
    const pw = this.page.locator("#password");
    return (await pw.count()) > 0 && (await pw.isVisible());
  }
}

/** Factory matching the `login` page-object contract (the pluggable auth-provider). */
export function keycloakLogin(ctx: PageContext): LoginPage {
  return new KeycloakLogin(ctx.page, ctx.baseUrl, ctx.loginTimeoutMs ?? 30_000, ctx.loginTarget);
}
