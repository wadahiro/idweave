# CLAUDE.md

**idweave** (CLI: `idw`) — a test harness for **end-to-end tests against the real systems**.
It verifies a **midPoint** deployment's config (mappings, roles, correlation, sync, policy)
behaves as intended — driving and asserting **CSV** and **LDAP/AD** systems, and driving
**Keycloak** for SSO login and snapshot cache-clear.
It verifies *the deployment's config*, not midPoint core; SCIM fits the same system model.

## Working principles
- **Think before coding** — state assumptions; surface ambiguity or alternatives instead of silently picking one.
- **Simplicity first** — build only what's asked; no unrequested abstraction, flexibility, or speculative error handling.
- **Surgical changes** — touch only lines that trace to the request; don't reformat or refactor untouched code; match existing style.
- **Goal-driven** — turn a vague ask into a verifiable goal, and define how each step is checked.

## Commands
- **Selectors** (two independent knobs; spell both out — `EXAMPLE=midpoint-basic VER=4.4`): `EXAMPLE=midpoint-basic|midpoint-advanced|keycloak` (default `midpoint-basic`) picks the suite; `VER=4.0|4.4|4.8|4.10` (default `4.10`) is the midPoint major. Today only midpoint-basic varies by `VER`; advanced pins 4.10 and keycloak has no midPoint (they ignore it for now).
- `make up` — start the EXAMPLE stack (a midPoint example bakes config in via post-init). `make all` = up → ready → test.
- `make run` — run scenarios via the **CLI** (`tsx src/cli.ts run`, the consumer entry): emits `examples/reports/{junit.xml,ctrf.json}`, exits non-zero on failure. Needs the stack up.
- `make test` — run scenarios via `vitest run examples/` (engine self-test, 1 scenario = 1 test). Needs the stack up.
- `make unit` — core unit tests under `src/` (registry/handlers/schema; **no running stack**, fast).
- `make scenarios` / `scenarios-md` — list test cases. `make capture-expected` — (re)capture `expected/` by recording current behaviour, then verify by intent.
- `idw steps` / `idw help` — the step vocabulary and command index, **generated from the registry** (single source of truth, never hand-synced): `src/cli/describeSteps.ts` reads each handler's schema; `src/cli/help.ts` lists commands. `idw steps embed` (`make readme-steps`) refreshes the generated step reference between markers in `README.md`; a unit test fails if it drifts.
- `make snapshot-build [NAME=x]` / `snapshot-list` / `snapshot-restore [NAME=x]` — whole-env snapshot/restore (idempotency reset). `SNAPSHOT_BACKEND=tar` (default) or `btrfs`. `make config` / `triage` — re-apply config via REST / offline triage.
- One CLI: `tsx src/cli.ts <run|import-config|wait-ready|capture-expected|scenarios|steps|help|snapshot-build|...>`. Shared exec/report core: `src/scenario/runSuite.ts` + `src/report/` + `reportFailure` (`src/scenario/failure.ts`).
- Runtime/test: **Node** (via `tsx`) + **vitest**. `*.test.ts` under `src/` = unit lane, `examples/` = connected lane.
- **After any edit: `npx tsc --noEmit`.**

Test target: midPoint **4.10.1** at `http://localhost:8080/midpoint`, `administrator` / `Test5ecr3t`.

## Layout
- `src/` — engine: role modules `env/` (readiness) · `clients/` (protocol adapters) · `actions/` (domain verbs) · `verify/` (normalize + compare) · `scenario/` (the engine) + CLI (`src/cli.ts`, `src/cli/`). Runner-independent; a small dependency graph over the shared `clients/` foundation, not a strict layer stack.
- `src/scenario/steps/` — **step registry**: one `StepHandler` per kind co-locating its JSON-Schema fragment + type guard + `run` (calls `actions/`) + listing render + its `phase` (lifecycle role, **required**) and `appliesTo` (system kinds it may name). **A new step kind = one handler file + one line in `registry.ts`** (+ its verb in `actions/`); `idw steps`/`idw help` and the docs reference all generate from this. Unit-tested without a running stack.
- `examples/` — self-contained demos = the engine's own e2e test. `midpoint-basic/` serves midPoint 4.0/4.4/4.8/4.10 from ONE scenario tree (`scenarios/<cat>/<name>/{scenario.yaml, expected/<ver>/}` + `suite.yaml` with `version: ${MP_VERSION}`); `VER` selects `infra/<ver>/` + `midpoint-config/<ver>/` (via env `MP_VERSION`/`EXPECTED_VERSION`). `midpoint-advanced/` (LDAP+SCIM) and `keycloak/` are their own flat examples. `scenarios.test.ts` = the runner adapter.
- `testdata/` — convention for a private deployment suite (gitignored).

## Config = 3 layers
- **env** (`src/config.ts`, env vars): endpoints/creds, dirs, poll. No domain data.
- **suite** (`<scenariosDir>/suite.yaml`): the **`systems`** keyed by kind — an external `csv:`/`ldap:`/`scim:` scenarios read/write (`db:` is assert-only; `resource:` is connector-mediated), or a driveable `midpoint:`/`keycloak:` INSTANCE (its `version` selects GUI page objects + cache-clear; connection via env-var names; a `keycloak:` also serves as an assert target / per-user CRUD source) — and the **`triggers`** (recon/import task OIDs, keyed by system) that ingest them. The GUI version/overrides/auth live on the driven midpoint system (no top-level `gui.version`); a GUI step resolves its target by `system:` (default: the sole midpoint, else the sole driveable).
- **scenario** (`scenario.yaml`): one behavior, as ordered steps.

## Scenario model
Orthogonal steps, each naming the **`system:`** it acts on (omit when there is one; or a `<system>/<kind>` KEY PREFIX, e.g. `idm/delete-object`, `ldap/set` — the loader injects the named system, so multi-instance suites stay explicit): **mutate** (`set`/`add`/`replace`/`remove`; inline rows or `{file: ...}`), **trigger** (`import`/`recon`, runs the system's registered task), **assign**/**unassign** a role, **request-ui**/**approve-ui** (drive the GUI as a principal), **expect** (`objects` = focus, `accounts` = a provisioned account from a `system` by `identifier` or the whole set with `all: true`; `expected: <path>` or `absent: true`). `expect` is a step → assert at any point.
- Add a scenario: new dir under `examples/<suite>/scenarios/<cat>/<name>/`, write `scenario.yaml`, `make capture-expected` (writes `expected/` — `expected/<ver>/` in midpoint-basic), review the captured files against intent, `make test`. An idempotent pre-clean goes in an optional `setup:` block before `steps:`.
- **GUI is MANDATORY** when the screen / workflow / authz IS under test (REST can't reproduce it); REST **complements** for input-matrix coverage, indirect-assignment checks, ARRANGE, and bulk/reset.
- Deep dive — GUI-vs-REST decision, suite `systems` model, step-KIND wiring, REST/snapshot internals: **`docs/development.md`**. Why it's built this way: **`docs/design.md`**.

## Guardrails (non-negotiable)
- No `sleep`/fixed waits → poll (`src/poll.ts`). Async waits live only in `actions/` (`awaitTaskClosed`/`runRecon`).
- No logic in YAML (JSON-Schema-validated declarations only). Control flow → code.
- No GenAI on the runtime path (capture/triage are offline).
- Normalize in `verify/` only (strip OID/metadata/timestamps/refs/derived).
- Assert the REAL external end-state (no simulation mode); no implicit reset — re-runnability is each scenario's explicit `setup:` pre-clean, with `snapshot-restore` for whole-env reset.
- Endpoints/creds from env — never hardcode. Vocabulary: `expected` vs `actual` (not "golden").

## Gotchas
- A failed `expect` prints the failing step (and, for an `expect`, the preceding step) with a source excerpt + a colored expected/actual diff. Cross-system **dump is OFF by default**; `DUMP_ON_FAILURE=1` captures it. Console color auto-disables off a TTY.
- Tests need the stack up and baseline config present (post-init bakes it at `up`).
- **zsh**: unquoted `$VAR` does NOT word-split — loops over multiline vars break. Use arrays, `find -exec`, or `${=VAR}`.
- **No implicit reset: each scenario owns its data + an explicit `setup:` pre-clean.** That fully resets an all-CSV suite; any ldap/AD system → isolate via `snapshot-restore` between runs (a written account + auto-assigned GUID cascade past per-scenario cleanup).
- More mechanics — REST `PATCH`/registered-task run, snapshot near-non-stop + the Quartz/node-id trap, raw shadows (`?options=raw`), btrfs rootless chown: **`docs/development.md`**.
