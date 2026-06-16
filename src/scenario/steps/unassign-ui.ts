/**
 * Step: an OPERATOR removes a target's assignment from a user through the edit-user
 * GUI — the admin-driven Assignments flow (find user → open → Assignments → mark the
 * existing assignment → Unassign → save), the GUI counterpart of the REST `unassign`.
 * Use it when the SCREEN flow is what's under test; the induced end-state (the
 * assignment gone, the account deprovisioned) is still asserted over REST (`expect`).
 *
 * The target kind is the externally-tagged key (exactly one of `role`/`org`/
 * `service`), since the GUI panel is type-specific. Single target per step (the
 * symmetric shape of `assign-ui`).
 */
import { guiPassword } from "../suite.ts";
import { unassignViaUi } from "../../actions/ui.ts";
import type { AssignTargetKind } from "../../clients/ui/contract.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface UnassignUiStep {
  "unassign-ui": {
    /** Operator/admin login that performs the unassignment (GUI password from env). */
    as: string;
    /** User to remove the assignment from (by name). */
    user: string;
    /** Exactly one target — a role, org, or service, by name. */
    role?: string;
    org?: string;
    service?: string;
  };
}

/** The (kind, name) of the single target named by the step's externally-tagged key. */
function target(step: UnassignUiStep["unassign-ui"]): { kind: AssignTargetKind; name: string } {
  if (step.role !== undefined) return { kind: "role", name: step.role };
  if (step.org !== undefined) return { kind: "org", name: step.org };
  return { kind: "service", name: step.service! };
}

export const unassignUiStep: StepHandler<UnassignUiStep> = {
  kind: "unassign-ui",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["unassign-ui"],
    description: "Operator removes a role/org/service assignment from a user via the edit-user GUI.",
    properties: {
      "unassign-ui": {
        type: "object",
        additionalProperties: false,
        required: ["as", "user"],
        description: "Exactly one of role/org/service names the target to unassign.",
        oneOf: [{ required: ["role"] }, { required: ["org"] }, { required: ["service"] }],
        properties: {
          as: { type: "string", description: "Operator/admin login performing the unassignment." },
          user: { type: "string", description: "User to remove the assignment from (by name)." },
          role: { type: "string", description: "Role to unassign (by name)." },
          org: { type: "string", description: "Org to unassign (by name)." },
          service: { type: "string", description: "Service to unassign (by name)." },
        },
      },
    },
  },

  match(step): step is UnassignUiStep {
    return typeof step === "object" && step !== null && "unassign-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["unassign-ui"];
    const pw = guiPassword(ctx.suite, s.as, ctx.cfg.gui.password);
    const { kind, name } = target(s);
    await unassignViaUi(ctx.ui, s.as, pw, s.user, kind, name);
  },

  token() {
    return "unassign-ui";
  },

  detail(step) {
    const { kind, name } = target(step["unassign-ui"]);
    return `**unassign-ui** ${kind} \`${name}\` from \`${step["unassign-ui"].user}\` (as \`${step["unassign-ui"].as}\`)`;
  },
};
