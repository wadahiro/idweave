/** Step: grant a role (or org, with a relation) to a user; runs provisioning. */
import { resolveTargetRef, assignTargetWithRelation, userOidByName } from "../../actions/assign.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface AssignStep {
  assign: {
    user: string;
    /** Target name: a role, or an org (with `relation`). */
    role: string;
    /** Optional assignment relation, e.g. `manager` (make the user an org's manager → approver). */
    relation?: string;
  };
}

export const assignStep: StepHandler<AssignStep> = {
  kind: "assign",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["assign"],
    description: "Grant a role (or org with a relation) to a user.",
    properties: {
      assign: {
        type: "object",
        additionalProperties: false,
        required: ["user", "role"],
        properties: {
          user: { type: "string" },
          role: { type: "string", description: "Target name: a role, or an org (with relation)." },
          relation: {
            type: "string",
            description: "Assignment relation (e.g. manager/owner/approver); omit for a plain member.",
          },
        },
      },
    },
  },

  match(step): step is AssignStep {
    return typeof step === "object" && step !== null && "assign" in step;
  },

  async run(step, ctx: RunContext) {
    const userOid = await userOidByName(ctx.rest, step.assign.user);
    if (!userOid) {
      throw new Error(`Cannot assign "${step.assign.role}": user "${step.assign.user}" not found`);
    }
    const ref = await resolveTargetRef(ctx.rest, step.assign.role);
    await assignTargetWithRelation(ctx.rest, userOid, ref, step.assign.relation);
  },

  token() {
    return "assign";
  },

  detail(step) {
    const rel = step.assign.relation ? ` (${step.assign.relation})` : "";
    return `**assign** \`${step.assign.role}\`${rel} to \`${step.assign.user}\``;
  },
};
