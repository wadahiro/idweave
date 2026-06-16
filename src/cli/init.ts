/**
 * CLI command: scaffold a starter idweave project in the current directory (or
 * the given dir). Writes a commented suite.yaml, one example scenario, a .env,
 * and a .gitignore — enough to go from an empty repo to `idw run` after filling
 * in your midPoint endpoint and resource OIDs.
 *
 * Existing files are never overwritten (each is reported as created or skipped),
 * so re-running `idw init` is safe and only fills in what is missing.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import pc from "picocolors";

interface FileSpec {
  path: string;
  content: string;
}

function writeIfAbsent(spec: FileSpec): "created" | "skipped" {
  if (existsSync(spec.path)) return "skipped";
  mkdirSync(dirname(spec.path), { recursive: true });
  writeFileSync(spec.path, spec.content);
  return "created";
}

export async function init(dirArg?: string): Promise<void> {
  const root = resolve(dirArg ?? ".");
  const files: FileSpec[] = [
    { path: join(root, "package.json"), content: PACKAGE_JSON_TEMPLATE },
    { path: join(root, ".env"), content: ENV_TEMPLATE },
    { path: join(root, ".gitignore"), content: GITIGNORE_TEMPLATE },
    { path: join(root, "scenarios", "suite.yaml"), content: SUITE_TEMPLATE },
    { path: join(root, "scenarios", "example", "joiner", "scenario.yaml"), content: SCENARIO_TEMPLATE },
    { path: join(root, "midpoint-config", "README.md"), content: CONFIG_README },
  ];

  console.error(`Scaffolding an idweave project in ${pc.bold(root)}\n`);
  for (const spec of files) {
    const status = writeIfAbsent(spec);
    const rel = relative(root, spec.path) || spec.path;
    const tag = status === "created" ? pc.green("created") : pc.dim("skipped");
    console.error(`  ${tag}  ${rel}`);
  }

  console.error(
    [
      "",
      "Next steps:",
      `  1. Edit ${pc.bold(".env")} — point MIDPOINT_BASE_URL + credentials at your midPoint.`,
      `  2. Edit ${pc.bold("scenarios/suite.yaml")} — set your resource OIDs, file names, columns.`,
      `  3. Edit ${pc.bold("scenarios/example/joiner/scenario.yaml")} to match your data.`,
      `  4. ${pc.bold("idw capture-expected")} — record expected/ from the live end-state, then review it.`,
      `  5. ${pc.bold("idw run")} — run the suite (writes reports/junit.xml + ctrf.json).`,
      "",
      `UI-driven steps (request-ui/approve-ui) also need a browser: ${pc.bold("npx playwright install chromium")}.`,
      "",
    ].join("\n"),
  );
}

// `"type": "module"` is REQUIRED: a project GUI-override (gui.overrides) is a
// TypeScript ESM module, and Node 23+ defaults a `.ts` to CommonJS without this —
// which breaks loading its `export default` (a require(esm) cycle error). Written
// only if absent, so an existing package.json is never clobbered (add the field by
// hand there). `idw` is run via the installed bin; no scripts needed.
const PACKAGE_JSON_TEMPLATE = `{
  "name": "idweave-suite",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "dependencies": {}
}
`;

const ENV_TEMPLATE = `# idweave configuration — points the CLI at YOUR midPoint and YOUR suite.
# Read by 'idw run' (and the other commands). Real shell/CI env vars override
# anything set here, so this file is just convenient local defaults.

# --- Target midPoint (REST + GUI share the same origin, up to /midpoint) ---
MIDPOINT_BASE_URL=http://localhost:8080/midpoint
MIDPOINT_USER=administrator
MIDPOINT_PASSWORD=change-me

# Web UI base (defaults to MIDPOINT_BASE_URL) + the shared password your GUI
# test users log in with (used only by request-ui/approve-ui steps).
# GUI_BASE_URL=http://localhost:8080/midpoint
GUI_PASSWORD=change-me
# GUI_HEADLESS=false   # uncomment to watch the browser

# --- Your suite layout (relative to this project) ---
SCENARIOS_DIR=scenarios
CONFIG_DIR=midpoint-config
REPORTS_DIR=reports

# Host dir bind-mounted into the midPoint container where the CSV connector
# reads/writes (only relevant for CSV sources/targets).
CSV_HOST_DIR=./data/csv

# --- Bounded polling (no sleeps) ---
POLL_TIMEOUT_MS=90000
POLL_INTERVAL_MS=1000
`;

const GITIGNORE_TEMPLATE = `node_modules/
reports/
.env
`;

const SUITE_TEMPLATE = `# Suite manifest — the deployment-under-test your scenarios share. Binds the
# logical names scenarios reference to concrete external SYSTEMS (csv files,
# LDAP/AD directories) and the midPoint tasks that ingest them. Suite data, not
# engine config. Fill in the files/DNs/OIDs for YOUR deployment.

# System a mutate/trigger step uses when it omits 'system:' (with more than one).
defaultSystem: hr

# Systems of the deployment under test. A midpoint/keycloak entry is an INSTANCE
# (its version selects GUI page objects + cache-clear; connection via env-var
# NAMES); a csv/ldap entry is an external source/target. Each is exactly one kind.
systems:
  # The midPoint instance scenarios drive. Its 'version' selects the GUI
  # page-object module (4.0 / 4.4 / 4.8 / 4.10) for request-ui/approve-ui; add
  # 'overrides: ./<file>.ts' for a customised screen.
  idm:
    midpoint:
      baseUrlEnv: MIDPOINT_BASE_URL
      usernameEnv: MIDPOINT_USER
      passwordEnv: MIDPOINT_PASSWORD
      version: "4.10"

  # A CSV system feeding UserType via inbound mappings.
  hr:
    csv:
      fileName: hr-source.csv
      columns: [login, firstname, lastname, email, disabled]
      idColumn: login

  # An outbound CSV system midPoint provisions into (asserted via expect.accounts).
  app-target:
    csv:
      fileName: app-target.csv
      columns: [username, firstname, lastname, email, disabled]
      idColumn: username

  # An LDAP/AD system example (delete if unused). The bind password is read from
  # the env var named by passwordEnv (only the secret is in env).
  # ad:
  #   ldap:
  #     url: ldap://localhost:389        # ldaps:// for TLS
  #     bind: { dn: "Administrator@example", passwordEnv: IDW_LDAP_AD_PASSWORD }
  #     containerDn: ou=Users,dc=example,dc=com
  #     rdnAttr: cn
  #     objectClasses: [user]
  #     baseAttrs: { userAccountControl: "544" }
  #     password: { from: pw, to: unicodePwd }

# midPoint registered tasks the 'trigger' step runs, keyed by system name.
triggers:
  hr:
    recon: 00000000-0000-0000-0000-000000000000 # TODO: your recon task OID
    # import: 00000000-0000-0000-0000-000000000000  # TODO: a deployed import task
`;

const SCENARIO_TEMPLATE = `# Example scenario — EDIT to match your data, then 'idw capture-expected'.
# One behavior as ordered, declarative steps (no logic in YAML).
id: example-joiner
requirement: REQ-EXAMPLE-001
description: >
  A new HR row is imported and, being unmatched, creates a midPoint user via
  inbound mappings. Granting a role then provisions the outbound target account.

steps:
  # 1. Seed the source system (inline rows; or 'set: { file: rows.csv }').
  #    'system:' is a sibling of the op; omit it when there's a single system.
  - set:
      - login: jdoe
        firstname: John
        lastname: Doe
        email: jdoe@example.com
        disabled: ""
    system: hr
  # 2. Ingest it (runs triggers.hr.recon; use import for triggers.hr.import).
  - trigger: recon
    system: hr
  # 3. Grant a role (use a role name that exists in your midPoint).
  - assign:
      user: jdoe
      role: App Target Access # TODO: a real role name
  # 4. Assert the real end-state. 'idw capture-expected' records expected/*.json;
  #    review the captured files against intent before committing.
  - expect:
      objects:
        - type: user
          name: jdoe
          expected: expected/user.jdoe.json
      accounts:
        - system: app-target
          identifier: jdoe
          expected: expected/target.jdoe.json
`;

const CONFIG_README = `# midpoint-config/

Put the midPoint configuration objects your suite imports here (resource, role,
object-template, task XML). \`idw import-config\` loads them into the target
midPoint. Leave this empty if your midPoint is already configured out of band.
`;
