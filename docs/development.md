# Developing idweave

Deep mechanics and judgement calls for working on the engine — the detail that only matters when
you're touching a specific area, kept out of `CLAUDE.md` so it isn't re-read every session.

- [`../CLAUDE.md`](../CLAUDE.md) — always-on rules, the layout map, and a pointer here.
- [`design.md`](./design.md) — *why* idweave is built this way (mission, decisions, non-goals).
- [`../README.md`](../README.md) — running idweave against your own midPoint, btrfs setup, reports.

Mechanism comments live next to the code; this file links to them rather than restating them.

## GUI (Playwright) vs REST — pick by what's under test

GUI is **MANDATORY** (REST can't substitute — not just slower, it's WRONG: it can't reproduce the
behavior) when the screen / workflow / authz **is** the thing under test:

- the real screen flow — a self-service request → **approve/reject/forward**, or an on-behalf
  (`for`) request as a manager;
- **request-phase POLICY enforcement that surfaces a user-facing error/validation** — e.g. a role
  whose request REQUIRES an activation end-date: drive `request-ui { …, expectError: "<substring>" }`
  (negative — assert the GUI error) and `request-ui { …, validFrom/validTo }` (positive). Admin REST
  `assign` bypasses the request-phase policy and raises NO GUI error, so REST cannot test this;
- menu visibility / requestability gated by archetype authz (`expect-menu` / `expect-requestable`).

Drive **ONE representative GUI case per distinct flow** — the GUI proves the flow works; it does NOT
need re-running for every data variation.

REST (`assign`/`unassign`, `set-*`, REST reads) **COMPLEMENTS** the GUI for what the flow does NOT
vary (it's an addition, not a replacement):

- rule/logic input-matrix coverage (e.g. the subtype×org-code routing across many org codes — the
  GUI path is identical, so vary inputs cheaply);
- indirect-assignment path checks as a unit (does assigning role X induce membership Y);
- ARRANGE — building a precondition state for a GUI test (fixtures, disable, expire); GUI-for-arrange
  is slow and brittle;
- bulk / baseline provisioning reads, and idempotent reset.

`assign` runs provisioning, so its end-state equals a GUI-approved request's — faithful for an
induction/provisioning check (the assignment is the precondition, the induction is what's asserted).

## The suite `systems` model

A scenario names the **`system:`** it acts on. In `suite.yaml`, each system is keyed by protocol —
**the KEY is the discriminator**: `csv:` (a file), `ldap:` (a directory), and `scim:` (a SCIM 2.0
Service Provider) are read/write source-or-target systems; `db:` (SQL) is an **assert-only** target
read over its own API; `resource:` is a **connector-mediated** target — read THROUGH
midPoint's connector (an `executeScript` calling `ResourceObjectConverter`, persisting NO shadow, so
the oracle doesn't mutate the SUT) for any target idweave has no native client for; `midpoint:`/
`keycloak:` are driveable INSTANCES (a `keycloak:` also serves as an assert target AND a per-user CRUD
source — read/write a realm user over admin REST; a blanket `set`/`reset` is refused, as a realm is a
shared namespace holding admin/service accounts). A `resource:` keys on `objectClass` + `identifierAttr` and does NOT make a suite
non-self-contained (it isn't washed; reads are side-effect-free). A system is registered **ONCE**;
its ROLE (source when written/triggered, target when asserted) is decided by **how a scenario uses it**,
so a bidirectional directory isn't duplicated. There is no `resourceOid`/`objectClass` on a system.

LDAP connection: the `url` (scheme picks TLS) + bind `dn` are suite data; only the bind password is a
secret, named via `bind.passwordEnv` and read from an env var. The **`triggers`** (midPoint recon/import
task OIDs, keyed by system) ingest what scenarios write.

midPoint instances are themselves declared as systems of type `midpoint` =
`{baseUrlEnv, usernameEnv, passwordEnv, version}` — `version` is **per-instance** (a deployment may run
two midPoint instances at different versions). External source/target systems (csv/ldap/db/scim) are
distinguished from the restore-participant instances (midpoint/keycloak, via `midpointSystems()`):
a midpoint/keycloak instance is reset by snapshot-restore, never by a scenario's per-system pre-clean.

**Targeting a system by KEY PREFIX.** A step that names a system (the `system:`/`midpoint:` param)
can instead carry a `<system>/<kind>` key prefix — `idm/delete-object: {…}`, `idm2/clear-focus: {…}`,
`ldap/set: [...]`, `hr/trigger: import`. The loader (`applySystemPrefix`) resolves the prefix and
injects it into the handler's declared param, so handlers run unchanged and the schema validates the
canonical form; the system's existence/kind is checked at run time. A handler opts in with
`prefix: { param, into }` (`into: "value"` for a nested step's inner field, `"sibling"` for a flat step
like mutate). **Every step with a single `system:`/`midpoint:` param opts in** (uniform by design); the
only steps that don't are those where a prefix can't map — the target IS the value (`clear-system`), an
env default (`clear-mail`, `search-federated-user`), or a per-entry list (`expect`, which names a system
inside each `accounts` entry, so no single step-level system). Most useful for multi-instance suites
(which midPoint owns this delete) — the bare form still uses the sole/default system.

## Adding a scenario / a step KIND

- **A scenario**: new dir under `examples/<suite>/scenarios/<cat>/<name>/`, write `scenario.yaml` (an
  optional `setup:` block holds the idempotent pre-clean; `steps:` is the behaviour under test), run
  `make capture-expected`, **review the captured `expected/*.json` against intent** (record current
  behaviour, then verify it against intent — never trust the capture blindly), then `make test`.
- **A step KIND**: one `StepHandler` file in `src/scenario/steps/` (co-locating its JSON-Schema
  fragment + type guard + `run` calling `actions/` + listing render + its `phase` and `appliesTo`
  metadata) + **one line in `registry.ts`** + its verb in `actions/`. The loader/runner/listing AND
  the generated step reference (`idw steps`, `src/cli/describeSteps.ts`) all iterate the registry, so
  that's the whole wiring. `phase` is a REQUIRED field, so a new handler can't silently miss the
  lifecycle grouping (tsc enforces it); `appliesTo` lists the suite-system kinds the step's `system:`
  may name (omit for a step that names none — a mail/host-file step) and is checked at load by
  `validateScenarioSystems` (a `prefix`-opt-in step naming a system of the wrong kind — `db/set` — or
  an unknown system fails with a source line, before any execution). `make unit` covers the
  registry/schema with no running stack.

## REST operation patterns

- **Modify** = `PATCH /{type}/{oid}` with body `{objectModification:{itemDelta:[...]}}`.
- **Recon/import run a REGISTERED task** (`runRegisteredTask`): `POST /tasks/{oid}/run` (run-now, racy),
  then wait for `lastRunStartTimestamp` to advance AND that fresh run to FINISH
  (`lastRunFinish ≥` the new start). A recurring SCHEDULED task returns to `runnable` and **never
  `closed`**, so do NOT wait for `closed`. `triggers[<system>]` binds `recon`/`import` to task OIDs;
  BOTH require a registered task — no generic-import fallback (the harness verifies your DEPLOYED tasks).
  Cold recon right after a `snapshot-restore` reboot is slow → give `POLL_TIMEOUT_MS` headroom.
- **Raw shadows**: use `?options=raw` to read/delete shadows the normal (fetch) path hides (e.g.
  broken/orphan shadows). The shadow `name` is its secondary identifier (the entry DN for
  LDAP, the bare id for a flat resource), and a search result is XML wrapping
  `<apti:object oid=...>`.

## Resetting state: explicit pre-clean vs snapshot-restore

There is **no implicit reset** — a scenario owns the data it mutates and clears its own leftovers in an
explicit `setup:` pre-clean (`clear-focus`/`clear-system`/`remove`, each a no-op when absent). For a
fully self-contained (all-CSV) suite that pre-clean fully resets: the harness owns the files, the id is
stable (no GUID), the cascade is resettable. A suite with **ANY** ldap/AD system does NOT come back from
a per-scenario pre-clean alone — a written account cascades (source → recon → focus → shadow →
downstream) past it, and a re-created directory entry gets a fresh server id (entryUUID / SCIM id) that
no longer matches midPoint's shadow. Isolate those by restoring a snapshot — a MANUAL/dev step (the
snapshot CLI is deliberately NOT wired into a run, so a slow whole-env restore never inflates a suite);
run it between suite runs to reset.

### snapshot near-non-stop restore

`snapshot-restore` stops only the DB + pauses the rest (**no midPoint reboot**), per `suite.snapshot.restore` /
env `SNAPSHOT_RESTORE_STOP` + `SNAPSHOT_RESTORE_ROLLBACK`. The JDBC pool reconnects in seconds instead of a
multi-minute midPoint restart. Two auto-handled constraints — don't fight them:

1. **Don't restart midPoint between `snapshot-build` and the restore.** midPoint generates a random
   `internalNodeIdentifier` each boot; rolling the DB back desyncs the in-memory id from the repo, which
   the node self-diagnostic reads as split-brain and **permanently kills the Quartz scheduler**. The
   `nearNonStopSafe` guard records each service's `StartedAt` at `snapshot-build` and **auto-falls-back to a
   full restart** if a paused service restarted — preventing the silent scheduler death.
2. **After the rollback, snapshot-restore runs each system's `afterRestore` hook.** For midPoint that clears
   its now-stale `RepositoryCache` (global cache is on; an external DB change has no invalidation
   trigger, so it can be stale for ~10–60s). The cache-clear is `CacheDispatcher.dispatchInvalidation`
   run as a Groovy bulk action over admin REST; the `SpringApplicationContextHolder` package moved
   between major versions (4.0/4.4 = `wf.impl.processes.common`, 4.8/4.10 = `model.impl.expr`), so the
   clear script branches on `version`. A `keycloak` instance's hook instead clears its realm/user/keys
   caches over admin REST (version-independent — the endpoints are stable, no branch).

Mechanism and the reasoning behind both: code comments in `src/scenario/restore.ts`,
`src/clients/cacheClear.ts`, and `src/cli/snapshot.ts`. Backend choice (tar / btrfs) and the rootless-docker
btrfs setup (subuid chown per subvolume; container-uid 0→host 501, N→524288+N-1, postgres 70→524357,
home→501; no `nocopy` needed) are in [`README.md` › "Fast reset with btrfs (optional)"](../README.md).
