/**
 * scenario — Suite manifest.
 *
 * The shared description of the deployment a set of scenarios drives: which
 * midPoint resources they use and how to read each target's real state. It
 * binds the logical names scenarios reference (e.g. `app-target`) to concrete
 * resources (OIDs, files, columns).
 *
 * This is SUITE DATA, not engine config — it lives with the scenarios
 * (examples/ for the demo, testdata/ for the real private suite), so the
 * engine stays generic and reusable (no baked-in deployment specifics).
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import Ajv from "ajv";
import type { ObjectType, SystemKind } from "./steps/types.ts";
import type { ConsistencyRule } from "../verify/consistency.ts";
import type { MidpointConfig, IdpAdminConfig } from "../config.ts";
import suiteSchema from "./suite.schema.json" with { type: "json" };

/** CSV system: a file the harness writes (as a source) and/or reads (as a target). */
export interface CsvSystemConfig {
  /** File name under the host CSV dir. */
  fileName: string;
  /** Column names / header order. */
  columns: string[];
  /** Identifier column for delta ops (add/replace/remove) and account lookup. */
  idColumn: string;
}

/**
 * LDAP/AD system: a directory subtree the harness writes (as a source) and/or
 * reads (as a target). An entry's attributes are the keys of each scenario row;
 * an entry's identity is the value of its `rdnAttr`. Connection: the `url`
 * (scheme selects TLS) and bind `dn` are suite data; only the bind PASSWORD is a
 * secret, taken from the env var named by `bind.passwordEnv`.
 */
export interface LdapSystemConfig {
  /** URL with scheme — ldap:// (plain) or ldaps:// (TLS). Env IDW_LDAP_<system>_URL overrides. */
  url: string;
  /** Bind principal (DN/UPN — not secret) and the env var holding its password. */
  bind: { dn: string; passwordEnv: string };
  /** DN whose direct children are the accounts (washed/repopulated like a CSV file). */
  containerDn: string;
  /** Identifying/RDN attribute (cn for AD, uid for OpenLDAP). DN = <rdnAttr>=<row[rdnAttr]>,<containerDn>. */
  rdnAttr: string;
  /** objectClass values on created entries; the first is also the reset filter class. */
  objectClasses: string[];
  /** Fixed attributes on every entry, e.g. { userAccountControl: "544" } for AD-enabled. */
  baseAttrs?: Record<string, string | string[]>;
  /** Map a cleartext row attribute to a password attribute (AD unicodePwd: UTF-16LE, quoted). */
  password?: { from: string; to?: string };
  /**
   * Attributes to PROJECT when reading this system as a target (the assertion
   * allowlist — like CSV `columns`). The directory read returns only these (plus
   * the dn), so the expected pins a stable, intent-chosen subset and ignores
   * server-managed/operational/secret attributes. Omit to capture all non-operational
   * attributes (a denylist strips userPassword, entryUUID, timestamps, …).
   */
  attributes?: string[];
  /**
   * Attribute names whose VALUE is volatile per run (e.g. an attribute holding a
   * run-minted composite id like `a/b/c` with random components) —
   * their value is replaced with a stable token, so the expected pins PRESENCE, not
   * the value (LDAP has no SQL predicate to normalize it). Case-insensitive.
   */
  mask?: string[];
  /**
   * CROSS-SYSTEM consistency: assert an attribute's (multi-)value EQUALS a transform
   * of a midPoint focus property — stronger than `mask` (presence). See
   * {@link ConsistencyRule} (shared with the db target): `from` + an optional
   * `listSeparator` + a transform method (`fields`). E.g. an attribute equals
   * `{a}/{b}/{c}` of a focus extension property.
   */
  consistentWith?: Record<string, ConsistencyRule>;
}

/**
 * SQL database system: a relational target the harness ASSERTS by querying (read
 * only — e.g. the backing store of an external-service mock, where the row IS the
 * deterministic test check for "active / expired / delivered"). The `url` SCHEME
 * picks the dialect (postgres:// -> pg [default], mysql://, sqlite:, sqlserver://);
 * the driver beyond pg is an optional dependency the consuming project installs.
 * Only the password is a secret (env var named by `passwordEnv`). The `query` is a
 * parameterized SELECT (suite DATA — no logic in code) whose `:id` binds the
 * account identifier; it returns the row asserted against the expected projection.
 */
export interface DbSystemConfig {
  /** Connection URL; scheme selects the dialect (postgres:// default). No password in it. */
  url: string;
  /** Name of the env var holding the connection password (the only secret). */
  passwordEnv: string;
  /** Parameterized SELECT; `:id` binds the lookup value. Returns the row(s) asserted. */
  query: string;
  /**
   * Optional parameterized UPDATE for the `db-mutate` step (suite DATA — no logic in
   * code), letting a scenario REWIND external mock state the same way `query` asserts
   * it. Binds `:id` (the linking value, via `linkFrom` exactly like `query`) and
   * `:value` (the new value the step supplies, e.g. a resolved relative date). The
   * project-specific extraction stays in the SQL (e.g.
   * `SET expires_at = cast(:value as timestamptz) WHERE item_key = split_part(:id,'/',2)`).
   * Use `cast(:value as t)` rather than `:value::t` so the `:name` binding parser is
   * not confused by `::`. Read-only systems omit it.
   */
  update?: string;
  /**
   * Columns to PROJECT when asserting (the allowlist, like LDAP `attributes`/CSV
   * `columns`) — pins a stable, intent-chosen subset and drops volatile columns
   * (auto ids, timestamps, blobs). Omit to assert every returned column.
   */
  columns?: string[];
  /**
   * Optional FOCUS LINKAGE for external rows keyed by a value midPoint holds, not a
   * stable identifier (e.g. a table keyed by a run-minted id that lives only in a
   * focus extension property). With `linkFrom`,
   * the account `identifier` is a FOCUS name: the engine reads that focus's `path`
   * property (MULTI-VALUE supported — a focus may hold several values), runs `query`
   * once per value (`:id` = each value), and asserts the UNION as an order-independent
   * SET (like `expect.projections`). Omit for a plain single-row lookup (`:id` = the
   * identifier itself). The project-specific extraction stays in the SQL (e.g.
   * `WHERE item_key = split_part(:id, '/', 2)`), keeping scenarios uniform.
   *
   * EITHER `path` (read the value(s) LIVE from the focus) OR `capture` (use value(s)
   * a `capture-focus` step recorded EARLIER under that slot name) — exactly one. Use
   * `capture` to assert a row whose linking value the run has since destroyed: e.g.
   * snapshot a value before it changes, then assert the now-stale old row by it,
   * since the focus no longer holds that value.
   */
  linkFrom?: { path?: string; capture?: string; type?: ObjectType };
  /**
   * CROSS-SYSTEM consistency on a returned COLUMN — the same mechanism as the ldap
   * target. Keep `linkFrom` on the natural key (e.g. emailAddress) to FIND the row,
   * and use this to verify a column carries a midPoint-derived value rather than
   * encoding the derivation into the query's WHERE. E.g. an external column holding a
   * comma-separated list of derived keys equals a focus multi-value extension
   * property transformed by the rule (`split: ","` + a `delimited` format).
   * On a set-equal match the column collapses to a token; a mismatch diffs.
   */
  consistentWith?: Record<string, ConsistencyRule>;
}

/**
 * A midPoint INSTANCE, declared as a system so a deployment with more than one
 * midPoint (e.g. a main `midpoint` plus an access-certification `midpoint-ac`) lists
 * them uniformly. Unlike the external systems, this isn't a read/write target — it's
 * a participant in restore (its `version` selects the version-correct cache-clear
 * after a rollback; the two instances may run DIFFERENT versions). Connection lives
 * in env, referenced here by var NAME (like `ldap.bind.passwordEnv`).
 */
export interface MidpointSystemConfig {
  /** Env var name holding the base URL (up to and including `/midpoint`). */
  baseUrlEnv: string;
  /** Env var name holding the admin username (REQUIRED — may differ per environment). */
  usernameEnv: string;
  /** Env var name holding the admin password. */
  passwordEnv: string;
  /**
   * midPoint MAJOR version (e.g. "4.10", "4.4") — PER INSTANCE; a deployment's
   * midPoints may differ. Selects BOTH the version-correct cache-clear payload AND
   * (when this instance is GUI-driven) the reference page-object module. This is
   * the single source of truth for the instance's version — no separate top-level
   * `gui.version` (which assumed one midPoint for the whole suite).
   */
  version: string;
  /**
   * Env var name holding the GUI base URL when it differs from the REST `baseUrlEnv`
   * — e.g. the web UI sits behind an SSO front-end on a different origin. Omit when
   * REST and GUI share the origin (the common case): the GUI uses `baseUrlEnv`.
   */
  guiBaseUrlEnv?: string;
  /**
   * Project page-object override module path (resolved relative to the suite dir),
   * for a deployment that customises a screen of THIS instance. Was the top-level
   * `gui.overrides`; per-instance now, since each midPoint may deviate differently.
   */
  overrides?: string;
  /**
   * Login provider for THIS instance's GUI. Omitted/`midpoint` uses the version's
   * native login form; `keycloak` drives an OIDC/Keycloak SSO login (the instance
   * sits behind an SSO proxy). Was the top-level `gui.auth`; per-instance now.
   */
  auth?: { type: "midpoint" | "keycloak" };
}

/**
 * A Keycloak INSTANCE, declared as a system so snapshot-restore can clear its in-memory
 * caches after a rollback — the IdP equivalent of the midPoint restore participant.
 * Keycloak's realm/user/keys caches (Infinispan, DB-derived) go STALE when a
 * near-non-stop restore rolls the DB back without restarting Keycloak; the
 * `afterRestore` hook invalidates them over admin REST. Connection lives in env,
 * referenced here by var NAME (a service-account client_credentials grant, the same
 * shape as `IdpAdminConfig`).
 *
 * It can ALSO be an ASSERT-ONLY target (read-only, like `db`): an `expect.accounts`
 * step reads a realm user over admin REST and asserts the attributes midPoint
 * provisioned to the IdP. Declaring `attributes`/`mask` opts the instance into that
 * role; the harness never writes to or resets Keycloak (so a suite that mutates it
 * must isolate via snapshot-restore, like any non-self-contained suite).
 */
export interface KeycloakSystemConfig {
  /** Env var name holding the Keycloak base URL (incl. any servlet path, e.g. http://host:8080). */
  urlEnv: string;
  /** Env var name holding the realm the admin operations TARGET (whose caches are cleared). */
  realmEnv: string;
  /** Env var name holding the admin client id (a service-account client, or `admin-cli` for password grant). */
  clientIdEnv: string;
  /** Env var name holding the client secret (client_credentials grant). Omit for password grant. */
  secretEnv?: string;
  /** Password grant (admin-cli + master admin): env var names for user/pass INSTEAD of `secretEnv`. */
  usernameEnv?: string;
  passwordEnv?: string;
  /** Env var name holding the realm to AUTHENTICATE against (default: the target realm; `master` for admin-cli). */
  authRealmEnv?: string;
  /**
   * Attributes to PROJECT when reading this Keycloak as an assert target (the
   * allowlist — like CSV `columns`/LDAP `attributes`). Each name matches EITHER a
   * top-level user field (`email`, `enabled`, `firstName`, …) OR a custom
   * realm-user attribute; the read returns only these. Omit to capture every
   * non-volatile field (a denylist strips id/createdTimestamp/access/…).
   */
  attributes?: string[];
  /**
   * User field/attribute names whose value is volatile per run — replaced with a
   * stable token so the expected pins PRESENCE, not the value. Case-sensitive (unlike
   * LDAP; Keycloak attribute names are case-sensitive).
   */
  mask?: string[];
  /** Cross-system consistency: assert a Keycloak user field/attribute equals a transform of a midPoint focus property (like ldap/db). */
  consistentWith?: Record<string, ConsistencyRule>;
}

/**
 * SCIM 2.0 system: a Service Provider the harness ASSERTS by reading a provisioned
 * resource over the standard REST API (read only, like `db` — midPoint typically
 * provisions OUTBOUND to a SCIM endpoint, so the real end-state to verify lives
 * there). The resource is fetched with a SCIM filter (`<filterAttr> eq "<id>"`) and
 * projected to the asserted subset. Connection: the `url` (Service Provider base, up
 * to and including the version segment, e.g. `https://host/scim/v2`) is suite data;
 * only the credential is a secret — EITHER a bearer token (env var named by
 * `tokenEnv`) OR HTTP Basic (`username` + the env var named by `passwordEnv`).
 */
export interface ScimSystemConfig {
  /** Service Provider base URL incl. the version segment, e.g. https://host/scim/v2. No credential in it. */
  url: string;
  /** Bearer-token auth: env var name holding the token. Use this XOR Basic (`username`+`passwordEnv`). */
  tokenEnv?: string;
  /** HTTP Basic auth: the user name (not secret) and the env var holding its password. */
  username?: string;
  passwordEnv?: string;
  /** Resource endpoint to query (default `Users`). */
  resourceType?: string;
  /** SCIM attribute the account `identifier` filters on (default `userName`). */
  filterAttr?: string;
  /**
   * Attribute PATHS to project when asserting (the allowlist, like db `columns`).
   * A path navigates the SCIM resource by slash (`name/givenName`, `active`); the
   * output key IS the path, so the expected stays flat and stable. A path resolving
   * to a multi-valued array of primitives is sorted (order-independent). Omit to
   * assert the whole resource minus volatile fields (id/meta/schemas).
   */
  attributes?: string[];
  /** Attribute paths whose volatile value is masked to a stable token (assert presence). Case-sensitive. */
  mask?: string[];
  /** Cross-system consistency: assert a SCIM attribute path equals a transform of a midPoint focus property (like ldap/db). */
  consistentWith?: Record<string, ConsistencyRule>;
}

/**
 * CONNECTOR-MEDIATED resource object: a midPoint resource the harness reads and
 * drives THROUGH midPoint's connector (REST → model → connector), so a target that
 * idweave has no native client for — any system midPoint connects to, including a
 * proprietary connector — can still be asserted and ARRANGEd (set/clear/create/delete).
 * The oracle is mediated by midPoint (weaker than a direct reader), so this is the
 * GENERIC fallback for the long tail; standardized protocols keep their direct
 * readers (csv/ldap/db/scim) for the independent oracle.
 *
 * The object is identified at the CONNECTOR level by its native `objectClass`; midPoint
 * `kind`/`intent`/`tag` are refined-schema REFINEMENTS used only to disambiguate (two
 * intents on one objectClass, or a 4.4+ multiaccount `tag`). An object is addressed by
 * a focus `owner` (an account via its linkRef) or by `identifier` (a standalone object —
 * a group/role/unlinked account — found by a shadow search). It is driven through the
 * suite's midPoint; when several midPoints are declared, `midpoint:` names the owning
 * instance (its `version` selects the connector-script dialect).
 */
export interface ResourceSystemConfig {
  /** midPoint resource NAME (resolved to its OID), or give the OID directly via `oid`. */
  name?: string;
  /** midPoint resource OID (alternative to `name`). */
  oid?: string;
  /** Native object class — the connector-level discriminator (e.g. `ri:inetOrgPerson`, `ri:groupOfNames`). */
  objectClass: string;
  /**
   * Attributes to PROJECT when asserting (the allowlist, like LDAP `attributes`). The
   * shadow's `attributes` are matched by local name (namespace-insensitive). Omit to
   * capture all non-operational attributes (a denylist strips operational/metadata).
   */
  attributes?: string[];
  /** Attribute names whose volatile value is masked to a stable token (assert presence). */
  mask?: string[];
  /** Shadow attribute matched when addressing by `identifier` (default `name`, the secondary identifier). */
  identifierAttr?: string;
  /** Refined-schema refinement (optional): account | entitlement | generic. */
  kind?: "account" | "entitlement" | "generic";
  /** Refined-schema intent (optional) — disambiguates two object types sharing one objectClass. */
  intent?: string;
  /** Multiaccount discriminator (optional; midPoint 4.4+). */
  tag?: string;
  /**
   * Named midPoint instance (a suite.systems key) the resource is driven THROUGH —
   * its `version` selects the connector-script dialect. Omit when the suite has a
   * single midPoint (that one is used); REQUIRED when several are declared, so a
   * resource never silently routes through the wrong instance.
   */
  midpoint?: string;
}

/**
 * A system of the deployment under test. Either an EXTERNAL system the harness
 * reads/writes — a CSV file or an LDAP/AD directory (source and/or target) — or an
 * ASSERT-ONLY external target read over its own API — a SQL database (`db`), a SCIM
 * Service Provider (`scim`), or a Keycloak realm (`keycloak`, which is also a restore
 * participant) — or a CONNECTOR-MEDIATED midPoint resource (`resource`, read/driven via
 * midPoint's own connector) — or a restore-only INSTANCE: a midPoint (`midpoint`). The
 * protocol is the discriminating KEY (`csv` xor `ldap` xor `db` xor `scim` xor `resource`
 * xor `midpoint` xor `keycloak`), so TS narrows on `"ldap" in system`. For external
 * systems the ROLE (source vs target) is decided by how a scenario uses it. Each system
 * is registered once.
 */
export type SystemSpec =
  | { csv: CsvSystemConfig; ldap?: undefined; db?: undefined; scim?: undefined; resource?: undefined; midpoint?: undefined; keycloak?: undefined }
  | { ldap: LdapSystemConfig; csv?: undefined; db?: undefined; scim?: undefined; resource?: undefined; midpoint?: undefined; keycloak?: undefined }
  | { db: DbSystemConfig; csv?: undefined; ldap?: undefined; scim?: undefined; resource?: undefined; midpoint?: undefined; keycloak?: undefined }
  | { scim: ScimSystemConfig; csv?: undefined; ldap?: undefined; db?: undefined; resource?: undefined; midpoint?: undefined; keycloak?: undefined }
  | { resource: ResourceSystemConfig; csv?: undefined; ldap?: undefined; db?: undefined; scim?: undefined; midpoint?: undefined; keycloak?: undefined }
  | { midpoint: MidpointSystemConfig; csv?: undefined; ldap?: undefined; db?: undefined; scim?: undefined; resource?: undefined; keycloak?: undefined }
  | { keycloak: KeycloakSystemConfig; csv?: undefined; ldap?: undefined; db?: undefined; scim?: undefined; resource?: undefined; midpoint?: undefined };

/**
 * How a `trigger` step's recon/import binds to a registered task: either a bare
 * OID string, or an OID plus per-task knobs. `timeoutMs` overrides the general
 * POLL_TIMEOUT_MS for THIS task's completion wait — the slow/cold-recon headroom
 * (CLAUDE.md) belongs with the task it describes, not as one global env knob that
 * would also make a genuinely-stuck quick assertion hang for minutes.
 */
export type TriggerBinding = string | { task: string; timeoutMs?: number };

/** Registered midPoint tasks the `trigger` step runs for a system (midPoint-specific). */
export interface TriggerTasks {
  /** Reconciliation task: an OID, or `{ task, timeoutMs }`. */
  recon?: TriggerBinding;
  /** Import task: an OID, or `{ task, timeoutMs }`. */
  import?: TriggerBinding;
}

/** The task OID a trigger binding points at (normalizes the string / object forms). */
export function triggerOid(binding: TriggerBinding | undefined): string | undefined {
  if (!binding) return undefined;
  return typeof binding === "string" ? binding : binding.task;
}

/**
 * Whole-env snapshot-restore topology for the fast "near-non-stop" reset (any backend):
 * instead of stopping every service and resetting every volume, STOP only the
 * data-owning service(s) (the repository postgres) and PAUSE the rest — so the heavy
 * app (midPoint) is frozen, never rebooted, and recovers via its DB connection pool
 * when the reset postgres restarts (seconds, not the minutes a full app reboot costs).
 * Skipping the reboot is backend-independent; only the volume reset differs (btrfs =
 * instant subvolume swap; tar = untar that one volume).
 *
 * SAFETY: near-non-stop is only valid while the paused app is the SAME JVM run that
 * the baseline was captured under — midPoint mints a RANDOM `internalNodeIdentifier`
 * per boot (NodeRegistrar) and shuts its Quartz scheduler down if the repo's id no
 * longer matches its in-memory one (split-brain guard). So the snapshot CLI stamps the
 * paused containers' `StartedAt` at build time and, if any has restarted since,
 * AUTOMATICALLY falls back to a full stop/reset/start. Declarative because the
 * topology (which service owns the data) is a stable property of THIS deployment;
 * env (`SNAPSHOT_RESTORE_STOP` / `SNAPSHOT_RESTORE_ROLLBACK`) overrides it, and the snapshot CLI
 * runs standalone (no suite) from env alone — absent both, it resets everything.
 */
export interface SnapshotSpec {
  restore?: {
    /** Compose service(s) to fully STOP around the reset (the rest are paused, not restarted). */
    stop?: string[];
    /** Compose volume KEY(s) to reset — btrfs subvolume swap / tar untar (defaults to the `stop` names). */
    rollback?: string[];
  };
}

/**
 * CROSS-CUTTING GUI settings for the deployment under test. The page-object
 * version/overrides/auth are PER driven system (`systems.*.midpoint`), so this
 * holds only what spans systems: named logins and per-principal passwords. Present
 * only for suites whose scenarios drive the GUI.
 */
export interface GuiSpec {
  /**
   * NAMED logins, for a suite that drives MORE than one login target — e.g. a
   * midPoint instance's dashboard and a Keycloak system's Account / Admin consoles.
   * Each entry is one `(system, target route)`; a `login-ui` step picks one by name
   * with `to:`. The `system`'s kind/`auth` implies the provider + page objects;
   * `target` is the authenticated route navigated to in order to trigger login
   * (default `/self/dashboard`). Omit `logins` to use the suite-default target.
   */
  logins?: Record<string, GuiLoginSpec>;
  /**
   * Per-principal GUI login passwords, when test users don't share one. Only the
   * env-var NAME is suite data (the secret stays in env, like `bind.passwordEnv`);
   * a login not listed here falls back to the shared `GUI_PASSWORD`. Lets one suite
   * drive the GUI as users with DIFFERENT passwords (e.g. an admin vs an end user,
   * to assert their differing menus).
   */
  principals?: Record<string, { passwordEnv: string }>;
}

/** One named login target: which system to log into, and the route that triggers it. */
export interface GuiLoginSpec {
  /**
   * The system this login targets — its kind/`auth` implies the provider and page
   * objects (a `midpoint` instance → its version's native form or SSO per its
   * `auth`; a `keycloak` system → that Keycloak's own console login). Omit for the
   * sole/default driveable system. "midPoint via SSO" is the midpoint system's
   * `auth: {type: keycloak}`; "Keycloak's own console" is `system: <keycloak system>`.
   */
  system?: string;
  /** Authenticated route to reach to trigger login (absolute or joined to the GUI base; default `/self/dashboard`). */
  target?: string;
}

/** Resolve a `login-ui` step's `to:` to its declared named login, or throw a clear error. */
export function resolveLogin(suite: Suite, name: string): GuiLoginSpec {
  const logins = suite.gui?.logins;
  const spec = logins?.[name];
  if (!spec) {
    const known = Object.keys(logins ?? {}).join(", ") || "none";
    throw new Error(`login-ui "to: ${name}" is not declared in suite gui.logins (known: ${known}).`);
  }
  return spec;
}

export interface Suite {
  /** External systems keyed by the logical name scenarios reference. */
  systems: Record<string, SystemSpec>;
  /**
   * midPoint registered tasks the `trigger` step runs, keyed by system name.
   * Kept separate from `systems` because these are midPoint-specific, not the
   * external system's own configuration.
   */
  triggers?: Record<string, TriggerTasks>;
  /**
   * GLOBAL registered midPoint tasks the `run-task` step runs, keyed by a logical
   * name a scenario references. Unlike `triggers` (per-system source recon/import),
   * these are deployment-wide operational/scanner tasks — validity scan, trigger
   * scan, cleanup — not tied to one external system. Each value is a task OID.
   */
  tasks?: Record<string, string>;
  /**
   * System a mutate/trigger step uses when it omits `system:` and there is more
   * than one. With a single system it is unnecessary (that one is the default).
   */
  defaultSystem?: string;
  /** GUI page-object selection — required only when scenarios drive the GUI. */
  gui?: GuiSpec;
  /**
   * Whole-env snapshot-restore topology for the fast near-non-stop reset (stop the data
   * service, pause the rest). Optional; env vars override it and the snapshot CLI works
   * without it (see {@link SnapshotSpec}).
   */
  snapshot?: SnapshotSpec;
  /**
   * Project-declared verify normalization for THIS deployment's data. `mask` lists
   * `a/b/c` paths into a focus projection whose value is volatile per run (e.g. a
   * focus extension property carrying a run-minted id) and is
   * replaced with a stable token so the expected pins presence, not value.
   */
  normalize?: { mask?: string[] };
}

const DEFAULT_SUITE_FILE = "suite.yaml";

/** Load and schema-validate the suite manifest at `<scenariosDir>/suite.yaml`. */
/**
 * Substitute `${VAR}` / `${VAR:-default}` with env values in the raw suite text
 * (before YAML parse). Lets one suite.yaml serve several environments — e.g. a
 * consolidated example sets the midPoint major via `version: "${MP_VERSION}"`.
 * An unset var with no default becomes empty (schema validation then catches it).
 */
function interpolateEnv(text: string): string {
  return text.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_m, name, def) => process.env[name] ?? def ?? "");
}

export async function loadSuite(scenariosDir: string, fileName = DEFAULT_SUITE_FILE): Promise<Suite> {
  const path = resolve(process.cwd(), join(scenariosDir, fileName));
  const parsed = parseYaml(interpolateEnv(await readFile(path, "utf-8")));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(suiteSchema);
  if (!validate(parsed)) {
    const errors = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "/"} ${e.message}`)
      .join("\n");
    throw new Error(`Suite manifest ${path} failed schema validation:\n${errors}`);
  }
  return parsed as unknown as Suite;
}

function resolveKey<T>(map: Record<string, T>, key: string | undefined, what: string): string {
  const keys = Object.keys(map);
  // A single entry may be referenced without naming it.
  const k = key ?? (keys.length === 1 ? keys[0] : undefined);
  if (!k || !map[k]) {
    throw new Error(`Unknown ${what} "${key ?? "(default)"}" in suite (have: ${keys.join(", ") || "none"})`);
  }
  return k;
}

/**
 * Resolve a logical system reference to its name + spec. When a step omits the
 * reference, falls back to `defaultSystem`, else the only system if there is one.
 */
export function suiteSystem(suite: Suite, key?: string): { name: string; system: SystemSpec } {
  const name = resolveKey(suite.systems, key ?? suite.defaultSystem, "system");
  return { name, system: suite.systems[name]! };
}

/** The protocol KIND of a system (the discriminating key of the SystemSpec union). */
export function systemKind(system: SystemSpec): SystemKind {
  if (system.csv) return "csv";
  if (system.ldap) return "ldap";
  if (system.db) return "db";
  if (system.scim) return "scim";
  if (system.resource) return "resource";
  if (system.midpoint) return "midpoint";
  if (system.keycloak) return "keycloak";
  throw new Error("systemKind: system has no recognized protocol key");
}

/** The attribute/column that identifies an account in a system (csv idColumn / ldap rdnAttr / db `:id` / scim filterAttr / keycloak username). */
export function systemIdAttr(system: SystemSpec): string {
  if (system.ldap) return system.ldap.rdnAttr;
  if (system.db) return "id"; // the query's :id bind parameter
  if (system.csv) return system.csv.idColumn;
  if (system.scim) return system.scim.filterAttr ?? "userName";
  if (system.resource) return system.resource.identifierAttr ?? "name";
  if (system.keycloak) return "username";
  throw new Error("systemIdAttr: not an external (csv/ldap/db/scim/resource/keycloak) system");
}

/**
 * Resolve a Keycloak system's admin connection from the env vars its config NAMES
 * (the same shape as `IdpAdminConfig`). Used by BOTH the restore participant
 * (cache-clear) and the assert target (read a realm user). Strict: a named var that
 * is unset throws (hitting the wrong realm/instance must not happen silently).
 */
export function keycloakAdminConnection(k: KeycloakSystemConfig): IdpAdminConfig {
  const req = (name: string): string => {
    const v = process.env[name];
    if (v === undefined || v === "") throw new Error(`env var ${name} is not set`);
    return v;
  };
  return {
    url: req(k.urlEnv).replace(/\/$/, ""),
    realm: req(k.realmEnv),
    clientId: req(k.clientIdEnv),
    ...(k.secretEnv ? { secret: req(k.secretEnv) } : {}),
    ...(k.usernameEnv ? { username: req(k.usernameEnv) } : {}),
    ...(k.passwordEnv ? { password: req(k.passwordEnv) } : {}),
    ...(k.authRealmEnv ? { authRealm: req(k.authRealmEnv) } : {}),
  };
}

/**
 * External read/write or assert target systems (csv/ldap/db/scim), excluding the
 * restore-participant instances (midpoint/keycloak) AND the connector-mediated `resource`
 * target. A `resource` read goes through midPoint's connector with NO shadow/side effect,
 * and a `resource` create/delete is resettable through the connector — so a `resource`
 * does NOT force a suite non-self-contained (it is not washed like a csv/ldap source).
 * A keycloak target is read-only and reset by snapshot-restore, so it also stays out (handled
 * by restore.ts as a participant).
 */
export function externalSystems(suite: Suite): Array<[string, SystemSpec]> {
  return Object.entries(suite.systems).filter(([, s]) => s.csv || s.ldap || s.db || s.scim);
}

/** midPoint instances declared as systems — the restore participants (cache-clear). */
export function midpointSystems(suite: Suite): Array<{ name: string; cfg: MidpointSystemConfig }> {
  return Object.entries(suite.systems)
    .filter((e): e is [string, SystemSpec & { midpoint: MidpointSystemConfig }] => !!e[1].midpoint)
    .map(([name, s]) => ({ name, cfg: s.midpoint }));
}

/**
 * The single midPoint instance the GUI drives by default — its `version` selects
 * the page-object module. Resolves to the SOLE midpoint system (the common case);
 * `undefined` when there is none (a non-midPoint GUI suite, e.g. Keycloak-only) or
 * when several are declared (the driving step must then name one with `system:`).
 * Replaces the old top-level `gui.version`.
 */
export function primaryMidpointSystem(suite: Suite): MidpointSystemConfig | undefined {
  const mids = midpointSystems(suite);
  return mids.length === 1 ? mids[0]!.cfg : undefined;
}

/**
 * Resolve a midPoint instance's connection (base URL + admin credential) from the
 * env vars its system config NAMES. With a `fallback` (the env-default
 * `cfg.midpoint`), an unset var uses the fallback value — so a single-instance
 * suite still runs off the conventional `MIDPOINT_*` defaults; without one (a
 * restore participant, where hitting the WRONG instance must not happen silently)
 * an unset var throws.
 */
export function midpointConnection(m: MidpointSystemConfig, fallback?: MidpointConfig): MidpointConfig {
  const get = (name: string, fb?: string): string => {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
    if (fb !== undefined) return fb;
    throw new Error(`env var ${name} is not set`);
  };
  return {
    baseUrl: get(m.baseUrlEnv, fallback?.baseUrl),
    user: get(m.usernameEnv, fallback?.user),
    password: get(m.passwordEnv, fallback?.password),
  };
}

/** A GUI-driveable system resolved for a step: its name, kind, and (for midPoint) its config. */
export type DrivenGuiSystem =
  | { name: string; kind: "midpoint"; midpoint: MidpointSystemConfig }
  | { name: string; kind: "keycloak" };

/**
 * Resolve which system the GUI drives. By `key` (a step's `system:` / a named
 * login's `system:`) → that system, which must be GUI-driveable (midpoint or
 * keycloak). Without a key → the sole midPoint instance (midPoint journeys are the
 * default), else the sole driveable system (a Keycloak-only suite); ambiguous when
 * several driveable systems exist and none is named.
 */
export function drivenGuiSystem(suite: Suite, key?: string): DrivenGuiSystem {
  if (key) {
    const s = suite.systems[key];
    if (s?.midpoint) return { name: key, kind: "midpoint", midpoint: s.midpoint };
    if (s?.keycloak) return { name: key, kind: "keycloak" };
    const driveable = Object.entries(suite.systems)
      .filter(([, v]) => v.midpoint || v.keycloak)
      .map(([n]) => n);
    throw new Error(`system "${key}" is not a GUI-driveable (midpoint/keycloak) system (have: ${driveable.join(", ") || "none"})`);
  }
  const mids = midpointSystems(suite);
  if (mids.length === 1) return { name: mids[0]!.name, kind: "midpoint", midpoint: mids[0]!.cfg };
  const driveable = Object.entries(suite.systems).filter(([, v]) => v.midpoint || v.keycloak);
  if (driveable.length === 1) {
    const [name, s] = driveable[0]!;
    return s.midpoint ? { name, kind: "midpoint", midpoint: s.midpoint } : { name, kind: "keycloak" };
  }
  throw new Error(
    `ambiguous GUI target — name the system the GUI drives with \`system:\` (driveable: ${driveable.map(([n]) => n).join(", ") || "none"})`,
  );
}

/**
 * The GUI login password for a principal. If the suite names a per-principal env
 * var (`gui.principals[login].passwordEnv`), read THAT secret from the env;
 * otherwise fall back to the shared `GUI_PASSWORD` (`fallback`). Mirrors the
 * LDAP `bind.passwordEnv` convention — only the secret is in env.
 */
export function guiPassword(suite: Suite, login: string, fallback: string): string {
  const envName = suite.gui?.principals?.[login]?.passwordEnv;
  if (!envName) return fallback;
  const pw = process.env[envName];
  if (pw === undefined || pw === "") {
    throw new Error(`GUI password env "${envName}" for principal "${login}" is not set`);
  }
  return pw;
}

/** The registered task a `trigger: <kind>` step runs for a system (errors if unbound). */
export function systemTriggerTask(
  suite: Suite,
  systemName: string,
  kind: "recon" | "import",
): { oid: string; timeoutMs?: number } {
  const binding = suite.triggers?.[systemName]?.[kind];
  const oid = triggerOid(binding);
  if (!oid) {
    throw new Error(
      `trigger ${kind} on "${systemName}" needs a registered ${kind} task OID at triggers.${systemName}.${kind} in the suite`,
    );
  }
  return typeof binding === "string" ? { oid } : { oid, timeoutMs: binding!.timeoutMs };
}

/** The global registered task OID a `run-task: <key>` step runs (errors if unbound). */
export function registeredTask(suite: Suite, key: string): string {
  const oid = suite.tasks?.[key];
  if (!oid) {
    const have = Object.keys(suite.tasks ?? {}).join(", ") || "none";
    throw new Error(`run-task "${key}" needs a registered task OID at tasks.${key} in the suite (have: ${have})`);
  }
  return oid;
}
