/**
 * Step: an OPERATOR assigns a target to a user through the edit-user GUI — the
 * admin-driven Assignments flow (find user → open → Assignments → New → pick →
 * save), the GUI counterpart of the REST `assign`. Use it when the SCREEN flow is
 * what's under test; the induced end-state is still asserted over REST (`expect`).
 *
 * The target kind is the externally-tagged key (exactly one of `role`/`org`/
 * `service`), since the GUI picker is type-specific. Default relation, single
 * target per step (the minimal shape; relation/bulk are a follow-up).
 */
import { guiPassword } from "../suite.ts";
import { assignViaUi } from "../../actions/ui.ts";
import type { AssignTargetKind } from "../../clients/ui/contract.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface AssignUiStep {
  "assign-ui": {
    /** Operator/admin login that performs the assignment (GUI password from env). */
    as: string;
    /** User to assign to (by name). */
    user: string;
    /** Exactly one target — a role, org, or service, by name. */
    role?: string;
    org?: string;
    service?: string;
  };
}

/** The (kind, name) of the single target named by the step's externally-tagged key. */
function target(step: AssignUiStep["assign-ui"]): { kind: AssignTargetKind; name: string } {
  if (step.role !== undefined) return { kind: "role", name: step.role };
  if (step.org !== undefined) return { kind: "org", name: step.org };
  return { kind: "service", name: step.service! };
}

export const assignUiStep: StepHandler<AssignUiStep> = {
  kind: "assign-ui",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["assign-ui"],
    description: "Operator assigns a role/org/service to a user via the edit-user GUI (Default relation).",
    properties: {
      "assign-ui": {
        type: "object",
        additionalProperties: false,
        required: ["as", "user"],
        description: "Exactly one of role/org/service names the target.",
        oneOf: [{ required: ["role"] }, { required: ["org"] }, { required: ["service"] }],
        properties: {
          as: { type: "string", description: "Operator/admin login performing the assignment." },
          user: { type: "string", description: "User to assign to (by name)." },
          role: { type: "string", description: "Role to assign (by name)." },
          org: { type: "string", description: "Org to assign (by name)." },
          service: { type: "string", description: "Service to assign (by name)." },
        },
      },
    },
  },

  match(step): step is AssignUiStep {
    return typeof step === "object" && step !== null && "assign-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["assign-ui"];
    const pw = guiPassword(ctx.suite, s.as, ctx.cfg.gui.password);
    const { kind, name } = target(s);
    await assignViaUi(ctx.ui, s.as, pw, s.user, kind, name);
  },

  token() {
    return "assign-ui";
  },

  detail(step) {
    const { kind, name } = target(step["assign-ui"]);
    return `**assign-ui** ${kind} \`${name}\` to \`${step["assign-ui"].user}\` (as \`${step["assign-ui"].as}\`)`;
  },
};
