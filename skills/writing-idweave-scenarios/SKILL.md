---
name: writing-idweave-scenarios
description: >
  Author or edit an idweave scenario.yaml — the declarative end-to-end test of a midPoint
  (+ Keycloak/LDAP/SCIM/CSV) deployment's behaviour. Covers the scenario model (arrange →
  act → assert), the step vocabulary, expect/assert, targeting systems, re-runnable-scenario
  discipline, and GUI-vs-REST. Use when the user wants to add or change a test scenario, or
  asks how to express a behaviour (joiner, leaver, role assign/unassign, approval, provisioning
  to a target). For running/capturing the scenario with the CLI, see the `running-idweave` skill.
allowed-tools: Bash(idw:*) Bash(npx:*) Read Write Edit Glob Grep
---

# Writing idweave scenarios

idweave verifies a **midPoint deployment's configuration** by driving and asserting the
**real** systems it provisions — CSV, LDAP/AD, SCIM, SQL, Keycloak, connector-mediated
resources — plus the midPoint GUI. A scenario is a declarative YAML file; it never
simulates and it tests the deployment's config, not midPoint core.

## The model (read first)

A scenario is a small ordered pipeline — **arrange a source → drive midPoint → assert a
target** — as declarative steps, each naming the **`system:`** it acts on.

- **Declarative, no logic.** YAML holds ordered declarations only — no variables,
  conditionals, or loops (by design: scenarios stay listable and diffable). If you reach
  for logic, re-shape the steps instead.
- **Four lifecycle phases.** `arrange` (seed input/state) → `act` (the behaviour under
  test) → `assert` (`expect`) → `reset` (a `setup:` pre-clean). `expect` is itself a step,
  so assert at any point in the flow.
- **The oracle is the real end-state.** An action runs, then `expect` reads the real focus
  user and/or the real provisioned account and compares it to a captured `expected/*.json`.

## Discover the vocabulary — never guess

The CLI is self-describing. Before writing, run:

```bash
idw steps       # EVERY step kind, grouped by phase, with its fields + the systems it can name
idw scenarios   # existing test cases (ids / requirements / steps / asserts) — copy a close one
cat <scenariosDir>/suite.yaml   # the system NAMES this deployment exposes + their kinds
```

Use only step kinds and fields that `idw steps` lists. It also shows, per step, which
system KINDS it may name (e.g. `mutate` → csv·ldap·scim·keycloak; `expect` accounts → any
target), so you pick a `system:` of a compatible kind.

## Anatomy of a scenario.yaml

```yaml
id: joiner-provisions-ldap          # stable, kebab-case; also the test name
requirement: REQ-JML-001            # traceability id
description: >
  HR creates a user; recon provisions an LDAP account carrying the mapped attributes.

setup:                              # OPTIONAL idempotent pre-clean (the "reset" phase), run BEFORE steps
  - clear-focus: { name: jdoe }     # own only what you create — clear a leftover from a failed run

steps:
  - set:                            # ARRANGE: write the source (here a CSV row)
      - login: jdoe
        firstname: John
        lastname: Doe
        email: jdoe@example.com
    system: hr                      # the system this step acts on (omit if the suite has exactly one)
  - trigger: import                 # ACT: run the deployed import/recon task for `hr`
    system: hr
  - expect:                         # ASSERT: the real focus + the real provisioned account
      objects:
        - { type: user, name: jdoe, expected: expected/user.json }
      accounts:
        - { system: ad, identifier: jdoe, expected: expected/account.json }
```

- **`expect.objects`** asserts a midPoint focus (user/role/org/service). **`expect.accounts`**
  asserts a provisioned account read from a target `system`, by `identifier` — or the WHOLE
  set with `all: true` (order-independent "exactly these exist"; csv/ldap/scim only). Use
  `absent: true` in place of `expected:` to assert non-existence.
- Inline rows or a fixture file: `set: { file: rows.csv }`.

## Targeting a system

Either the sibling **`system:`** key, or a **`<system>/<kind>` key prefix** on the step —
`ldap/set`, `hr/trigger: import`, `idm/clear-focus`. In `idw steps`, a `✦` marks the kinds
that accept the prefix. The prefix names the suite system the step acts on (a CSV/LDAP/SCIM
source, a target resource, or the midPoint instance for focus/GUI steps), and is most useful
when a suite declares several instances. Omit the system entirely when the suite has one.

## Make scenarios re-runnable (a hard rule)

A scenario must leave the deployment as it found it — the suite stays idempotent with **no
hidden reset**, so a failure is about the steps you wrote, not reset machinery.

1. **Treat the baseline as read-only** — assert seeded config/data, never delete or modify it.
2. **Own the data you mutate** — create the users/entries a scenario changes under an id
   unique to it, and remove them within it; never reuse another scenario's subject.
3. **Put the idempotent pre-clean in `setup:`** — `clear-focus` / `clear-system` /
   `clear-shadow` / `clear-mail` / `remove`, each a no-op when absent. To test a deletion
   (leaver, revoke, out-of-band break), CREATE the subject first, then delete it — never
   delete baseline data.

## GUI vs REST — pick by what's under test

Most steps drive midPoint over REST. The **`*-ui` steps** drive the real GUI (Playwright) as
a principal — use them ONLY when the screen / workflow / authz IS the thing under test (REST
can't reproduce it): a self-service request → approve/reject/forward, an admin assign/unassign
through the edit-user screen, menu/field visibility gated by authz. Drive ONE representative
GUI case per flow; use REST (`assign`/`set`/…) for input-matrix coverage and to ARRANGE a
precondition. `idw steps` lists the `*-ui` kinds.

## Express variation without logic

- **Data-only variation across N cases** → a `cases:` table on the scenario (each case binds
  values into the steps via `{ from-case: <field> }`); copy an existing parameterized scenario.
- **Ordering / chaining related scenarios** → a `group.yaml` in the parent directory.
- Never `${}`-interpolate inside a step or add a conditional — that's logic, which lives in
  code, not YAML.

## Gotchas

- The captured `expected/*.json` is **characterization, not a guarantee** — always review it
  against intent (the `running-idweave` skill covers the capture→review→run loop).
- `trigger:` runs a task you DEPLOYED (bound in `suite.triggers`), never a generic import.
- Don't hardcode endpoints/creds — they come from env, referenced in suite.yaml by var name;
  the same scenario runs unchanged across environments.
- A step's `system:` must be a real `suite.yaml` entry of a kind that step supports — the
  loader rejects e.g. `db/set` (mutate can't act on a db) at load, with a source line.
- A new scenario lives in `<scenariosDir>/<category>/<name>/` (categories group scenarios,
  e.g. `access/`, `identity/`, `operations/`); copying a nearby scenario is the fastest start.
