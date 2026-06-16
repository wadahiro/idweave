/**
 * Step: assert which accesses ARE / ARE NOT requestable in the self-service GUI,
 * AS an operator and (optionally) FOR a person of interest. Read-only — it
 * browses the request screen and checks presence/absence without requesting
 * anything. What's requestable depends on the operator's and the POI's
 * authorizations, which the REST end-state can't reveal — hence a GUI assertion.
 */
import { listRequestableViaUi } from "../../actions/ui.ts";
import { guiPassword } from "../suite.ts";
import type { CatalogView } from "../../clients/ui/contract.ts";
import type { RunContext, StepHandler } from "./types.ts";

/** Logical request-screen views — each PO maps to its version's actual tab/nav. */
const VIEW_KEYS = ["role-catalog", "all-roles", "all-organizations", "all-services"] as const;

interface ExpectRequestableStep {
  "expect-requestable": {
    as: string;
    for?: string[];
    view?: CatalogView;
    catalog?: string[];
    present?: string[];
    absent?: string[];
  };
}

export const expectRequestableStep: StepHandler<ExpectRequestableStep> = {
  kind: "expect-requestable",
  phase: "assert",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect-requestable"],
    description: "Assert which accesses ARE / ARE NOT requestable in the self-service request UI (read-only).",
    properties: {
      "expect-requestable": {
        type: "object",
        additionalProperties: false,
        required: ["as"],
        anyOf: [{ required: ["present"] }, { required: ["absent"] }],
        properties: {
          as: { type: "string", description: "Login of the operator (GUI password from env)." },
          for: {
            type: "array",
            items: { type: "string" },
            description: "Persons of interest (logins) to browse for. Omit → the operator themselves.",
          },
          view: { type: "string", enum: VIEW_KEYS, description: "Logical view: 'role-catalog' (default), 'all-roles', 'all-organizations', 'all-services'." },
          catalog: {
            type: "array",
            items: { type: "string" },
            description: "Role-catalog org path to drill through (root → leaf) before reading the list.",
          },
          present: {
            type: "array",
            items: { type: "string" },
            description: "Access display names that MUST be requestable at this position.",
          },
          absent: {
            type: "array",
            items: { type: "string" },
            description: "Access display names that must NOT be requestable at this position.",
          },
        },
      },
    },
  },

  match(step): step is ExpectRequestableStep {
    return typeof step === "object" && step !== null && "expect-requestable" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["expect-requestable"];
    const available = await listRequestableViaUi(ctx.ui, s.as, guiPassword(ctx.suite, s.as, ctx.cfg.gui.password), {
      view: s.view,
      catalog: s.catalog,
      for: s.for,
    });
    const set = new Set(available);
    const missing = (s.present ?? []).filter((n) => !set.has(n));
    const leaked = (s.absent ?? []).filter((n) => set.has(n));
    if (missing.length || leaked.length) {
      const parts: string[] = [];
      if (missing.length) parts.push(`expected requestable but ABSENT: ${missing.join(", ")}`);
      if (leaked.length) parts.push(`expected NOT requestable but PRESENT: ${leaked.join(", ")}`);
      throw new Error(`expect-requestable failed — ${parts.join("; ")}. Available: [${available.join(", ")}]`);
    }
  },

  token() {
    return "expect-requestable";
  },

  detail(step) {
    const s = step["expect-requestable"];
    const p = s.present?.length ? ` present: \`${s.present.join(", ")}\`` : "";
    const a = s.absent?.length ? ` absent: \`${s.absent.join(", ")}\`` : "";
    const forWhom = s.for?.length ? ` for \`${s.for.join(", ")}\`` : "";
    return `**expect-requestable** as \`${s.as}\`${forWhom}${p}${a}`;
  },
};
