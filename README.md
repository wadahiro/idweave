# idweave

**idweave** (identity × weave; CLI `idw`) is a test harness for **end-to-end tests
that run against your real systems**. You write declarative YAML scenarios; `idw`
drives them through the **actual running systems** — source → midPoint → target,
the real self-service GUI included — and asserts the **real** end-state. idweave
never simulates a system's behaviour (a target may itself be a mock server you
deploy; idweave still asserts that server's real state).

It verifies a **midPoint** deployment's configuration — mappings, roles,
correlation, synchronization, policy — driving and asserting **CSV** and
**LDAP/AD** systems, driving **Keycloak** for SSO login, and asserting provisioned
state in **Keycloak** realms and **SCIM** service providers. It tests *your
deployment's config*, not midPoint core.

A scenario reads like the behavior it checks:

```yaml
id: joiner
requirement: REQ-JML-001
steps:
  - set: [{ login: jdoe, firstname: John, lastname: Doe, email: jdoe@example.com }]
    system: hr
  - trigger: recon              # run the deployed recon task for `hr`
    system: hr
  - assign: { user: jdoe, role: App Access }
  - expect:                     # assert the real user + the real provisioned account
      objects:  [{ type: user, name: jdoe, expected: expected/user.json }]
      accounts: [{ system: app-target, identifier: jdoe, expected: expected/account.json }]
```

`idw run` discovers every scenario, runs it, prints a colored expected/actual
diff on failure, writes JUnit + CTRF reports, and exits non-zero — so a CI job is
just `npx idw run`.

## Install

Your scenarios are declarative YAML; idweave itself runs as TypeScript via `tsx`
— no build step, no test-runner setup. Until it's published to npm, install it from
GitHub, pinned to a release tag (or a commit) for reproducibility:

```bash
mkdir my-iam-tests && cd my-iam-tests
npm init -y
npm install github:wadahiro/idweave#v0.1.0   # pin a tag; or file:../idweave for a local checkout
npx playwright install chromium              # only for GUI steps (request-ui / approve-ui / …)
```

Requirements: **Node ≥ 24**, and a reachable midPoint (for GUI steps, a browser
via the line above). The library API (`import { runSuite } from "idweave"`) and your
scenario files run under `tsx` — the `idw` CLI bundles it, so `npx idw` needs nothing extra.

## Quick start

```bash
npx idw init                        # scaffold .env + scenarios/suite.yaml + an example scenario
# 1. edit .env                          -> point MIDPOINT_BASE_URL + creds at your midPoint
# 2. edit scenarios/suite.yaml          -> your systems (files/DNs) + trigger task OIDs
# 3. edit scenarios/example/joiner/scenario.yaml -> your data and role names
npx idw capture-expected            # record expected/*.json from the live end-state — then REVIEW it
npx idw run                         # run the suite -> reports/{junit.xml,ctrf.json}
```

`idw init` is safe to re-run — it only fills in missing files, never overwrites.
A captured `expected/` file **must be reviewed against intent** (the requirement /
your config) before you trust it — never blindly pin current behavior.

The CLI auto-loads a local `.env`; real shell/CI env vars override it. Switching
from local to CI/STG is only a matter of pointing the env elsewhere — never a
code change.

## The three config layers

idweave keeps *how to reach the running system*, *what is under test*, and *one
behavior* separate, so the same scenario runs unchanged across environments.

### 1. env — `.env` (how to reach the running system)

Endpoints, credentials, directories, poll timeouts. No domain data. Varies
local ↔ CI.

```bash
MIDPOINT_BASE_URL=http://localhost:8080/midpoint
MIDPOINT_USER=administrator
MIDPOINT_PASSWORD=change-me

SCENARIOS_DIR=scenarios            # where your suite.yaml + scenarios live
CONFIG_DIR=midpoint-config         # optional: XML objects `idw import-config` loads
REPORTS_DIR=reports                # junit.xml + ctrf.json land here

POLL_TIMEOUT_MS=90000              # bounded polling — the only waiting primitive
POLL_INTERVAL_MS=1000
```

### 2. suite — `scenarios/suite.yaml` (what is under test)

The **systems** your scenarios drive, and the **triggers** (deployed midPoint
tasks) that ingest them. A system is registered **once**, keyed by its kind: a
`midpoint` / `keycloak` entry is a running **instance** you drive — its `version`
selects GUI page objects and cache-clear, connection via env-var names — while a
`csv` / `ldap` / `scim` entry is an **external source/target** whose role — source or
target — is decided by how a scenario uses it (a `db` entry is assert-only). A `keycloak` instance can also be
CRUD'd per-user as a source (`add` / `replace` / `remove`); a blanket `set` / `reset`
is refused — a realm is a shared namespace that also holds admin/service users.

```yaml
defaultSystem: hr                  # the external system a step uses when it omits `system:`

systems:
  idm:                             # the midPoint instance scenarios drive (REST + GUI)
    midpoint:
      baseUrlEnv: MIDPOINT_BASE_URL
      usernameEnv: MIDPOINT_USER
      passwordEnv: MIDPOINT_PASSWORD
      version: "4.10"              # selects the GUI page objects (4.0/4.4/4.8/4.10) + cache-clear
  hr:                              # a CSV source feeding UserType via inbound mappings
    csv:
      fileName: hr-source.csv
      columns: [login, firstname, lastname, email, disabled]
      idColumn: login
  app-target:                      # a CSV target midPoint provisions into
    csv:
      fileName: app-target.csv
      columns: [username, firstname, lastname, email, disabled]
      idColumn: username
  # ad:                            # an LDAP/AD system (the bind secret stays in env)
  #   ldap:
  #     url: ldap://localhost:389
  #     bind: { dn: "Administrator@example", passwordEnv: IDW_LDAP_AD_PASSWORD }
  #     containerDn: ou=Users,dc=example,dc=com
  #     rdnAttr: cn
  # sso:                           # a Keycloak instance — login-ui target + snapshot cache-clear participant
  #   keycloak:
  #     urlEnv: KEYCLOAK_URL
  #     realmEnv: KEYCLOAK_REALM
  #     clientIdEnv: KEYCLOAK_CLIENT_ID
  #     usernameEnv: KEYCLOAK_ADMIN          # or secretEnv: for a service-account client
  #     passwordEnv: KEYCLOAK_ADMIN_PASSWORD

triggers:                          # the DEPLOYED tasks `trigger:` runs, keyed by system
  hr:
    recon: 00000000-0000-0000-0000-000000000000   # your recon task OID
    # import: <oid>                                # or a deployed import task
```

`trigger:` always runs a task **you deployed** — idweave verifies your configured
tasks, never a generic one-shot import.

### 3. scenario — `scenarios/<category>/<name>/scenario.yaml` (one behavior)

One behavior as ordered, declarative steps (no logic in YAML). Steps are
orthogonal — each names the `system:` it acts on (omit when there's one) and falls
in a lifecycle phase: **arrange** a source → **act** on midPoint → **assert** the
end-state, with an optional `setup:` pre-clean (a **reset**). The joiner above is the
common path (`set` → `trigger` → `assign` → `expect`); for the full list — each step
with its phase, fields, and the systems it can name — run **`idw steps`** or expand
the reference below.

<!-- idw:steps:start -->
<details>
<summary><b>Full step reference</b> — every step kind, grouped by phase</summary>

**ARRANGE — seed the input & state**

| Step | Systems | Fields | What it does |
|------|---------|--------|--------------|
| `capture-account` ✦ | ldap | system*, identifier*, attr*, as* | Capture an LDAP account attribute's value(s) into a named slot, for a later expect-account-changed. |
| `capture-focus` | midpoint | type, name*, source*, as* | Capture a focus property's current value(s) into a named slot, for a later assert to reference. |
| `create-resource-object` ✦ | resource | system*, attributes* | Create a new object on the target through midPoint's connector (no shadow). |
| `db-mutate` ✦ | db | system*, identifier*, value* | Precondition: rewind an external db system's state via its suite `update` SQL (`:id` from linkFrom, `:value` supplied). |
| `derive-focus` | midpoint | type, name*, source*, target*, delimited*, time, raw | Precondition: derive a focus property from one of its own values (split-reformat + optional seeded date), raw-written. |
| `derive-shadow` | midpoint | owner*, resource*, source*, targets*, delimited*, time, raw | Precondition: derive a shadow's identifier/attribute from its own value (split-reformat + optional seeded date), raw-written to one or more paths. |
| `mutate` ✦ | csv · ldap · scim · keycloak | system, set, add, replace, remove | Mutate a source: exactly one of set/add/replace/remove. |
| `set-assignment` | midpoint | user*, role*, validFrom, validTo, raw | Precondition: seed an assignment's validity (validFrom/validTo), selected by user + role — for time-control tests. |
| `set-focus` | midpoint | type, name*, set*, clearPassword, raw | Precondition: revert a focus/shadow's properties (and optionally clear its password or seed a raw past date). |
| `set-lookup-row` | midpoint | table*, key*, value* | Precondition: set a LookupTable row (key → value), e.g. to queue a LookupTable-driven task. |
| `set-resource-object` ✦ | resource | system*, identifier*, set* | Set/replace attributes on a target object through midPoint's connector (no shadow). |
| `write-file` | — | path*, content, lines | Precondition: write a host file (task input) under the files host dir (or an absolute path). |

**ACT — drive the system under test**

| Step | Systems | Fields | What it does |
|------|---------|--------|--------------|
| `approve-ui` | midpoint | as*, request, requests, comment | Approve a pending request from the approver's GUI work-item inbox (one item, or many at once). |
| `assign` | midpoint | user*, role*, relation | Grant a role (or org with a relation) to a user. |
| `assign-ui` | midpoint | as*, user*, role, org, service | Operator assigns a role/org/service to a user via the edit-user GUI (Default relation). |
| `bulk-action` | midpoint | file, xml | Run a midPoint bulk-action (executeScript) — a deployed BulkAction XML file or an inline script. |
| `create-org` | midpoint | name*, subtype*, parent | Create a midPoint org (project-root/project) with a subtype, optionally under a parent org (by name). |
| `create-org-ui` | midpoint | as*, parent*, attributes* | Create an org (project-root/project) via the GUI, as an operator, under a parent tree node. |
| `forward-ui` | midpoint | as*, request*, to* | Forward a pending request to another user from the approver's GUI work-item inbox (as the approver). |
| `login-ui` | midpoint · keycloak | as*, password, to, expectFailure | Smoke: log in via the GUI as a principal and reach the dashboard (verifies auth wiring, incl. SSO). |
| `open-mail-link` | midpoint | to*, subject, link, as | Open the link in a received notification in the browser (email-driven journey). |
| `reject-ui` | midpoint | as*, request, requests, comment | Reject a pending request from the approver's GUI work-item inbox (one item, or many at once). |
| `request-ui` | midpoint | as*, for, comment, validFrom, validTo, items*, expectError | Submit a self-service access request via the GUI (as the requester). |
| `run-task` | midpoint | run-task* | Run a global registered midPoint task (suite.tasks) — e.g. a validity scan or cleanup — and await its fresh run. |
| `trigger` ✦ | csv · ldap · scim | trigger*, system, acceptUpTo | Run the system's registered import or reconciliation task (suite.triggers). |
| `ui-flow` | midpoint | name*, open, as, with | Drive a project custom flow (gui.overrides flows) over a deployment-specific page. |
| `unassign` | midpoint | user*, role*, ifAssigned | Revoke a role from a user (deletes the assignment; runs deprovisioning). |
| `unassign-ui` | midpoint | as*, user*, role, org, service | Operator removes a role/org/service assignment from a user via the edit-user GUI. |

**ASSERT — check the real end-state**

| Step | Systems | Fields | What it does |
|------|---------|--------|--------------|
| `expect` | midpoint · csv · ldap · scim · db · keycloak · resource | objects, accounts, projections | Assert repo objects and/or target accounts at this point in the flow. |
| `expect-account-changed` ✦ | ldap | system*, identifier*, attr*, from* | Assert (poll until) an LDAP account attribute differs from a value captured earlier by capture-account. |
| `expect-fields` | midpoint | as*, editable, expected | Assert which self-service profile fields a principal may edit in the GUI (read-only). |
| `expect-file` | — | path*, contains, absent | Assert a host file (e.g. a task output file) contains substrings, or is absent. Polls (eventual consistency). |
| `expect-mail` | — | to*, subject, expected, contains, matches, absent | Assert a notification midPoint sent (read from the Mailpit sink). |
| `expect-menu` | midpoint | as*, present, absent, exact, expected | Assert the left-nav menu shown to a principal in the GUI (read-only). |
| `expect-requestable` | midpoint | as*, for, view, catalog, present, absent | Assert which accesses ARE / ARE NOT requestable in the self-service request UI (read-only). |
| `expect-resource-object` ✦ | resource | system*, identifier, all, expected, absent | Assert a connector-mediated resource object, or all objects (read through midPoint's connector, no shadow). |

**RESET — setup pre-clean / teardown**

| Step | Systems | Fields | What it does |
|------|---------|--------|--------------|
| `clear-focus` ✦ | midpoint | type, name*, deprovision, midpoint | Precondition: clean up a focus and (by default) its provisioned external accounts (idempotent). |
| `clear-lookup-row` | midpoint | table*, key* | Precondition: delete a LookupTable row by key (reset a task's per-day progress checkpoint). |
| `clear-mail` | — | to | Precondition: clear captured Mailpit mail (by recipient, or all) so a later absent assertion is re-runnable. |
| `clear-resource-object` ✦ | resource | system*, identifier*, clear* | Clear attribute value(s) on a target object through midPoint's connector (no shadow). |
| `clear-shadow` ✦ | csv · ldap · scim · resource | system, identifier* | Precondition: raw-delete orphan/tombstone shadows for an identifier on a connector-backed system (csv/ldap/scim/resource) — idempotent recon reset. |
| `clear-system` | csv · ldap · scim | clear-system* | Empty a source system (csv rows / ldap entries under the container / scim resources), keeping the container. |
| `delete-object` ✦ | midpoint | type, name*, raw, midpoint | Precondition: delete a midPoint object (and its shadows) if it exists (idempotent). |
| `delete-org` | midpoint | name* | Delete an org and the subtree it spawned (descendant orgs + parented roles); no-op if absent. |
| `delete-resource-object` ✦ | resource | system*, identifier* | Delete an object from the target through midPoint's connector (no shadow). |
| `search-federated-user` | keycloak | login* | Precondition: search a federated user (the lookup makes Keycloak drop the stale copy once its LDAP entry is gone). |
| `unassign-matching` | midpoint | user*, rolePrefix* | Reset: revoke every direct role assignment whose role name starts with rolePrefix (re-runnable). |

✦ = accepts a `<system>/<kind>` prefix · * = required field
</details>
<!-- idw:steps:end -->



An `accounts` entry names one account by `identifier`, or asserts the **whole set**
of a system with `all: true` (order-independent — "exactly these accounts exist",
e.g. after a `clear-system` pre-clean); `all` is supported for `csv`/`ldap`/`scim`
targets. `expect` is just another step, so you can assert at any point in the flow. An
optional `setup:` section (same step kinds) runs before `steps:` for the
idempotent pre-clean — see "Writing re-runnable scenarios" below. Add a scenario by
creating a directory, writing `scenario.yaml`, running `idw capture-expected`,
reviewing the captured `expected/*.json` against intent, then `idw run`.

## CLI

Every command auto-loads `.env` and takes an optional path argument.

| Command | Purpose |
|---------|---------|
| `idw help` | The command index (also shown with no command). |
| `idw init [dir]` | Scaffold a starter project (`.env`, `suite.yaml`, an example scenario). Re-runnable. |
| `idw run [dir]` | **The main command.** Wait for readiness, run every scenario, write reports, exit non-zero on failure. |
| `idw capture-expected [dir]` | Record `expected/*.json` from the live end-state (then review). |
| `idw scenarios [dir]` | List the test cases (id / requirement / steps / asserts) — no running stack needed. |
| `idw steps` | List the step kinds a `scenario.yaml` may use, with each step's phase, fields, and systems. |
| `idw import-config [dir]` | Load `midpoint-config/*.xml` into midPoint via REST (no restart). |
| `idw wait-ready` | Poll until midPoint REST is up and the baseline exists. |
| `idw triage [dir]` | Offline failure triage from `reports/ctrf.json` (see below). |
| `idw snapshot-build [name]` | Snapshot the whole environment as a named baseline. |
| `idw snapshot-restore [name]` | Reset the whole environment to a baseline (idempotency). |
| `idw snapshot-list` | List baselines (name / created / size / volumes / binds). |

For control flow beyond declarative steps, import the engine as a library
(`import { runSuite, writeJUnit } from "idweave"`) and drive it from your own
runner — `idw run` is a thin wrapper over that API.

## Writing re-runnable scenarios

A scenario should leave the deployment as it found it, so the whole suite stays
idempotent **without any hidden reset**. That keeps state legible: when a test
fails, you reason about exactly the steps you wrote, not about what some reset
machinery did behind your back. Follow three rules:

- **Treat the baseline as read-only.** The deployment's configured state — config
  objects, seeded reference data, the group a role provisions — is a fixture.
  Assert it freely, but never delete or destructively modify it.
- **Each scenario owns the data it mutates.** Create the users/entries a scenario
  changes *inside* that scenario, under an identifier unique to it, and remove
  them within it. Scenarios then never collide, so none has to clean up after
  another (and asserting an object never implies the harness may delete it).
- **Put the idempotent pre-clean in a `setup:` block.** A run that fails midway can
  leave a leftover; a `clear-focus` / `clear-system` / `remove` (a no-op when
  absent) clears it so the next run starts clean. Declare it in the optional
  `setup:` section — it runs before `steps:`, uses the same step kinds, and keeps
  the reset visually apart from the behaviour under test (a failure there is a
  setup failure). The shape is **setup (pre-clean) → steps (arrange → act → expect)**:

  ```yaml
  setup:
    - clear-system: app-target                    # start the target empty (host-side)
    - clear-focus: { name: jdoe, deprovision: false }  # remove a leftover focus + its shadows
  steps:
    - set: [ { login: jdoe, ... } ]   # arrange this run's input
    - trigger: import                 # act
    - expect: { ... }                 # assert
  ```

To test a deletion — a leaver, a revoke, an out-of-band break — **create the
subject first, then delete it**; don't delete baseline data. Re-creating a deleted
directory entry gives it a fresh server-assigned id (LDAP `entryUUID`, SCIM `id`)
that no longer matches midPoint's shadow; owning only what you delete sidesteps
that desync entirely. The same reasoning is why you shouldn't lean on a blanket
reset to undo a real provisioning cascade (source → recon → focus → shadow →
downstream): unwinding it correctly is what the deployment's *own* config already
does, so re-running from a clean precondition is more honest — and more robust —
than reconstructing the end-state by hand.

Primitives for the pre-clean / teardown: `clear-focus` (the teardown of a focus +
its footprint — removes the focus, its shadows, AND, by default, its real provisioned
accounts; the external delete goes below midPoint's model layer, so it never triggers
an approval workflow (safe to run in a pre-clean), and protected source accounts are
skipped. Pass `deprovision: false` to drop only the focus + shadows and
leave the external systems untouched — e.g. for an all-CSV suite whose target file is
emptied host-side by `clear-system`), `clear-system` (empty a source/target of its
objects while keeping the container — csv rows / ldap entries under the container /
scim resources), `remove` (an external entry by id), `clear-shadow`, `search-federated-user`,
`clear-mail`, `set` (rewrites a CSV source whole). To drive midPoint's OWN delete
(e.g. observe a model-deprovision leaver), use `delete-object` (`raw: true` for a
repository-only delete).

## A shared baseline across scenarios — snapshot/restore

When a group of scenarios needs the same expensive starting state (many seeded
users, two tenants, approvers of every kind), snapshot it once and restore at the
**group boundary** rather than rebuilding it per scenario. Snapshot/restore is an
**optional add-on**, separate from authoring scenarios and limited to
**docker-compose** deployments.

A baseline here is a **coherent multi-system state** — midPoint's repo *and* every
source/target system *and* the host-side config, captured together. Restoring
midPoint alone is meaningless (its shadows would no longer match the external
accounts), which is exactly why this is a whole-environment operation:

```bash
idw snapshot-build                  # snapshot the clean, configured stack as "baseline"
# ... run scenarios, dirty the environment ...
idw snapshot-restore                # reset the WHOLE env back to "baseline"
idw snapshot-build after-load       # keep several named baselines and jump between them
idw snapshot-list
```

A restore captures and restores **all** backing stores together (every docker
volume + every host bind of the compose project, auto-discovered) so the snapshot
is consistent across systems. Two refinements keep it fast:

- **Fast restore (no full reboot)** skips midPoint's slow restart: it stops only the
  DB, pauses the rest, rolls back just the DB volume, and the app reconnects in ~1s
  (midPoint tasks are first stopped; afterward idweave refreshes its caches, synchronizes
  Quartz with the restored repository, and resumes the scheduler. Keycloak's caches are
  also refreshed.)
  Declare the topology in
  `suite.snapshot.restore: { stop: [...], rollback: [...] }`. Build the baseline right
  after a clean start and don't restart midPoint before restoring; if you do,
  idweave detects it and auto-falls-back to a full reboot.
- **`SNAPSHOT_BACKEND=btrfs`** makes the reset instant and size-independent (a
  copy-on-write subvolume swap instead of a tar). The default `tar` backend is
  portable to any Docker host; btrfs is worth it for large DBs.

Snapshot/restore is driven from outside your tests; your scenario code never touches
Docker.

## Failure output & reports

An expected/actual mismatch is reported three ways, all decoupled from the test
body:

- **Terminal** — the failing step (and, for an `expect`, the preceding step) with
  a source excerpt and a colored expected/actual diff — pointing at *your* scenario,
  not at harness internals. `DUMP_ON_FAILURE=1` additionally captures a cross-system
  dump (the focus user, its accounts/shadows, the task that ran, and the target file)
  under `reports/dumps/`.
- **`reports/junit.xml`** — portable XML for CI / ReportPortal.
- **`reports/ctrf.json`** — tool-agnostic [CTRF](https://ctrf.io/) JSON, the
  input for offline AI triage:

```bash
idw triage              # reads reports/ctrf.json
# Without ANTHROPIC_API_KEY: writes reports/triage-input.json (assembled context).
# With ANTHROPIC_API_KEY:    Claude summarizes likely root causes per failure.
```

AI runs only offline, on the report — never during a test run.

## Calling from a coding agent

idweave ships [skills](skills/) that teach a coding agent (Claude Code, Codex, …) to author
and run scenarios productively — the scenario model, the capture→review→run loop, and the
re-runnable discipline. Add them to your agent with the [`skills`](https://www.npmjs.com/package/skills)
CLI (it copies them from this repo into `.claude/skills/` / `.codex/skills/`):

```sh
npx skills add wadahiro/idweave
```

| Skill | Helps the agent |
|-------|-----------------|
| `writing-idweave-scenarios` | Author or edit a `scenario.yaml` — the model, step vocabulary, expect/assert, re-runnable discipline, GUI-vs-REST. |
| `running-idweave` | Drive the `idw` CLI — capture/review/run, scope to one scenario, snapshots/reset, reports, triage. |

The skills lean on idweave's self-describing CLI (`idw steps`, `idw help`, `idw scenarios`),
so they stay correct as idweave evolves. They are not part of the npm package — re-run
`npx skills add` to update.

## Developing idweave itself

Set up the toolchain once with `npm ci` (Node 24 — see `.nvmrc`; `npm ci` installs
exactly the locked versions). This repo ships self-contained example suites under
`examples/` that are *also* the engine's own end-to-end tests, each a copyable demo
of a real suite: **`midpoint-basic`** (one scenario tree run against any midPoint
major via `VER`), **`midpoint-advanced`** (midPoint fanning out to LDAP + SCIM), and a
standalone **`keycloak`** suite. A `Makefile` wraps the dev loop:

```bash
make up            # start an example midPoint stack (config baked in via post-init)
make all           # up -> wait-ready -> test
make run           # run scenarios via the CLI (`idw run`) against the example stack
make test          # run scenarios via vitest (engine self-test, 1 scenario = 1 test)
make unit          # core unit tests under src/ (registry/handlers/schema; no stack, fast)
make scenarios     # list the example test cases
```

Every `make` target takes two independent knobs — the canonical form spells both out:
**`EXAMPLE`** (default `midpoint-basic`; also `midpoint-advanced`, `keycloak`) picks the
suite, and **`VER`** (default `4.10`) is the midPoint major. Today only `midpoint-basic`
varies by `VER` — it runs across midPoint majors from ONE scenario tree, with `VER`
selecting that major's infra (`infra/<ver>/`), post-init config (`midpoint-config/<ver>/`)
and expected end-state (`expected/<ver>/`); `midpoint-advanced` pins midPoint 4.10 and
`keycloak` has no midPoint, so they ignore `VER` (a future midPoint example could honor it).

```bash
make all EXAMPLE=midpoint-basic VER=4.4    # midpoint-basic against midPoint 4.4
make all EXAMPLE=midpoint-advanced         # midPoint 4.10 fanning out to LDAP + SCIM
make all EXAMPLE=keycloak                  # the standalone Keycloak example
```

After any change to the engine: `npx tsc --noEmit`. Architecture and the *why*
live in [`docs/design.md`](docs/design.md); engine mechanics, REST/snapshot
internals, and the GUI-vs-REST rule in [`docs/development.md`](docs/development.md).

Dependency and supply-chain practices (lockfile, audit gate, pinned Actions,
Dependabot) and how to report a vulnerability: [`SECURITY.md`](SECURITY.md).
