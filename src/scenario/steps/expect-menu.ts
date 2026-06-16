/**
 * Step: assert the left-nav MENU shown to a principal in the GUI. The menu varies
 * with the principal's authorizations (computed by the GUI from config + authz),
 * which the REST end-state can't reveal — hence a GUI assertion, as a principal,
 * read-only. Sibling of `expect-requestable`.
 *
 * Menu entries are PATHS rendered "Parent > Child" (a top-level leaf is just its
 * label). Three assertion modes, combinable except exact⊕expected:
 *   • present — these paths MUST be visible (subset)
 *   • absent  — these paths must NOT be visible (subset)
 *   • exact / expected — the WHOLE visible set must equal this set (order-free);
 *     `exact` is inline, `expected` is a captured file (full tree, capturable via
 *     `make capture-expected` and reviewed by intent — current-behaviour capture).
 */
import { join } from "node:path";
import { readMenuViaUi } from "../../actions/ui.ts";
import { loadExpected, ExpectedMismatchError } from "../../verify/expected.ts";
import { guiPassword } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";
import { expectedPath, captureExpectedFile } from "./expectedPath.ts";

interface ExpectMenuStep {
  "expect-menu": {
    as: string;
    present?: string[];
    absent?: string[];
    exact?: string[];
    /** Path to a captured JSON array of menu paths (full-tree exact). */
    expected?: string;
  };
}

/** Render a menu path (root → leaf) as a single comparable string. */
export function formatMenuPath(path: string[]): string {
  return path.join(" > ");
}

/**
 * Pure comparison of an observed menu (path strings) against the assertions.
 * Returns human-readable failure lines (empty ⇒ pass). IO-free — unit-tested
 * without a browser.
 */
export function evaluateMenu(
  observed: string[],
  spec: { present?: string[]; absent?: string[]; exact?: string[] },
): string[] {
  const set = new Set(observed);
  const failures: string[] = [];

  const missing = (spec.present ?? []).filter((p) => !set.has(p));
  if (missing.length) failures.push(`expected visible but ABSENT: ${missing.join(", ")}`);

  const leaked = (spec.absent ?? []).filter((p) => set.has(p));
  if (leaked.length) failures.push(`expected hidden but PRESENT: ${leaked.join(", ")}`);

  if (spec.exact) {
    const want = new Set(spec.exact);
    const onlyExpected = [...want].filter((p) => !set.has(p));
    const onlyObserved = observed.filter((p) => !want.has(p));
    if (onlyExpected.length) failures.push(`exact: expected but MISSING: ${onlyExpected.join(", ")}`);
    if (onlyObserved.length) failures.push(`exact: present but UNEXPECTED: ${onlyObserved.join(", ")}`);
  }
  return failures;
}


/** Read+validate a captured expected file as an array of menu path strings. */
function asMenuPaths(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`expect-menu expected file ${where} must be a JSON array of menu path strings.`);
  }
  return value as string[];
}

export const expectMenuStep: StepHandler<ExpectMenuStep> = {
  kind: "expect-menu",
  phase: "assert",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect-menu"],
    description: "Assert the left-nav menu shown to a principal in the GUI (read-only).",
    properties: {
      "expect-menu": {
        type: "object",
        additionalProperties: false,
        required: ["as"],
        anyOf: [{ required: ["present"] }, { required: ["absent"] }, { required: ["exact"] }, { required: ["expected"] }],
        not: { required: ["exact", "expected"] },
        properties: {
          as: { type: "string", description: "Login of the principal to read the menu as (GUI password from env)." },
          present: {
            type: "array",
            items: { type: "string" },
            description: "Menu paths ('Parent > Child') that MUST be visible.",
          },
          absent: {
            type: "array",
            items: { type: "string" },
            description: "Menu paths that must NOT be visible.",
          },
          exact: {
            type: "array",
            items: { type: "string" },
            description: "The COMPLETE set of visible menu paths (exact, order-free). Mutually exclusive with expected.",
          },
          expected: {
            type: "string",
            description: "Path to a captured JSON array of menu paths (full-tree exact). Mutually exclusive with exact.",
          },
        },
      },
    },
  },

  match(step): step is ExpectMenuStep {
    return typeof step === "object" && step !== null && "expect-menu" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["expect-menu"];
    const observed = (await readMenuViaUi(ctx.ui, s.as, guiPassword(ctx.suite, s.as, ctx.cfg.gui.password))).map(formatMenuPath);

    // Capture mode: populate the expected file (current-behaviour capture) and skip asserts.
    if (ctx.captureExpected) {
      if (s.expected) await captureExpectedFile(ctx, expectedPath(ctx, s.expected), observed);
      return;
    }

    const exact = s.expected
      ? asMenuPaths(await loadExpected(expectedPath(ctx, s.expected)), s.expected)
      : s.exact;
    const failures = evaluateMenu(observed, { present: s.present, absent: s.absent, exact });
    if (failures.length) {
      const msg = `expect-menu failed as "${s.as}" — ${failures.join("; ")}`;
      // With a full-set assertion, render the git-style expected/actual diff (the
      // same path the `expect` check uses); otherwise list the observed menu.
      if (exact) throw new ExpectedMismatchError(msg, [...exact].sort(), [...observed].sort(), null);
      throw new Error(`${msg}.\nObserved menu: [${observed.join(", ")}]`);
    }
  },

  token() {
    return "expect-menu";
  },

  detail(step) {
    const s = step["expect-menu"];
    const modes = [
      s.present?.length ? `present: \`${s.present.join(", ")}\`` : "",
      s.absent?.length ? `absent: \`${s.absent.join(", ")}\`` : "",
      s.exact ? "exact (inline)" : "",
      s.expected ? `exact (\`${s.expected}\`)` : "",
    ].filter(Boolean);
    return `**expect-menu** as \`${s.as}\`${modes.length ? ` — ${modes.join("; ")}` : ""}`;
  },
};
