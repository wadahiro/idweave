/**
 * Unit: the step vocabulary is derived from the registry (no drift). Covers both
 * step shapes — a nested step's fields come from its inner object, a flat step's
 * from the branch — plus the prefix mark and required-field detection.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  describeSteps, renderSteps, renderStepsMarkdown, renderStepsEmbed,
  STEPS_MARKER_START, STEPS_MARKER_END,
} from "./describeSteps.ts";
import { STEP_HANDLERS } from "../scenario/steps/registry.ts";

describe("describeSteps", () => {
  const docs = describeSteps();
  const byKind = new Map(docs.map((d) => [d.kind, d]));

  it("describes every registered handler, with a summary and a phase from its schema/metadata", () => {
    expect(docs.length).toBe(STEP_HANDLERS.length);
    for (const d of docs) {
      expect(d.summary, `${d.kind} has a summary`).toBeTruthy();
      expect(["arrange", "act", "assert", "reset"], `${d.kind} has a valid phase`).toContain(d.phase);
    }
  });

  it("carries the declared phase and applicable systems", () => {
    expect(byKind.get("mutate")!.phase).toBe("arrange");
    expect(byKind.get("trigger")!.phase).toBe("act");
    expect(byKind.get("expect")!.phase).toBe("assert");
    expect(byKind.get("clear-shadow")!.phase).toBe("reset");
    expect(byKind.get("mutate")!.appliesTo).toEqual(["csv", "ldap", "scim", "keycloak"]);
    expect(byKind.get("clear-mail")!.appliesTo).toEqual([]); // names no suite system
  });

  it("takes a nested step's fields from its inner object (clear-shadow)", () => {
    const d = byKind.get("clear-shadow")!;
    expect(d.fields.map((f) => f.name)).toEqual(["system", "identifier"]);
    expect(d.fields.find((f) => f.name === "identifier")!.required).toBe(true);
    expect(d.fields.find((f) => f.name === "system")!.required).toBe(false);
  });

  it("takes a flat step's fields from the branch (mutate verbs + system)", () => {
    const d = byKind.get("mutate")!;
    expect(d.fields.map((f) => f.name)).toEqual(["system", "set", "add", "replace", "remove"]);
  });

  it("marks prefixable kinds and not the others", () => {
    expect(byKind.get("mutate")!.prefixable).toBe(true);
    expect(byKind.get("clear-shadow")!.prefixable).toBe(true);
    expect(byKind.get("clear-system")!.prefixable).toBe(false);
  });

  it("renders grouped text with required fields, prefix mark, and systems", () => {
    const out = renderSteps(docs);
    expect(out).toContain("identifier*");
    expect(out).toContain("clear-shadow ✦");
    expect(out).toContain("ARRANGE");
    expect(out).toContain("RESET");
    expect(out).toMatch(/csv · ldap · scim · keycloak/);
  });

  it("renders a Markdown table grouped by phase", () => {
    const md = renderStepsMarkdown(docs);
    expect(md).toContain("## ARRANGE");
    expect(md).toContain("| Step | Systems | Fields | What it does |");
    expect(md).toContain("`clear-shadow` ✦");
  });

  it("README's embedded step reference is up to date (run `idw steps embed` if this fails)", () => {
    const readme = readFileSync("README.md", "utf8");
    const start = readme.indexOf(STEPS_MARKER_START);
    const end = readme.indexOf(STEPS_MARKER_END);
    expect(start, "README has the step-reference markers").toBeGreaterThanOrEqual(0);
    const embedded = readme.slice(start, end + STEPS_MARKER_END.length);
    expect(embedded).toBe(renderStepsEmbed(docs));
  });
});
