/**
 * Step: a PRECONDITION that searches a federated user in Keycloak — a SINGLE admin-REST
 * lookup whose SIDE EFFECT is making Keycloak re-check the LDAP federation and DROP its
 * stale imported copy once the directory entry is gone. So a journey that RE-CREATES that
 * identity (e.g. re-inviting an external user after clear-focus) starts clean: Keycloak
 * caches LDAP-federated users, and the stale copy would otherwise make the re-registration
 * skip its profile/password required-actions.
 *
 * Pair it AFTER clear-focus (which removes the midPoint focus AND deprovisions the
 * directory entry) — once the LDAP entry is settled the lookup already returns empty (the
 * drop is synchronous), so no poll or manual delete is needed. Requires a configured
 * Keycloak admin connection (KEYCLOAK_ADMIN_* env).
 */
import { KeycloakAdmin } from "../../clients/keycloakAdmin.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface SearchFederatedUserStep {
  "search-federated-user": {
    /** Federated username to search (for these suites, the user's login = email/name). */
    login: string;
  };
}

export const searchFederatedUserStep: StepHandler<SearchFederatedUserStep> = {
  kind: "search-federated-user",
  phase: "reset",
  appliesTo: ["keycloak"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["search-federated-user"],
    description: "Precondition: search a federated user (the lookup makes Keycloak drop the stale copy once its LDAP entry is gone).",
    properties: {
      "search-federated-user": {
        type: "object",
        additionalProperties: false,
        required: ["login"],
        properties: {
          login: { type: "string", description: "Federated username to search (drops the stale Keycloak copy)." },
        },
      },
    },
  },

  match(step): step is SearchFederatedUserStep {
    return typeof step === "object" && step !== null && "search-federated-user" in step;
  },

  async run(step, ctx: RunContext) {
    const { login } = step["search-federated-user"];
    if (!ctx.cfg.idpAdmin) {
      throw new Error(
        `search-federated-user needs a Keycloak admin connection — set KEYCLOAK_ADMIN_URL, ` +
          `KEYCLOAK_ADMIN_REALM, KEYCLOAK_ADMIN_CLIENT_ID and KEYCLOAK_ADMIN_SECRET.`,
      );
    }
    await new KeycloakAdmin(ctx.cfg.idpAdmin).searchFederatedUser(login);
  },

  token() {
    return "search-federated-user";
  },

  detail(step) {
    return `**search-federated-user** \`${step["search-federated-user"].login}\` (drop stale federated copy)`;
  },
};
