/**
 * scenario — ScenarioLoader.
 *
 * Discovers scenario.yaml files, validates each against the JSON Schema
 * (assembled from the step registry — by design), and returns typed scenarios.
 * YAML carries ordered declarations only; any logic belongs in code, not here.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { parseDocument, LineCounter, isSeq, type Document } from "yaml";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import { sep } from "node:path";
import { buildScenarioSchema, buildCaseTemplateSchema, handlerFor } from "./steps/registry.ts";
import type { Scenario, LoadedScenario } from "./steps/types.ts";
import { systemKind, type Suite } from "./suite.ts";
import { hasCases, expandCases, assertNoInterpolation } from "./cases.ts";
import {
  loadGroup, validateGroupOrder, orderIndexOf, baseScenarioId, type Group,
} from "./group.ts";

// Re-export the shared scenario types from their home so existing importers
// (runner, listing) have a single, stable entry point.
export type {
  Row, RowsOrFile, ObjectType, ExpectedObject, ExpectedAccount,
  Scenario, Step, LoadedScenario, GroupMembership, ResetPolicy,
} from "./steps/types.ts";

/** The two validators a scenario file is checked against (see loadScenarioFile). */
interface Validators {
  /** Strict full schema (the step `oneOf`) — for a plain or expanded scenario. */
  scenario: ValidateFunction;
  /** Relaxed template schema — for a parameterized scenario before expansion. */
  template: ValidateFunction;
}

function compileValidators(): Validators {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return {
    scenario: ajv.compile(buildScenarioSchema()),
    template: ajv.compile(buildCaseTemplateSchema()),
  };
}

/**
 * Recursively find scenario.yaml files. A directory containing scenario.yaml is
 * a scenario LEAF (we don't descend into it, so expected/ and fixtures/ aren't
 * mistaken for scenarios); other directories are descended for organization
 * (e.g. scenarios/jml/joiner-basic/). suite.yaml at the root is ignored.
 */
async function discover(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === "scenario.yaml")) {
    out.push(join(dir, "scenario.yaml"));
    return;
  }
  for (const e of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await discover(join(dir, e.name), out);
  }
}

/** Recursively collect every directory that holds a group.yaml manifest. */
async function discoverGroups(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === "group.yaml")) out.push(dir);
  // Descend regardless: a group dir's members (scenario leaves) live below it.
  for (const e of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await discoverGroups(join(dir, e.name), out);
  }
}

/** The group whose directory is the nearest ancestor of `scenarioDir`, or undefined. */
function nearestGroup(scenarioDir: string, groups: Group[]): Group | undefined {
  let best: Group | undefined;
  for (const g of groups) {
    if (scenarioDir === g.dir || scenarioDir.startsWith(g.dir + sep)) {
      if (!best || g.dir.length > best.dir.length) best = g;
    }
  }
  return best;
}

/**
 * Discover and validate all scenarios under `scenariosRoot` (at any depth, so
 * scenarios may be organized into category folders). Throws on a schema
 * violation or a duplicate scenario id.
 */
export async function loadScenarios(scenariosRoot: string): Promise<LoadedScenario[]> {
  const root = resolve(process.cwd(), scenariosRoot);
  const validators = compileValidators();

  const files: string[] = [];
  await discover(root, files);
  files.sort();

  const groupDirs: string[] = [];
  await discoverGroups(root, groupDirs);
  const groups = await Promise.all(groupDirs.map((d) => loadGroup(join(d, "group.yaml"), d)));

  const loaded: LoadedScenario[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    // A parameterized file expands to several scenarios (id[case]); each gets the
    // same duplicate-id check, so a clash between a case and another scenario is
    // caught too.
    for (const ls of await loadScenarioFile(file, validators)) {
      const group = nearestGroup(ls.dir, groups);
      if (group) {
        ls.group = {
          id: group.id,
          reset: group.reset,
          orderIndex: orderIndexOf(group, baseScenarioId(ls.scenario.id)),
        };
      }
      const prev = seen.get(ls.scenario.id);
      if (prev) throw new Error(`Duplicate scenario id "${ls.scenario.id}" in ${file} and ${prev}`);
      seen.set(ls.scenario.id, file);
      loaded.push(ls);
    }
  }

  // Validate each group's order against its actual members (by base id, so a
  // parameterized member counts once), then order grouped members by it — a
  // chain (reset: none) must execute in the declared sequence. The sort is
  // stable, so non-grouped scenarios keep their path order.
  for (const group of groups) {
    const baseIds = [
      ...new Set(loaded.filter((l) => l.group?.id === group.id).map((l) => baseScenarioId(l.scenario.id))),
    ];
    validateGroupOrder(group, baseIds);
  }
  loaded.sort((a, b) =>
    a.group && b.group && a.group.id === b.group.id ? a.group.orderIndex - b.group.orderIndex : 0,
  );
  return loaded;
}

/** Format ajv errors for a failed validation. */
function schemaErrors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((e) => `  ${e.instancePath || "/"} ${e.message}`).join("\n");
}

/**
 * Load one scenario.yaml. A plain scenario yields one entry; a parameterized one
 * (a `cases:` table) expands to one entry per case (id `base[name]`).
 *
 * Parameterized validation is two-stage: the template is checked against the
 * relaxed `cases` schema (its steps may hold {from-case} reference nodes), then
 * each EXPANDED scenario's resolved steps are checked against the strict step
 * schema — so the real step contract is enforced post-resolution without
 * loosening any handler's fragment. All cases share the template's step lines,
 * so a failure still points at the right step in source.
 */
export async function loadScenarioFile(
  file: string,
  validators: Validators,
): Promise<LoadedScenario[]> {
  // Parse via a Document with a LineCounter so each step keeps its source line —
  // a failure can then point at the exact step in scenario.yaml. The validated
  // value is the plain JS projection (`toJS`), identical to a `parse()`.
  const lineCounter = new LineCounter();
  const doc = parseDocument(await readFile(file, "utf-8"), { lineCounter });
  const parsed = doc.toJS();
  // Normalize any `<system>/<kind>` step keys to the bare kind with the system injected
  // (before schema validation, so the rest of the pipeline sees the canonical form).
  for (const s of Array.isArray(parsed?.steps) ? parsed.steps : []) applySystemPrefix(s, file);
  for (const s of Array.isArray(parsed?.setup) ? parsed.setup : []) applySystemPrefix(s, file);
  const dir = dirname(file);
  const stepLines = stepStartLines(doc, lineCounter);
  const setupLines = stepStartLines(doc, lineCounter, "setup");

  if (hasCases(parsed)) {
    if (!validators.template(parsed)) {
      throw new Error(`Scenario ${file} failed schema validation:\n${schemaErrors(validators.template)}`);
    }
    assertNoInterpolation(parsed.steps);
    if (parsed.setup) assertNoInterpolation(parsed.setup, "setup");
    return expandCases(parsed).map((scenario) => {
      // Validate the resolved steps strictly. The synthesized `id[name]` would
      // not match the author-id pattern, so probe with the (pattern-valid) base
      // id; the bracketed id remains only on the returned scenario.
      const probe = { ...scenario, id: parsed.id };
      if (!validators.scenario(probe)) {
        throw new Error(
          `Scenario ${file} (case "${scenario.id}") failed schema validation:\n${schemaErrors(validators.scenario)}`,
        );
      }
      return { scenario, dir, file, stepLines, setupLines };
    });
  }

  if (!validators.scenario(parsed)) {
    throw new Error(`Scenario ${file} failed schema validation:\n${schemaErrors(validators.scenario)}`);
  }
  return [{ scenario: parsed as Scenario, dir, file, stepLines, setupLines }];
}

/**
 * Rewrite a `<system>/<kind>` step key (e.g. `idm/delete-object`) into the bare `<kind>`
 * with the system injected into the handler's declared param — so handlers run unchanged
 * and the schema validates the canonical form. The system's existence/kind is checked at
 * run time by the handler's resolve. A no-op for un-prefixed steps; throws on an
 * un-prefixable kind or a prefix that conflicts with an inline param.
 */
export function applySystemPrefix(step: Record<string, unknown>, file = "<scenario>"): void {
  if (typeof step !== "object" || step === null) return;
  const prefixedKey = Object.keys(step).find((k) => k.includes("/"));
  if (!prefixedKey) return;
  const slash = prefixedKey.indexOf("/");
  const system = prefixedKey.slice(0, slash);
  const kind = prefixedKey.slice(slash + 1);
  if (!system) throw new Error(`Scenario ${file}: empty system prefix in step key "${prefixedKey}"`);
  const value = step[prefixedKey];
  // Find the handler by matching the bare-kind probe (covers mutate, whose kinds are
  // set/add/replace/remove rather than its handler `kind`).
  const handler = handlerFor({ [kind]: value });
  if (!handler) throw new Error(`Scenario ${file}: unknown step kind "${kind}" in "${prefixedKey}"`);
  if (!handler.prefix) {
    throw new Error(`Scenario ${file}: step "${kind}" does not accept a "<system>/" prefix (its target is its value or an env default)`);
  }
  delete step[prefixedKey];
  step[kind] = value;
  const { param, into } = handler.prefix;
  if (into === "sibling") {
    if (step[param] !== undefined) throw new Error(`Scenario ${file}: "${prefixedKey}" also sets \`${param}\` inline — use one`);
    step[param] = system;
  } else {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Scenario ${file}: prefixed step "${kind}" needs an object value to carry \`${param}\``);
    }
    const v = value as Record<string, unknown>;
    if (v[param] !== undefined) throw new Error(`Scenario ${file}: "${prefixedKey}" also sets \`${param}\` inline — use one`);
    v[param] = system;
  }
}

/**
 * Cross-check each scenario's system references against the loaded suite — a static
 * pass (no running stack) that fails fast with a source line when a step names a
 * system its kind can't act on (e.g. `db/set`, since `mutate` applies to csv/ldap/scim/
 * keycloak, not db) or names an unknown system. Covers the steps that carry a system
 * in a DECLARED param (the `prefix`-opt-in kinds — mutate/trigger/clear-focus/
 * clear-shadow/delete-object); a step that uses the sole/default system (no name) is
 * resolved at run time. The handler's `appliesTo` is the allow-list.
 */
export function validateScenarioSystems(scenarios: LoadedScenario[], suite: Suite): void {
  for (const ls of scenarios) {
    checkStepSystems(ls.scenario.setup ?? [], ls.setupLines ?? [], ls.file, suite);
    checkStepSystems(ls.scenario.steps, ls.stepLines ?? [], ls.file, suite);
  }
}

function checkStepSystems(steps: unknown[], lines: number[], file: string, suite: Suite): void {
  steps.forEach((raw, i) => {
    const step = raw as Record<string, unknown>;
    const handler = handlerFor(step);
    if (!handler?.prefix || !handler.appliesTo) return;
    const { param, into } = handler.prefix;
    const holder = into === "sibling" ? step : (step[handler.kind] as Record<string, unknown> | undefined);
    const name = holder?.[param];
    if (typeof name !== "string" || !name) return; // uses the default system — resolved at run time
    const at = `${file}:${lines[i] || "?"}`;
    const spec = suite.systems[name];
    if (!spec) throw new Error(`${at}: step \`${handler.kind}\` names unknown system "${name}"`);
    const kind = systemKind(spec);
    if (!handler.appliesTo.includes(kind)) {
      throw new Error(
        `${at}: step \`${handler.kind}\` cannot act on system "${name}" (a ${kind} system) — it applies to: ${handler.appliesTo.join(", ")}`,
      );
    }
  });
}

/** 1-based start line of each item in the named sequence (`steps`/`setup`; 0 where unknown). */
function stepStartLines(doc: Document, lineCounter: LineCounter, key = "steps"): number[] {
  const seq = doc.get(key, true);
  if (!isSeq(seq)) return [];
  return seq.items.map((item) => {
    const range = (item as { range?: [number, number, number] }).range;
    return range ? lineCounter.linePos(range[0]).line : 0;
  });
}
