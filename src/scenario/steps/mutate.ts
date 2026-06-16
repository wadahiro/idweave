/**
 * Step: mutate a source — exactly one of set/add/replace/remove (inline rows or
 * a CSV fixture file). Maps the declaration onto the actions source verbs, which
 * dispatch by source kind (csv file vs ldap directory).
 */
import { resolve } from "node:path";
import {
  setSource, addSourceRows, replaceSourceRows, removeSourceRows,
} from "../../actions/source.ts";
import { readCsvRecords } from "../../clients/csvFile.ts";
import { suiteSystem, systemIdAttr } from "../suite.ts";
import type { DescribeContext, RowsOrFile, Row, RunContext, StepHandler } from "./types.ts";

interface MutateStep {
  system?: string;
  set?: RowsOrFile;
  add?: RowsOrFile;
  replace?: RowsOrFile;
  remove?: string[];
}

const OPS = ["set", "add", "replace", "remove"] as const;

/** Resolve a step's rows from inline data or a CSV fixture file. */
async function resolveRows(value: RowsOrFile, scenarioDir: string): Promise<Row[]> {
  if (Array.isArray(value)) return value;
  return readCsvRecords(resolve(scenarioDir, value.file));
}

function systemName(ctx: DescribeContext, key?: string): string {
  if (key) return key;
  const keys = Object.keys(ctx.suite.systems ?? {});
  return keys.length === 1 ? keys[0]! : "(default)";
}

export const mutateStep: StepHandler<MutateStep> = {
  kind: "mutate",
  phase: "arrange",
  appliesTo: ["csv", "ldap", "scim", "keycloak"],
  prefix: { param: "system", into: "sibling" },
  schema: {
    type: "object",
    additionalProperties: false,
    description: "Mutate a source: exactly one of set/add/replace/remove.",
    properties: {
      system: { type: "string", description: "System name; omit when the suite has a single system." },
      set: { $ref: "#/definitions/rowsOrFile", description: "Replace the system's full content." },
      add: { $ref: "#/definitions/rowsOrFile", description: "Insert new rows/entries (by id)." },
      replace: { $ref: "#/definitions/rowsOrFile", description: "Update existing rows/entries (by id)." },
      remove: { type: "array", items: { type: "string" }, description: "Delete rows/entries by id value." },
    },
    oneOf: OPS.map((op) => ({ required: [op] })),
  },

  match(step): step is MutateStep {
    return typeof step === "object" && step !== null
      && OPS.some((op) => op in (step as Record<string, unknown>));
  },

  async run(step, ctx: RunContext) {
    const { system } = suiteSystem(ctx.suite, step.system);
    if (step.set) await setSource(ctx.hostDir, system, await resolveRows(step.set, ctx.scenarioDir));
    else if (step.add) await addSourceRows(ctx.hostDir, system, await resolveRows(step.add, ctx.scenarioDir));
    else if (step.replace) await replaceSourceRows(ctx.hostDir, system, await resolveRows(step.replace, ctx.scenarioDir));
    else if (step.remove) await removeSourceRows(ctx.hostDir, system, step.remove);
  },

  token(step) {
    for (const op of ["set", "add", "replace"] as const) {
      const v = step[op];
      if (v !== undefined) return Array.isArray(v) ? op : `${op}(file)`;
    }
    return step.remove !== undefined ? "remove" : "?";
  },

  detail(step, ctx) {
    const name = systemName(ctx, step.system);
    let idCol: string | undefined;
    try { idCol = systemIdAttr(suiteSystem(ctx.suite, step.system).system); } catch { idCol = undefined; }
    for (const op of ["set", "add", "replace"] as const) {
      const v = step[op];
      if (v === undefined) continue;
      if (!Array.isArray(v)) return `**${op}** \`${name}\` — from \`${v.file}\``;
      const ids = idCol ? v.map((r) => r[idCol!]).filter(Boolean) : [];
      return `**${op}** \`${name}\` — ${v.length} row(s)${ids.length ? `: ${ids.join(", ")}` : ""}`;
    }
    if (step.remove) return `**remove** \`${name}\` — ${step.remove.join(", ")}`;
    return "?";
  },
};
