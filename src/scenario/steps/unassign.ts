/** Step: revoke a role from a user (deletes the assignment; runs deprovisioning). */
import { resolveRoleOid, unassignRole, userOidByName } from "../../actions/assign.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface UnassignStep {
  unassign: {
    user: string;
    role: string;
    /** No-op if the user doesn't currently hold the role — for a re-runnable reset. */
    ifAssigned?: boolean;
  };
}

export const unassignStep: StepHandler<UnassignStep> = {
  kind: "unassign",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["unassign"],
    description: "Revoke a role from a user (deletes the assignment; runs deprovisioning).",
    properties: {
      unassign: {
        type: "object",
        additionalProperties: false,
        required: ["user", "role"],
        properties: {
          user: { type: "string" },
          role: { type: "string" },
          ifAssigned: { type: "boolean", description: "No-op if the user doesn't hold the role (re-runnable reset)." },
        },
      },
    },
  },

  match(step): step is UnassignStep {
    return typeof step === "object" && step !== null && "unassign" in step;
  },

  async run(step, ctx: RunContext) {
    const userOid = await userOidByName(ctx.rest, step.unassign.user);
    if (!userOid) {
      throw new Error(`Cannot unassign role "${step.unassign.role}": user "${step.unassign.user}" not found`);
    }
    try {
      await unassignRole(ctx.rest, userOid, await resolveRoleOid(ctx.rest, step.unassign.role));
    } catch (e) {
      // `ifAssigned`: a re-runnable reset tolerates the user not currently holding the role.
      if (step.unassign.ifAssigned && /No assignment of role/.test(String(e))) return;
      throw e;
    }
  },

  token() {
    return "unassign";
  },

  detail(step) {
    return `**unassign** role \`${step.unassign.role}\` from \`${step.unassign.user}\``;
  },
};
