/**
 * CLI command: list the test cases (scenarios) — as a console table grouped by
 * category folder, or as Markdown for review (coverage-gap checking).
 *
 * An offline inventory of what the suite covers — id, requirement (traceability,
 * by design), the step shape, what each scenario asserts, and its description.
 * No midPoint connection needed; it only reads scenario files.
 *
 * Usage: `scenarios` (table) | `scenarios md` (Markdown to stdout).
 */
import { relative, dirname, resolve } from "node:path";
import { loadConfig } from "../config.ts";
import {
  loadScenarios,
  type Step, type Scenario, type LoadedScenario, type ExpectedObject, type ExpectedAccount,
  type GroupMembership,
} from "../scenario/loader.ts";
import { handlerFor } from "../scenario/steps/registry.ts";
import { loadSuite, type Suite } from "../scenario/suite.ts";

/** Short token for the steps summary (delegated to the step's handler). */
function stepToken(step: Step): string {
  return handlerFor(step)?.token(step) ?? "?";
}
/** One detailed Markdown line (delegated to the step's handler). */
function stepDetail(step: Step, suite: Suite): string {
  return handlerFor(step)?.detail(step, { suite }) ?? "?";
}
/** Assertions a step contributes (only `expect` does), for summaries/flow. */
function stepAssertions(step: Step): { objects?: ExpectedObject[]; accounts?: ExpectedAccount[] } | undefined {
  return handlerFor(step)?.assertions?.(step);
}

function objectLine(o: ExpectedObject): string {
  return `${o.type} \`${o.name}\` — ${o.absent ? "**absent**" : `expected \`${o.expected}\``}`;
}
function accountLine(a: ExpectedAccount): string {
  const who = a.all ? "all" : a.identifier;
  return `account \`${a.system}\` / \`${who}\` — ${a.absent ? "**absent**" : `expected \`${a.expected}\``}`;
}

function stepsSummary(scenario: Scenario): string {
  const tokens = scenario.steps.map(stepToken);
  const main = tokens.length <= 5 ? tokens.join(" → ") : tokens.slice(0, 4).join(" → ") + ` → … (+${tokens.length - 4})`;
  if (!scenario.setup?.length) return main;
  return `setup[${scenario.setup.map(stepToken).join(", ")}] · ${main}`;
}

function assertsSummary(scenario: Scenario): string {
  const parts: string[] = [];
  for (const step of scenario.steps) {
    const a = stepAssertions(step);
    if (!a) continue;
    for (const o of a.objects ?? []) parts.push(`${o.type} ${o.name}${o.absent ? " (absent)" : ""}`);
    for (const acc of a.accounts ?? []) parts.push(`${acc.system}/${acc.all ? "all" : acc.identifier}${acc.absent ? " (absent)" : ""}`);
  }
  return parts.join(", ");
}

interface Item {
  category: string;
  id: string;
  requirement: string;
  steps: string;
  asserts: string;
  description: string;
  scenario: Scenario;
  group?: GroupMembership;
}

function buildItems(scenarios: LoadedScenario[], root: string): Item[] {
  return scenarios.map((l) => {
    const parent = dirname(relative(root, l.dir));
    return {
      category: parent === "." ? "(top-level)" : parent,
      id: l.scenario.id,
      requirement: l.scenario.requirement,
      steps: stepsSummary(l.scenario),
      asserts: assertsSummary(l.scenario),
      description: (l.scenario.description ?? "").trim(),
      scenario: l.scenario,
      group: l.group,
    };
  });
}

/**
 * Annotation for a category that is a group directory, e.g. " [chain]".
 * A group is an ordered, stateful chain (reset: none).
 */
function groupAnnotation(items: Item[]): string {
  const g = items.find((i) => i.group)?.group;
  if (!g) return "";
  return " [chain]";
}

function categoriesOf(items: Item[]): string[] {
  return [...new Set(items.map((i) => i.category))].sort();
}
function summaryLine(items: Item[]): string {
  const c = categoriesOf(items).length;
  return `${items.length} scenario(s) in ${c} categor${c === 1 ? "y" : "ies"}`;
}

// --- console table (grouped by category) -----------------------------------

const HEADERS = ["ID", "REQUIREMENT", "STEPS", "ASSERTS"];
const INDENT = "  ";

function printConsole(items: Item[]): void {
  const cellsOf = (i: Item) => [i.id, i.requirement, i.steps, i.asserts];
  const widths = HEADERS.map((h, idx) =>
    Math.max(h.length, ...items.map((i) => cellsOf(i)[idx]!.length + (idx === 0 ? INDENT.length : 0))),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, idx) => (idx < cells.length - 1 ? c.padEnd(widths[idx]!) : c)).join("  ");

  console.log(fmt(HEADERS));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const category of categoriesOf(items)) {
    const inCategory = items.filter((x) => x.category === category);
    console.log(`${category}/${groupAnnotation(inCategory)}`);
    for (const i of inCategory) {
      console.log(fmt([INDENT + i.id, i.requirement, i.steps, i.asserts]));
    }
  }
  console.log(`\n${summaryLine(items)}`);
}

// --- Markdown (overview table + detail sections) ---------------------------

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function printMarkdown(items: Item[], suite: Suite): void {
  const out: string[] = [];
  out.push("# Test scenarios", "", `_${summaryLine(items)}._`, "");

  out.push("## Overview", "");
  out.push("| Category | ID | Requirement | Steps | Asserts |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const category of categoriesOf(items)) {
    for (const i of items.filter((x) => x.category === category)) {
      out.push(`| \`${mdCell(category)}\` | \`${mdCell(i.id)}\` | ${mdCell(i.requirement)} | ${mdCell(i.steps)} | ${mdCell(i.asserts)} |`);
    }
  }
  out.push("");

  out.push("## Details", "");
  for (const category of categoriesOf(items)) {
    const inCategory = items.filter((x) => x.category === category);
    out.push(`### ${category}${groupAnnotation(inCategory)}`, "");
    for (const i of inCategory) {
      out.push(`#### ${i.id} — ${i.requirement}`, "");
      // description is free text and may embed Markdown — emit it verbatim.
      if (i.description) out.push(i.description, "");
      // Preconditions (the idempotent pre-clean), listed apart from the behaviour.
      if (i.scenario.setup?.length) {
        out.push("**Setup**", "");
        let n = 0;
        for (const step of i.scenario.setup) out.push(`${++n}. ${stepDetail(step, suite)}`);
        out.push("");
      }
      // Given/When/Then-style flow: number the actions, and render each
      // assertion (✓) indented right under the action it follows — so the
      // step↔assert relationship is local and readable, not cross-referenced.
      out.push("**Flow**", "");
      let stepNo = 0;
      for (const step of i.scenario.steps) {
        const a = stepAssertions(step);
        if (a) {
          for (const o of a.objects ?? []) out.push(`   - ✓ ${objectLine(o)}`);
          for (const acc of a.accounts ?? []) out.push(`   - ✓ ${accountLine(acc)}`);
        } else {
          stepNo++;
          out.push(`${stepNo}. ${stepDetail(step, suite)}`);
        }
      }
      out.push("");
    }
  }
  console.log(out.join("\n"));
}

export async function listScenarios(format?: string): Promise<void> {
  const cfg = loadConfig();
  const scenarios = await loadScenarios(cfg.scenariosDir);
  if (scenarios.length === 0) {
    console.log("No scenarios found.");
    return;
  }
  const items = buildItems(scenarios, resolve(process.cwd(), cfg.scenariosDir));
  if (format === "md" || format === "markdown") {
    printMarkdown(items, await loadSuite(cfg.scenariosDir));
  } else {
    printConsole(items);
  }
}
