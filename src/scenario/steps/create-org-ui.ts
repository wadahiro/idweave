/**
 * Step: create a midPoint org (project-root / project) through the GUI, AS an operator —
 * the way operators actually stand them up (the standard org-tree "Create child"
 * form, which REST can't exercise faithfully). Sibling of the REST `create-org`.
 *
 * `parent` is the parent org's name as shown in the org tree; the child opens under
 * it (parent pre-set). `attributes` are the new-org form fields keyed by their
 * VISIBLE label — e.g. `Name` and the subtype field (its deployment displayName,
 * `組織タイプ`), whose value is the lookup option label the operator selects. An
 * INPUT step: the auto-generated end-state (metarole, child roles) is asserted by a
 * following REST `expect` (UI drives input, the check asserts the end-state).
 */
import { createOrgViaUi } from "../../actions/ui.ts";
import { guiPassword } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface CreateOrgUiStep {
  "create-org-ui": {
    /** Principal to log in as (the operator). */
    as: string;
    /** Parent org NAME as shown in the org tree; the child is created under it. */
    parent: string;
    /** New-org form fields keyed by visible label (e.g. Name, the subtype label). */
    attributes: Record<string, string>;
  };
}

export const createOrgUiStep: StepHandler<CreateOrgUiStep> = {
  kind: "create-org-ui",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["create-org-ui"],
    description: "Create an org (project-root/project) via the GUI, as an operator, under a parent tree node.",
    properties: {
      "create-org-ui": {
        type: "object",
        additionalProperties: false,
        required: ["as", "parent", "attributes"],
        properties: {
          as: { type: "string", description: "Principal to log in as (the operator)." },
          parent: { type: "string", description: "Parent org name as shown in the org tree." },
          attributes: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "New-org form fields keyed by visible label (e.g. Name, the subtype label).",
          },
        },
      },
    },
  },

  match(step): step is CreateOrgUiStep {
    return typeof step === "object" && step !== null && "create-org-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["create-org-ui"];
    await createOrgViaUi(
      ctx.ui,
      s.as,
      guiPassword(ctx.suite, s.as, ctx.cfg.gui.password),
      s.parent,
      s.attributes,
    );
  },

  token() {
    return "create-org-ui";
  },

  detail(step) {
    const s = step["create-org-ui"];
    return `**create-org-ui** \`${s.attributes.Name ?? "?"}\` under \`${s.parent}\` as \`${s.as}\``;
  },
};
