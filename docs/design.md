# DESIGN

Why **idweave** is built the way it is — the parts not obvious from the code or
from `CLAUDE.md` (which covers commands, conventions, and gotchas). idweave
(identity × weave, CLI `idw`) is a test harness for end-to-end tests against the
real systems of an IAM landscape. It drives and asserts **midPoint** config
over **CSV** and **LDAP/AD** systems, drives **Keycloak** for SSO login, and asserts
provisioned state in **Keycloak** realms and **SCIM** service providers as targets.
A `system` is registered once, keyed by kind: a
`midpoint`/`keycloak` entry is a driveable INSTANCE; a `csv`/`ldap`/`db`/`scim`
entry is an external source/target whose role depends on how a scenario uses it
(a `keycloak` instance also serves as an assert target / per-user CRUD source).
Implementation lives in `src/`.

## Mission & priorities
Verify that *a midPoint deployment's config* (mappings, roles, correlation, sync,
policy) behaves as intended, via automated **end-to-end tests against the real
systems**. Not a test of midPoint core. Priorities, in order: **resilience > maintainability > AI-native
authoring**. Open-sourced → keep clean boundaries, docs, and secret
hygiene — but build only for the system kinds that exist (midPoint, Keycloak) —
no vendor-neutral abstraction for hypothetical products (YAGNI).
IGA testing is a "thin unit, thick integration" diamond: **integration is the
main battlefield.**

## Roadmap
- **Step 1 (done):** developers run the suite locally. JML lifecycle
  (Joiner/Mover/Leaver) green end-to-end.
- **Step 2:** the same suite in CI.
- **Step 3:** data patterns / edge cases (masked production-like subset, local).
- **Step 4:** STG (perf, full volume, release gate) + read-only invariant
  monitoring against prod.

Build later steps as *stubs only* until reached.

## Architecture rationale
A runner-independent core of role modules + a thin runner adapter. This lets the
language/runner change later, lets REST-driven and a future UI path share one
core, and lets local and CI run the same suite. It is NOT a strict layer cake:
runtime dependencies flow one direction (a module uses the protocol adapters and
other core modules, never the runner), but it is a small dependency graph over a
shared `clients/` foundation — modules reach `clients/` directly, and the shared
config types live in `scenario/`.
- `env/` readiness · `clients/` protocol adapters (the shared foundation) ·
  `actions/` domain verbs (async waits confined here) · `verify/` deterministic
  check (normalize → assert) · `scenario/` the engine · `runner` the thin adapter
  (1 scenario = 1 test).
- **Step registry (in `scenario/`):** each step kind is a self-contained `StepHandler`
  (JSON-Schema fragment + type guard + `run` + listing render) under
  `src/scenario/steps/`; loader/runner/listing iterate the registry, so a new
  kind is one handler file + one line — no shotgun surgery across
  schema/types/dispatch/display. Handlers take an injected context, so the core
  is unit-tested without a running stack. Two lanes: **units** (`make unit`, no
  stack, parallel) and **connected scenarios** (`make test`, serial, needs the stack).
- **Public boundary:** `src/` + CLI are OSS-publishable; the real suite
  (`testdata/`: scenarios, expected files, policy-derived config) stays private —
  it exposes our concrete config and, by omission, what we do *not* test.

## Key decisions (the "why")
- **TypeScript on Node** (over Python/Groovy): Playwright is Node-first for the UI
  layer, ajv is best-in-class for the JSON-Schema-validated YAML, types aid
  resilience. Runtime runs `.ts` directly via **tsx**; the test runner is **vitest** —
  Bun was evaluated and reverted (its Playwright-driving-Chromium intermittently
  crashed the browser and hung the run,
  [oven-sh/bun#8222](https://github.com/oven-sh/bun/issues/8222)). Worth revisiting for
  Bun's speed once that stabilizes — watch the issue. The harness does runtime dynamic
  `import()` of a project's `.ts` page-object override, which tsx handles. The
  installed CLI runs through a tiny `node` launcher (`bin/idw.mjs`) that registers
  tsx, so `npx idw` needs no tsx on the consumer's PATH; distribution is a
  `file:`/npm dependency (a single-binary compile stays a later option — not Go,
  which would lose the Playwright/JS ecosystem). CTRF is `scripts/junit-to-ctrf.ts`
  over vitest's JUnit output.
- **REST-driven core + a thin GUI layer where the screen IS the thing under test.**
  Most steps drive REST; a Playwright + PageObject UI layer drives the real
  self-service screens (request → approve / reject / forward, on-behalf requests,
  org-tree creation) that REST cannot reproduce faithfully. The PageObject framework
  is version-aware (stock modules per midPoint major + per-project overrides).
  Decisions with no clean REST path use Groovy-over-REST `executeScript`.
- **One `systems` registry, role decided by use** (not split `sources`/`targets`).
  A real directory is often both reconciled-FROM and provisioned-INTO; splitting
  it duplicated the connection. So a system is registered once — protocol as the
  discriminating KEY (`csv:`|`ldap:`|`db:`|`scim:`, a strict tagged union in schema
  and TS; `db:` is an assert-only target read over SQL; `scim:` is both an assert
  target and a CRUD source over the SCIM REST API; a `keycloak:` instance is an
  assert target and a per-user CRUD source over admin REST) — and a step decides the
  role (written/triggered = source, asserted = target).
  midPoint coupling is minimized: a system carries no resource OID (writing/reading
  it is not midPoint-dependent); the registered recon/import task it's ingested by
  lives in a separate `triggers` map. `trigger:` always runs a DEPLOYED task (no
  generic one-shot import) — the harness verifies your configured tasks, not core.
- **Tagged unions are EXTERNALLY tagged — the variant name is the KEY**, not an
  inner `type:` field. Used everywhere a choice is encoded: systems
  (`csv:`|`ldap:`|`db:`|`scim:`), step kinds (one handler per key), and a `consistentWith`
  transform method (`delimited:`, future `regex:`). Each variant object is
  `additionalProperties:false`, so one variant's params can't bleed into another —
  illegal combos are structurally unrepresentable (correct-by-construction); a
  schema `oneOf` over key-presence enforces exactly one. The internally-tagged
  `{type: …}` form (OpenAPI's `discriminator`) exists for language-polymorphism
  codegen, a stable extensible wire value, and targeted validation errors — none of
  which apply to a human-authored, Ajv-validated config (serde names these
  externally- vs internally-tagged and defaults to external). The one accepted
  cost: Ajv's `oneOf` error on a malformed rule is vaguer than a discriminator's.
- **Connector-mediated `resource` target — the generic oracle for the long tail, kept
  SIDE-EFFECT-FREE.** A direct reader (csv/ldap/db/scim) is the strong, independent oracle
  for a standardized protocol, but an OSS tool can't ship a client for every proprietary
  connector. So a `resource` system reads/asserts a target THROUGH midPoint's own
  connector — "if midPoint connects to it, idweave can assert it." The hard constraint:
  an oracle must not mutate the system under test, and midPoint's public `ProvisioningService`
  PERSISTS a shadow on every read. So the read runs a Groovy `executeScript` (bulk action)
  that calls the one-level-lower `provisioning…resourceobjects.ResourceObjectConverter` —
  it uses the resource's stored connector config but writes NO shadow to the repository
  (verified against source) — and returns the attributes as JSON the engine parses. The
  object is keyed at the connector level by `objectClass` (+ an `identifierAttr`); midPoint
  `kind`/`intent`/`tag` are optional refinements. The same shadow-free path also DRIVES the
  target — create/set/clear/delete (ARRANGE) at the `resourceobjects` layer — so a created
  object is connector-deletable, so a scenario's own pre-clean removes it (it doesn't force a
  suite non-self-contained). Internal API ⇒ a version-specific Groovy dialect per major
  (4.0/4.4/4.8/4.10), like the cache-clear — the resourceobjects API was refactored across
  versions (PrismObject → ShadowType → wrapper+effective-policy).
- **Config is the fixed subject under test**, not a per-scenario variable.
  Scenarios drive *runtime* behavior (source data, requests, approvals, recon,
  reports) and never mutate config. So config is constructed once (post-init bake,
  + REST for the dev loop) and the environment is reset by **whole-env snapshots**
  (docker volumes + host binds), not by re-importing.
- **Idempotency by scenarios owning their data — no hidden reset.** There is no
  implicit per-scenario reset: a scenario asserts the read-only baseline freely,
  creates the data it mutates under a unique id, and clears its own leftovers in an
  explicit `setup:` pre-clean (`clear-focus`/`clear-system`/`remove`). State stays
  legible — a failure is about the steps you wrote, not reset machinery. This
  explicit pre-clean fully resets an all-CSV suite (the harness owns the files, the
  id is stable). Once a real directory (LDAP/AD) is involved, a written account
  cascades (source → recon → focus → shadow → downstream) past per-scenario cleanup
  and stable identity is lost to auto-assigned GUIDs, so isolation between runs is a
  whole-env snapshot restore. The snapshot/restore tool is STANDALONE and
  deliberately NOT wired into a scenario run — a >1-min whole-env restore would turn
  every suite into a slow test. Heavy infra (snapshot/restore/up) is owned by the
  outer orchestrator; no docker socket reaches test code.
- **Reporting decoupled from the test body:** JUnit (CI) + CTRF (offline AI
  triage). A reporting platform (ReportPortal / Allure / …) is a Step-2 choice,
  deferred behind those artifacts.

## Non-goals (deliberately not built)
A vendor-neutral abstraction or support for IGA products beyond midPoint and Keycloak; UI-driven tests or a
test-management app; LLM on the runtime path; simulation-mode-based design;
`sleep`-based waits, logic inside YAML, or a custom DSL. Step 2+ machinery
(CI / STG / prod monitoring / data migration) — stubs only for now.

Operational rules, conventions, and gotchas: see [`../CLAUDE.md`](../CLAUDE.md).
The *how* (engine mechanics, REST/snapshot internals, GUI-vs-REST rule): see
[`development.md`](./development.md).
