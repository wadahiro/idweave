/**
 * Derive the step VOCABULARY from the registry — the single source of truth — so
 * `idw steps` (and the generated docs reference) never drifts from the code. Pure
 * (no running stack): it reads each handler's JSON-Schema fragment, taking the branch
 * `description` as the summary and the step's own properties as its fields, across BOTH
 * step shapes (a nested step like `clear-shadow: {…}` whose fields are the inner
 * object's properties, and a flat step like `mutate`/`trigger` whose fields are the
 * branch's top-level properties). Phase + applicable systems come from the handler's
 * declared `phase`/`appliesTo`, so the lifecycle grouping is generated, not hand-kept.
 */
import { STEP_HANDLERS } from "../scenario/steps/registry.ts";
import type { StepPhase, SystemKind } from "../scenario/steps/types.ts";

/** One field a step accepts (a YAML key the author writes under the step). */
export interface StepField {
  name: string;
  required: boolean;
  summary?: string;
}

/** A step kind described for listing — all derived from its registered schema/metadata. */
export interface StepDoc {
  kind: string;
  phase: StepPhase;
  summary: string;
  fields: StepField[];
  /** Suite-system kinds the step's `system:` may name (empty when it names none). */
  appliesTo: ReadonlyArray<SystemKind>;
  /** Accepts the `<system>/<kind>` key prefix to target a named system. */
  prefixable: boolean;
}

type Schema = Record<string, unknown>;
const asObj = (v: unknown): Schema | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Schema) : undefined;

/** The schema level whose `properties` are the author-written fields of this kind. */
function fieldLevel(schema: Schema, kind: string): Schema {
  // Nested step (`expect: {…}`, `clear-shadow: {…}`): the single property keyed by the
  // kind is an object whose OWN properties are the fields. Flat step (`mutate`,
  // `trigger`): no such nesting — the branch's top-level properties are the fields.
  const props = asObj(schema.properties);
  const nested = props && asObj(props[kind]);
  return nested && asObj(nested.properties) ? nested : schema;
}

function fieldsOf(schema: Schema, kind: string): StepField[] {
  const level = fieldLevel(schema, kind);
  const props = asObj(level.properties) ?? {};
  const required = new Set(Array.isArray(level.required) ? (level.required as string[]) : []);
  return Object.entries(props).map(([name, p]) => ({
    name,
    required: required.has(name),
    summary: asObj(p)?.description as string | undefined,
  }));
}

/** Every registered step kind, described from its schema + metadata (registry order). */
export function describeSteps(): StepDoc[] {
  return STEP_HANDLERS.map((h) => ({
    kind: h.kind,
    phase: h.phase,
    summary: (h.schema.description as string) ?? "",
    fields: fieldsOf(h.schema, h.kind),
    appliesTo: h.appliesTo ?? [],
    prefixable: !!h.prefix,
  }));
}

/** Lifecycle phases in authoring order, with a heading for the listing. */
const PHASES: ReadonlyArray<[StepPhase, string]> = [
  ["arrange", "ARRANGE — seed the input & state"],
  ["act", "ACT — drive the system under test"],
  ["assert", "ASSERT — check the real end-state"],
  ["reset", "RESET — setup pre-clean / teardown"],
];

const systemsOf = (d: StepDoc): string => (d.appliesTo.length ? d.appliesTo.join(" · ") : "");

const LEGEND = "✦ = accepts a `<system>/<kind>` prefix · * = required field";

/** Markdown table sections, one per non-empty phase; `heading` styles the phase label. */
function phaseSections(docs: StepDoc[], heading: (h: string) => string): string[] {
  const out: string[] = [];
  for (const [phase, label] of PHASES) {
    const group = docs.filter((d) => d.phase === phase).sort((a, b) => a.kind.localeCompare(b.kind));
    if (!group.length) continue;
    out.push("", heading(label), "", "| Step | Systems | Fields | What it does |", "|------|---------|--------|--------------|");
    for (const d of group) {
      const kind = d.prefixable ? `\`${d.kind}\` ✦` : `\`${d.kind}\``;
      const fields = d.fields.map((x) => (x.required ? `${x.name}*` : x.name)).join(", ");
      out.push(`| ${kind} | ${systemsOf(d) || "—"} | ${fields} | ${d.summary} |`);
    }
  }
  return out;
}

/** Render the step vocabulary as aligned plain text, grouped by lifecycle phase. */
export function renderSteps(docs: StepDoc[]): string {
  const lines: string[] = [
    `Steps (${docs.length}) — the kinds a scenario.yaml may use, grouped by their role in`,
    `the flow. A step names the \`system:\` it acts on (or a \`<system>/<kind>\` key prefix`,
    `on a ✦-marked kind).`,
  ];
  for (const [phase, heading] of PHASES) {
    const group = docs.filter((d) => d.phase === phase).sort((a, b) => a.kind.localeCompare(b.kind));
    if (!group.length) continue;
    lines.push("", heading, "");
    for (const d of group) {
      const mark = d.prefixable ? " ✦" : "";
      const sys = systemsOf(d);
      lines.push(`  ${d.kind}${mark}${sys ? `   [${sys}]` : ""}`);
      if (d.summary) lines.push(`    ${d.summary}`);
      if (d.fields.length) {
        lines.push(`    fields: ${d.fields.map((x) => (x.required ? `${x.name}*` : x.name)).join(", ")}`);
      }
    }
  }
  lines.push("", "✦ = accepts a `<system>/<kind>` prefix   * = required field   [..] = systems it can name");
  return lines.join("\n");
}

/** Render the step vocabulary as a Markdown doc, grouped by phase (standalone). */
export function renderStepsMarkdown(docs: StepDoc[]): string {
  return [
    "# Steps",
    "",
    "Generated from the step registry (`idw steps`).",
    ...phaseSections(docs, (h) => `## ${h}`),
    "",
    LEGEND,
  ].join("\n");
}

/** Markers delimiting the generated step reference embedded in a doc (e.g. README). */
export const STEPS_MARKER_START = "<!-- idw:steps:start -->";
export const STEPS_MARKER_END = "<!-- idw:steps:end -->";

/** The embeddable block (collapsed `<details>`, bold phase labels — no headings to clash). */
export function renderStepsEmbed(docs: StepDoc[]): string {
  return [
    STEPS_MARKER_START,
    "<details>",
    "<summary><b>Full step reference</b> — every step kind, grouped by phase</summary>",
    ...phaseSections(docs, (h) => `**${h}**`),
    "",
    LEGEND,
    "</details>",
    STEPS_MARKER_END,
  ].join("\n");
}

/** Refill the marked step-reference block in `file` from the registry (idempotent). */
export async function embedSteps(file = "README.md"): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const src = await readFile(file, "utf8");
  const start = src.indexOf(STEPS_MARKER_START);
  const end = src.indexOf(STEPS_MARKER_END);
  if (start === -1 || end === -1) {
    throw new Error(`${file}: missing ${STEPS_MARKER_START} … ${STEPS_MARKER_END} markers — add them where the reference should live`);
  }
  const next = src.slice(0, start) + renderStepsEmbed(describeSteps()) + src.slice(end + STEPS_MARKER_END.length);
  if (next === src) return void console.log(`${file} step reference already up to date`);
  await writeFile(file, next);
  console.log(`embedded step reference into ${file}`);
}

/** CLI: `idw steps` text · `idw steps md` Markdown · `idw steps embed` refill README. */
export async function listSteps(format?: string): Promise<void> {
  if (format === "embed") return embedSteps();
  const docs = describeSteps();
  console.log(format === "md" ? renderStepsMarkdown(docs) : renderSteps(docs));
}
