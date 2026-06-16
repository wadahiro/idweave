/**
 * Step: assert which self-service PROFILE fields a principal may EDIT in the GUI.
 * The editable set varies with the principal's subtype/authorizations (the GUI
 * derives it from config), which the REST end-state can't reveal — hence a GUI
 * assertion, as a principal, read-only. Sibling of `expect-menu`.
 *
 * The test cases read "profile change is possible for ONLY these fields", so the
 * primary mode is the EXACT editable set:
 *   • editable — the COMPLETE set of editable field labels (order-free). `[]` asserts
 *     NOTHING is editable (e.g. a view-only subtype).
 *   • expected — a captured JSON array of every field `{label, editable}` (full map,
 *     capturable via `make capture-expected`, reviewed by intent — current-behaviour capture).
 * Exactly one of the two.
 */
import { join } from "node:path";
import { readProfileFieldsViaUi } from "../../actions/ui.ts";
import { loadExpected, assertMatchesExpected, ExpectedMismatchError } from "../../verify/expected.ts";
import { guiPassword } from "../suite.ts";
import type { ProfileField } from "../../clients/ui/contract.ts";
import type { RunContext, StepHandler } from "./types.ts";
import { expectedPath, captureExpectedFile } from "./expectedPath.ts";

interface ExpectFieldsStep {
  "expect-fields": {
    as: string;
    /** The COMPLETE set of editable field labels (order-free). `[]` = none editable. */
    editable?: string[];
    /** Path to a captured JSON array of every field `{label, editable}`. */
    expected?: string;
  };
}

/**
 * Pure comparison of the observed profile fields against the EXACT editable set.
 * Returns human-readable failure lines (empty ⇒ pass). IO-free — unit-tested
 * without a browser.
 */
export function evaluateFields(observed: ProfileField[], editable: string[]): string[] {
  const want = new Set(editable);
  const got = observed.filter((f) => f.editable).map((f) => f.label);
  const gotSet = new Set(got);
  const failures: string[] = [];
  const missing = [...want].filter((l) => !gotSet.has(l));
  if (missing.length) failures.push(`expected editable but NOT: ${missing.join(", ")}`);
  const unexpected = got.filter((l) => !want.has(l));
  if (unexpected.length) failures.push(`editable but UNEXPECTED: ${unexpected.join(", ")}`);
  return failures;
}


export const expectFieldsStep: StepHandler<ExpectFieldsStep> = {
  kind: "expect-fields",
  phase: "assert",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect-fields"],
    description: "Assert which self-service profile fields a principal may edit in the GUI (read-only).",
    properties: {
      "expect-fields": {
        type: "object",
        additionalProperties: false,
        required: ["as"],
        oneOf: [{ required: ["editable"] }, { required: ["expected"] }],
        properties: {
          as: { type: "string", description: "Login of the principal to read the profile as (GUI password from env)." },
          editable: {
            type: "array",
            items: { type: "string" },
            description: "The COMPLETE set of editable field labels (order-free). `[]` = nothing editable.",
          },
          expected: {
            type: "string",
            description: "Path to a captured JSON array of every field {label, editable} (full map).",
          },
        },
      },
    },
  },

  match(step): step is ExpectFieldsStep {
    return typeof step === "object" && step !== null && "expect-fields" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["expect-fields"];
    const observed = await readProfileFieldsViaUi(ctx.ui, s.as, guiPassword(ctx.suite, s.as, ctx.cfg.gui.password));

    // Capture mode: populate the full-map expected file (current-behaviour capture) and skip asserts.
    if (ctx.captureExpected) {
      if (s.expected) await captureExpectedFile(ctx, expectedPath(ctx, s.expected), observed);
      return;
    }

    if (s.expected) {
      const expected = await loadExpected(expectedPath(ctx, s.expected));
      await assertMatchesExpected(observed, expected, () => Promise.resolve(null));
      return;
    }

    const failures = evaluateFields(observed, s.editable!);
    if (failures.length) {
      const wantEditable = [...s.editable!].sort();
      const gotEditable = observed.filter((f) => f.editable).map((f) => f.label).sort();
      throw new ExpectedMismatchError(
        `expect-fields failed as "${s.as}" — ${failures.join("; ")}`,
        wantEditable,
        gotEditable,
        null,
      );
    }
  },

  token() {
    return "expect-fields";
  },

  detail(step) {
    const s = step["expect-fields"];
    const mode = s.expected ? `expected (\`${s.expected}\`)` : `editable: \`[${(s.editable ?? []).join(", ")}]\``;
    return `**expect-fields** as \`${s.as}\` — ${mode}`;
  },
};
