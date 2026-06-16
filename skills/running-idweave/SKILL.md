---
name: running-idweave
description: >
  Run idweave end-to-end tests with the `idw` CLI against a midPoint (+ Keycloak/LDAP/SCIM)
  deployment — capture and REVIEW expected state, run a suite or a single scenario, read the
  expected/actual diff, reset the environment with snapshots, and triage failures. Use when
  the user wants to execute, capture, debug, or reset idweave scenarios, or asks about the
  `idw` commands, reports, or `make` targets. For writing the scenario.yaml itself, see the
  `writing-idweave-scenarios` skill.
allowed-tools: Bash(idw:*) Bash(npx:*) Bash(make:*) Read Bash(cat:*) Glob Grep
---

# Running idweave with the `idw` CLI

`idw` runs declarative scenarios against the **real** running deployment and asserts the
real end-state. Every command auto-loads a local `.env` (real shell/CI env overrides it) and
takes an optional path to the scenarios dir. Start with `idw help` for the full index and
`idw steps` for the step vocabulary.

## The authoring/run loop

```bash
idw init                 # (new project) scaffold .env + suite.yaml + an example scenario
# ...edit .env (endpoints/creds) and write a scenario.yaml...
idw capture-expected     # RECORD expected/*.json from the live end-state by running the scenario
# >>> REVIEW every captured expected/*.json against intent before trusting it <<<
idw run                  # assert against expected; colored diff on failure; non-zero exit
```

**Reviewing the capture is the most important step.** `capture-expected` records what the
system *did* — which may be a bug. Open each `expected/*.json` and confirm it matches what the
requirement/config *should* produce. A wrong capture pins a wrong oracle forever. After a
green run, run it **twice** to confirm the scenario is re-runnable (its `setup:` pre-clean
resets it).

### Scope to one scenario

Iterate on a single behaviour without re-running (and, in an LDAP suite, cross-contaminating)
the rest:

```bash
IDW_ONLY=<scenario-id> idw capture-expected
IDW_ONLY=<scenario-id> idw run
```

## Commands

| Command | Purpose |
|---------|---------|
| `idw help` | The command index (also shown with no command / `-h`). |
| `idw steps` / `idw scenarios` | The step vocabulary / the existing test cases. |
| `idw init [dir]` | Scaffold a starter project. Re-runnable (fills missing files only). |
| `idw capture-expected [dir]` | Record `expected/*.json` from the live end-state — then REVIEW. |
| `idw run [dir]` | Run every scenario, assert, write reports, exit non-zero on failure. **The consumer entry.** |
| `idw wait-ready` | Poll until midPoint REST is up and the baseline config is present. |
| `idw import-config [dir]` | Load `midpoint-config/*.xml` into midPoint via REST (no restart). |
| `idw snapshot-build [name]` | Snapshot the WHOLE environment as a named baseline. |
| `idw snapshot-restore [name]` | Reset the whole environment to a baseline. |
| `idw snapshot-list` | List baselines. |
| `idw triage [dir]` | Offline failure triage from `reports/ctrf.json`. |

## Resetting state: pre-clean vs snapshot-restore

- A scenario's own **`setup:` pre-clean** keeps it re-runnable. For a fully self-contained
  (all-CSV) suite, that's enough.
- A suite with **any LDAP/AD/SCIM** system needs a whole-env **`idw snapshot-restore`**
  between runs — a directory entry's server-assigned id cascades past a per-scenario clean.
  Build a baseline from a clean, configured stack (`idw snapshot-build`), run scenarios, then
  `idw snapshot-restore` to reset. (This is a dev/manual tool, deliberately not wired into a
  run, so a slow restore never inflates a suite.) `SNAPSHOT_BACKEND=btrfs` makes the reset
  instant; the default `tar` is portable.

## Failure output & reports

- **Terminal**: the failing step (and, for an `expect`, the preceding step) with a source
  excerpt and a colored expected/actual diff, pointing at your scenario. Set
  `DUMP_ON_FAILURE=1` to also capture a cross-system dump under `reports/dumps/`.
- **`reports/junit.xml`** (CI) and **`reports/ctrf.json`** (tool-agnostic) are written every run.
- `idw run` exits non-zero on any failure, so CI is just `npx idw run`.

## If the repo has a Makefile

Example/dev repos wrap the loop in `make`, which sets the endpoints, midPoint version, and
dirs for you:

```bash
make up                       # start the example stack
make capture-expected         # capture (add IDW_ONLY=<id> to scope to one scenario)
make run                      # run via the CLI;  make test = run via vitest
make unit                     # core unit tests, no running stack
make snapshot-build / snapshot-restore
```

Two knobs select what runs — spell both out: `EXAMPLE=<suite>` and `VER=<midPoint major>`
(e.g. `make run EXAMPLE=midpoint-basic VER=4.4`). A versioned suite captures into
`expected/<ver>/`, selected via env (`EXPECTED_VERSION`).

## Gotchas

- Tests need the stack **up** and the baseline config present (`idw wait-ready` gates on it).
- `IDW_ONLY` scopes capture/run to one scenario id — essential when iterating on an LDAP suite.
- Never point a run at production: it mutates the real systems (creates/deletes the data its
  scenarios own). Use a dedicated test deployment.
