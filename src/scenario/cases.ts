/**
 * Parameterized scenarios — a `cases:` table expanded into one concrete scenario
 * per case at LOAD time, so the runner, runSuite, listing and capture all see N
 * ordinary scenarios and need no changes.
 *
 * Guardrail (by design "No logic in YAML / control flow → code"): `cases:` is
 * pure literal data (a list of value objects); the LOOP over it lives here in
 * code. Steps bind a case's value with the typed reference node
 * `{ from-case: <field> }` — NOT string interpolation. `{{...}}` templating is
 * rejected outright (see assertNoInterpolation) so the only binding is the
 * schema-checkable reference, which resolves away before step-schema validation.
 */
import type { Scenario, Step } from "./steps/types.ts";

/**
 * A single case: a `name` (→ `id[name]`) plus string fields bound via {from-case}.
 * `requirement` is an optional per-case override of the base requirement (kept as
 * metadata for traceability — different cases may satisfy different requirements);
 * it is a plain string field like any other, so it may also be {from-case}-bound.
 */
export type CaseRow = { name: string; requirement?: string } & Record<string, string>;

/**
 * A scenario template carrying a `cases:` table, before expansion. `requirement`
 * is optional here: it is the fallback when a case omits its own (every expanded
 * scenario must end up WITH one — enforced in expandCases).
 */
export interface ParameterizedScenario {
  id: string;
  requirement?: string;
  description?: string;
  cases: CaseRow[];
  setup?: Step[];
  steps: Step[];
}

/** True if a parsed scenario declares a `cases:` table (→ expand it). */
export function hasCases(parsed: unknown): parsed is ParameterizedScenario {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { cases?: unknown }).cases)
  );
}

/** A `{ from-case: <field> }` reference node (the ONLY binding form). */
function isFromCase(v: unknown): v is { "from-case": string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length === 1 &&
    typeof (v as Record<string, unknown>)["from-case"] === "string"
  );
}

/** Deep-resolve every {from-case: K} node against a case row. */
function resolveRefs(value: unknown, row: CaseRow, path: string): unknown {
  if (Array.isArray(value)) return value.map((v, i) => resolveRefs(v, row, `${path}[${i}]`));
  if (isFromCase(value)) {
    const key = value["from-case"];
    if (!(key in row)) {
      const fields = Object.keys(row).join(", ");
      throw new Error(
        `{from-case: ${key}} at ${path} references a field absent from case "${row.name}" (available: ${fields}).`,
      );
    }
    return row[key];
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(v, row, `${path}.${k}`);
    return out;
  }
  return value;
}

/**
 * Reject string interpolation in a step template. `{from-case}` is the only
 * allowed binding; a literal `{{...}}` would survive as a plain string (never
 * resolved) and silently produce the wrong value — so fail loudly instead.
 */
export function assertNoInterpolation(value: unknown, path = "steps"): void {
  if (typeof value === "string") {
    if (value.includes("{{") || value.includes("}}")) {
      throw new Error(
        `Interpolation is not allowed in a parameterized scenario (${path}: ${JSON.stringify(value)}). ` +
          `Bind a case value with { from-case: <field> } instead.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoInterpolation(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) assertNoInterpolation(v, `${path}.${k}`);
  }
}

/**
 * Expand a parameterized scenario into one concrete scenario per case. The id
 * becomes `base[name]` (the runtime/junit/listing identity); requirement and
 * description carry over; steps have every {from-case} resolved.
 */
export function expandCases(base: ParameterizedScenario): Scenario[] {
  const seen = new Set<string>();
  return base.cases.map((row) => {
    if (seen.has(row.name)) {
      throw new Error(`Duplicate case name "${row.name}" in parameterized scenario "${base.id}".`);
    }
    seen.add(row.name);
    // Per-case requirement overrides the base; one of them must be present so the
    // expanded scenario keeps a traceable requirement.
    const requirement = row.requirement ?? base.requirement;
    if (requirement === undefined) {
      throw new Error(
        `Case "${row.name}" in parameterized scenario "${base.id}" has no requirement, ` +
          `and the scenario declares no base requirement.`,
      );
    }
    const steps = resolveRefs(base.steps, row, "steps") as Step[];
    const scenario: Scenario = {
      id: `${base.id}[${row.name}]`,
      requirement,
      steps,
    };
    if (base.setup !== undefined) scenario.setup = resolveRefs(base.setup, row, "setup") as Step[];
    if (base.description !== undefined) scenario.description = base.description;
    return scenario;
  });
}
