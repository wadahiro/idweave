/**
 * clients — Keycloak admin REST client (the IdP-admin side of the keycloak auth integration).
 *
 * Used by the `search-federated-user` precondition: Keycloak caches LDAP-federated users,
 * so deleting the directory entry (via clear-focus) leaves a STALE Keycloak account
 * — a re-registration/invitation then links to it and skips the profile/password
 * required-actions. Looking the user up over the admin REST API makes Keycloak try
 * to load it from the federation, notice the directory entry is gone, and drop it
 * from its own store. So a lookup that returns "absent" IS the eviction.
 *
 * Auth is EITHER a service-account `client_credentials` grant (clientId+secret) OR a
 * `password` grant (admin-cli + a master-realm admin user) — see `IdpAdminConfig`.
 */
import type { IdpAdminConfig } from "../config.ts";

/** A Keycloak admin REST failure carrying the HTTP status, so callers can tell a
 * permanent authz error (401/403 — never retry) from a transient one. */
export class KeycloakAdminError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "KeycloakAdminError";
  }
}

/**
 * A Keycloak user representation (the admin REST shape) — known scalar fields plus
 * `attributes` (custom realm-user attributes, each a string array) and any other
 * fields the server returns. Loosely typed: the assert-target projection reads it
 * generically (top-level field OR custom attribute).
 */
export interface KeycloakUser {
  attributes?: Record<string, string[]>;
  [field: string]: unknown;
}

export class KeycloakAdmin {
  constructor(private readonly cfg: IdpAdminConfig) {}

  private async token(): Promise<string> {
    // Authenticate against `authRealm` (e.g. `master` for an admin-cli password
    // grant), which may differ from the realm the admin operations TARGET.
    const authRealm = this.cfg.authRealm ?? this.cfg.realm;
    const usePassword = this.cfg.username !== undefined && this.cfg.password !== undefined;
    const body = usePassword
      ? new URLSearchParams({
          grant_type: "password",
          client_id: this.cfg.clientId,
          username: this.cfg.username!,
          password: this.cfg.password!,
        })
      : new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.cfg.clientId,
          client_secret: this.cfg.secret ?? "",
        });
    const res = await fetch(`${this.cfg.url}/realms/${authRealm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new KeycloakAdminError(
        `Keycloak admin token failed (${res.status}) for client "${this.cfg.clientId}" @ ${authRealm}`,
        res.status,
      );
    }
    const body2 = (await res.json()) as { access_token?: string };
    if (!body2.access_token) throw new Error("Keycloak admin token response had no access_token");
    return body2.access_token;
  }

  /** Ids of users in the realm whose username exactly matches `login`. */
  async findByUsername(login: string): Promise<string[]> {
    const token = await this.token();
    const url = `${this.cfg.url}/admin/realms/${this.cfg.realm}/users?exact=true&username=${encodeURIComponent(login)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Keycloak admin user search failed (${res.status}) for "${login}"`);
    const users = (await res.json()) as Array<{ id?: string }>;
    return Array.isArray(users) ? users.flatMap((u) => (u.id ? [u.id] : [])) : [];
  }

  /**
   * The FULL representation of the realm user whose username exactly matches `login`
   * (null if none) — top-level fields plus `attributes`, the input for an assert
   * target's projection. Throws if more than one matches (username is unique per
   * realm, so this signals a malformed realm rather than an ambiguous identifier).
   */
  async getByUsername(login: string): Promise<KeycloakUser | null> {
    const token = await this.token();
    const url = `${this.cfg.url}/admin/realms/${this.cfg.realm}/users?exact=true&username=${encodeURIComponent(login)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Keycloak admin user search failed (${res.status}) for "${login}"`);
    const users = (await res.json()) as KeycloakUser[];
    if (!Array.isArray(users) || users.length === 0) return null;
    if (users.length > 1) throw new Error(`Expected at most one Keycloak user username="${login}", found ${users.length}`);
    return users[0]!;
  }

  /**
   * Create a realm user from a raw admin-REST representation (the CRUD-source write
   * path — unlike `createUser`, nothing is defaulted). Throws on any non-2xx INCLUDING
   * 409: an `add` of an already-present user is an error (use `replace` to update one).
   */
  async createUserRep(rep: Record<string, unknown>): Promise<void> {
    const token = await this.token();
    const res = await fetch(`${this.cfg.url}/admin/realms/${this.cfg.realm}/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(rep),
    });
    if (!res.ok) throw new Error(`Keycloak create user failed (${res.status}) for "${rep.username}": ${await res.text().catch(() => "")}`);
  }

  /** Update a realm user by id with a (merged) representation — PUT /users/{id}. */
  async updateUserRep(id: string, rep: Record<string, unknown>): Promise<void> {
    const token = await this.token();
    const res = await fetch(`${this.cfg.url}/admin/realms/${this.cfg.realm}/users/${id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(rep),
    });
    if (!res.ok) throw new Error(`Keycloak update user failed (${res.status}) for ${id}: ${await res.text().catch(() => "")}`);
  }

  /** Delete the realm user(s) whose username matches `login` (idempotent: absent = no-op). */
  async deleteByUsername(login: string): Promise<void> {
    for (const id of await this.findByUsername(login)) await this.deleteById(id);
  }

  /** Delete a Keycloak user (local import) by id; a 404 is fine (already gone). */
  async deleteById(id: string): Promise<void> {
    const token = await this.token();
    const res = await fetch(`${this.cfg.url}/admin/realms/${this.cfg.realm}/users/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Keycloak admin user delete failed (${res.status}) for ${id}`);
  }

  /**
   * Search a federated user — a SINGLE admin-REST lookup that, as a side effect, makes
   * Keycloak re-check the federation and DROP its stale imported copy once the directory
   * entry is gone (deleted by midPoint deprovisioning). No poll, no manual delete: when the
   * LDAP entry is already settled the first lookup returns empty (the drop is synchronous
   * within the query), so letting the federation reflect the deletion is both realistic and
   * deterministic. Pair it AFTER clear-focus (which deprovisions the entry).
   */
  async searchFederatedUser(login: string): Promise<void> {
    await this.findByUsername(login);
  }

  /**
   * Create a local realm user that is FULLY SET UP (so a direct-grant login
   * succeeds): an enabled, non-temporary password and the profile attributes the
   * declarative user profile marks required (email/firstName/lastName — required by
   * default since Keycloak 24, else login fails with "Account is not fully set up").
   */
  async createUser(login: string, password: string): Promise<void> {
    const token = await this.token();
    const res = await fetch(`${this.cfg.url}/admin/realms/${this.cfg.realm}/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: login,
        enabled: true,
        emailVerified: true,
        email: `${login}@example.com`,
        firstName: login,
        lastName: login,
        requiredActions: [],
        credentials: [{ type: "password", value: password, temporary: false }],
      }),
    });
    // 201 Created on success; 409 means the user already exists (idempotent-enough for a fixture).
    if (!res.ok && res.status !== 409) throw new Error(`Keycloak create user failed (${res.status}) for "${login}"`);
  }

  /**
   * Try a direct-access-grant (resource-owner password) login as `login`. Returns
   * true ONLY on a 200 token response; any 4xx (bad/absent credentials, account not
   * fully set up, client not allowed) is a failed login → false; a 5xx/unexpected
   * status throws. The realm's login client must have `directAccessGrantsEnabled`.
   * Used as the check that a user can (or, after a cache-clear, can no longer) log in.
   */
  async loginAs(clientId: string, login: string, password: string): Promise<boolean> {
    const res = await fetch(`${this.cfg.url}/realms/${this.cfg.realm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", client_id: clientId, username: login, password }),
    });
    if (res.ok) return true;
    if (res.status >= 400 && res.status < 500) return false;
    throw new Error(`Keycloak direct-grant login failed unexpectedly (${res.status}) for "${login}"`);
  }

  /**
   * Invalidate one of the realm's DB-derived in-memory caches over admin REST
   * (the same action as the GUI realm-settings cache buttons). `which` is the
   * endpoint suffix: "realm" | "user" | "keys". Requires `manage-realm`.
   */
  async clearCache(which: "realm" | "user" | "keys"): Promise<void> {
    const token = await this.token();
    const res = await fetch(`${this.cfg.url}/admin/realms/${this.cfg.realm}/clear-${which}-cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new KeycloakAdminError(`Keycloak clear-${which}-cache failed (${res.status}) @ realm ${this.cfg.realm}`, res.status);
  }
}
