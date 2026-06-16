/**
 * Environment configuration. Endpoints and credentials are received from the
 * environment so that switching between local and CI is only a matter of
 * pointing elsewhere — never a code change (by design: no hardcoding).
 *
 * Defaults target the local docker-compose dev stack and may be overridden by
 * exporting the corresponding env vars (see .env.example).
 */

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got: ${v}`);
  return n;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export interface MidpointConfig {
  /** Base URL up to and including `/midpoint` (REST lives under `/ws/rest`). */
  baseUrl: string;
  user: string;
  password: string;
}

export interface CsvConfig {
  /**
   * Host-side directory bind-mounted into the midPoint container at the path
   * the CSV connector reads from. Source/target file NAMES are suite data
   * (see Suite), not engine config — only the host location lives here.
   */
  hostDir: string;
}

export interface PollConfig {
  /** Overall budget for a single await (ms). No sleeps — bounded polling. */
  timeoutMs: number;
  /** Delay between polls (ms). */
  intervalMs: number;
}

export interface GuiConfig {
  /** Base URL of the midPoint web UI (same origin as REST, up to `/midpoint`). */
  baseUrl: string;
  /**
   * Password shared by GUI test users (set via the HR `password` column). UI
   * steps log in as a principal with this password — kept out of YAML.
   */
  password: string;
  /** Run the browser headless (default true; GUI_HEADLESS=false to watch). */
  headless: boolean;
  /**
   * Accept self-signed / untrusted TLS for the GUI (default false). Needed when
   * the GUI is behind an SSO front-end on a dev FQDN with a self-signed cert
   * (GUI_IGNORE_HTTPS_ERRORS=true).
   */
  ignoreHttpsErrors: boolean;
  /**
   * Timeout (ms) for the login's FIRST contact with the IdP — the initial
   * navigation + wait for the login form. Deliberately generous (default 90s):
   * the first GUI hit right after a `snapshot-restore` reboot waits on a cold
   * midPoint + Keycloak + OIDC-proxy boot chain that easily exceeds the 30s
   * per-action default. Only this cold-start gate is widened; every other UI
   * wait keeps the 30s default so a genuine failure still fails fast.
   */
  loginTimeoutMs: number;
}

export interface MailConfig {
  /** Base URL of the Mailpit instance whose REST API holds the captured mail. */
  url: string;
  /**
   * Max ms to wait for an expected notification mail to ARRIVE before failing.
   * A notification is sent within seconds of its trigger, so this is intentionally
   * MUCH shorter than the general `poll.timeoutMs` (which covers minutes-long recon):
   * a mail that hasn't landed in this window is not coming, so we fail fast instead
   * of burning the whole poll budget on every mail that never arrives.
   */
  timeoutMs: number;
}

/**
 * Optional Keycloak admin connection, enabling the `search-federated-user` precondition
 * to force the IdP to drop a stale LDAP-federated user (Keycloak caches federated
 * users; deleting the directory entry alone leaves a stale Keycloak account that
 * breaks a re-registration). Endpoint + creds, so it lives in env (by design). Set
 * all four to enable; otherwise `search-federated-user` errors with a clear message.
 */
export interface IdpAdminConfig {
  /** Keycloak base URL including any servlet path, e.g. http://host:8080/auth. */
  url: string;
  /** Realm the admin operations TARGET (users looked up / caches cleared). */
  realm: string;
  /** Admin client id — a confidential service-account client, or `admin-cli` for a password grant. */
  clientId: string;
  /** Service-account client secret (client_credentials grant). Omit when using a password grant. */
  secret?: string;
  /**
   * Password grant (admin-cli + a master-realm admin user): set username+password
   * INSTEAD of `secret`. Use when the realm service account lacks a needed role —
   * e.g. clear-*-cache requires `manage-realm`, which a master admin has on every realm.
   */
  username?: string;
  password?: string;
  /** Realm to AUTHENTICATE against (default: `realm`). Set `master` for an admin-cli master admin. */
  authRealm?: string;
}

/** Host dir the file-IO steps (write-file/expect-file) resolve relative paths against. */
export interface FilesConfig {
  /** Base dir for a deployment's host-mounted task IO files (input/output dirs live under it). */
  hostDir: string;
}

export interface Config {
  midpoint: MidpointConfig;
  csv: CsvConfig;
  /** Host dir for task IO files a deployment writes/reads (write-file/expect-file). */
  files: FilesConfig;
  poll: PollConfig;
  gui: GuiConfig;
  /** Mailpit endpoint the expect-mail step reads received notifications from. */
  mail: MailConfig;
  /** Keycloak admin connection for `search-federated-user` (undefined unless configured). */
  idpAdmin?: IdpAdminConfig;
  /** Dir holding midPoint config objects to import (resource/role XML). */
  configDir: string;
  /** Dir holding scenario suites (each subdir = one scenario). */
  scenariosDir: string;
  /**
   * When set (e.g. "4.8"), `expected:` files resolve/capture under
   * `expected/<expectedVersion>/` instead of flat — so ONE scenario tree can serve
   * several midPoint majors whose normalized end-state differs. Empty = flat (default).
   */
  expectedVersion: string;
  /** Base dir for run output (junit/ctrf live here; see also dumpDir). */
  reportsDir: string;
  /** Dir for cross-system failure dumps (defaults under reportsDir). */
  dumpDir: string;
  /**
   * Capture a cross-system state dump on assertion failure. Off by default to
   * keep failure output clean; enable for debugging (DUMP_ON_FAILURE=1) to get
   * the dump dir + its path printed with the failure.
   */
  dumpOnFailure: boolean;
}

/**
 * Keycloak admin config from env, or undefined unless enabled. Needs url + realm +
 * clientId, plus EITHER a `client_credentials` secret OR a `password`-grant
 * username/password (admin-cli + a master admin); `KEYCLOAK_ADMIN_AUTH_REALM`
 * (default the target realm) names the realm to authenticate against (e.g. `master`).
 */
function idpAdminFromEnv(): IdpAdminConfig | undefined {
  const url = process.env["KEYCLOAK_ADMIN_URL"];
  const realm = process.env["KEYCLOAK_ADMIN_REALM"];
  const clientId = process.env["KEYCLOAK_ADMIN_CLIENT_ID"];
  const secret = process.env["KEYCLOAK_ADMIN_SECRET"];
  const username = process.env["KEYCLOAK_ADMIN_USERNAME"];
  const password = process.env["KEYCLOAK_ADMIN_PASSWORD"];
  const authRealm = process.env["KEYCLOAK_ADMIN_AUTH_REALM"];
  if (!url || !realm || !clientId || !(secret || (username && password))) return undefined;
  return {
    url: url.replace(/\/$/, ""),
    realm,
    clientId,
    ...(secret ? { secret } : {}),
    ...(username && password ? { username, password } : {}),
    ...(authRealm ? { authRealm } : {}),
  };
}

export function loadConfig(): Config {
  // Demo defaults point at the in-repo example suite for midPoint 4.10
  // (examples/<ver>/ holds a self-contained per-version suite; the Makefile's
  // VER param overrides these dirs). Real consumers set their own env.
  const reportsDir = env("REPORTS_DIR", "examples/midpoint-basic/reports");
  const midpointBaseUrl = env("MIDPOINT_BASE_URL", "http://localhost:8080/midpoint");
  return {
    midpoint: {
      baseUrl: midpointBaseUrl,
      user: env("MIDPOINT_USER", "administrator"),
      password: env("MIDPOINT_PASSWORD", "Test5ecr3t"),
    },
    gui: {
      baseUrl: env("GUI_BASE_URL", midpointBaseUrl),
      password: env("GUI_PASSWORD", "Test1234!"),
      headless: env("GUI_HEADLESS", "true") !== "false",
      ignoreHttpsErrors: boolEnv("GUI_IGNORE_HTTPS_ERRORS", false),
      loginTimeoutMs: intEnv("GUI_LOGIN_TIMEOUT_MS", 90_000),
    },
    mail: {
      url: env("MAILPIT_URL", "http://localhost:8025"),
      timeoutMs: intEnv("MAIL_TIMEOUT_MS", 60_000),
    },
    idpAdmin: idpAdminFromEnv(),
    csv: {
      hostDir: env("CSV_HOST_DIR", "examples/midpoint-basic/infra/data/csv"),
    },
    files: {
      hostDir: env("FILES_HOST_DIR", env("CSV_HOST_DIR", ".")),
    },
    poll: {
      timeoutMs: intEnv("POLL_TIMEOUT_MS", 90_000),
      intervalMs: intEnv("POLL_INTERVAL_MS", 1_000),
    },
    configDir: env("CONFIG_DIR", "examples/midpoint-basic/midpoint-config/4.10"),
    scenariosDir: env("SCENARIOS_DIR", "examples/midpoint-basic/scenarios"),
    expectedVersion: env("EXPECTED_VERSION", ""),
    reportsDir,
    dumpDir: env("DUMP_DIR", `${reportsDir}/dumps`),
    dumpOnFailure: boolEnv("DUMP_ON_FAILURE", false),
  };
}
