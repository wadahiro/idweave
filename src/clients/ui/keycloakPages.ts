/**
 * clients — page objects for a GUI-driven KEYCLOAK system.
 *
 * Keycloak is a co-equal main target, not a midPoint screen, so its GUI driving
 * does NOT load a midPoint version module. Today the only Keycloak GUI step is the
 * `login-ui` smoke (its own Account / Admin console login), so this set provides
 * just the version-independent Keycloak login provider; the midPoint-shaped
 * request/approve screens are not applicable and throw a clear error if reached.
 *
 * When Keycloak console assertions beyond login appear, this is the place to grow
 * (add screens here, and a `version` to KeycloakSystemConfig to select them) —
 * symmetric with the midPoint `pages/<version>.ts` modules.
 */
import type { PageContext, ResolvedPageObjects } from "./contract.ts";
import { keycloakLogin } from "./auth/keycloak.ts";

/** A midPoint-screen factory reached on a Keycloak target — not applicable. */
function notOnKeycloak(screen: string): never {
  throw new Error(
    `The "${screen}" GUI is a midPoint screen and is not available on a Keycloak system — ` +
      `only login-ui drives a Keycloak system today.`,
  );
}

/**
 * Page objects for a Keycloak GUI target: the Keycloak login provider is the
 * `login` (and the only resolvable provider); the midPoint-shaped screens throw if
 * reached. `loginTarget` (PageContext, set from the named login's `target:`) picks
 * which console — Account (`/realms/<realm>/account`) or Admin (`/admin/`).
 */
export function keycloakGuiPageObjects(): ResolvedPageObjects {
  const login = (ctx: PageContext) => keycloakLogin(ctx);
  return {
    login,
    loginFor: () => login,
    requestAccess: () => notOnKeycloak("requestAccess"),
    workItems: () => notOnKeycloak("workItems"),
    flows: {},
  };
}
