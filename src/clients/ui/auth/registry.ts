/**
 * clients — auth-provider registry: how a session AUTHENTICATES, kept orthogonal to
 * the midPoint-version page objects.
 *
 * Login is the only screen SSO changes; request/approve stay version-dependent.
 * So the suite picks an auth provider (`gui.auth.type`) independently of the GUI
 * `version`. The default sentinel `midpoint` means "use the version module's own
 * `login` form"; any other key resolves a `login` factory here that OVERRIDES it
 * (e.g. Keycloak SSO). Static registry — like loader.ts's version REFERENCES — so
 * the engine bundles cleanly; add a provider = one module + one line below.
 */
import type { LoginPage, PageContext } from "../contract.ts";
import { keycloakLogin } from "./keycloak.ts";

/** Sentinel auth type: keep the midPoint version module's native login (default). */
export const NATIVE_AUTH = "midpoint";

/** Non-native login factories keyed by `gui.auth.type`. */
export const AUTH_PROVIDERS: Record<string, (ctx: PageContext) => LoginPage> = {
  keycloak: keycloakLogin,
};

/** Selectable auth types (native + registered providers), for diagnostics. */
export function availableAuthTypes(): string[] {
  return [NATIVE_AUTH, ...Object.keys(AUTH_PROVIDERS)];
}
