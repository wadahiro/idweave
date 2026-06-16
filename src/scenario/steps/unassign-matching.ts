/**
 * Step: revoke ALL of a user's direct role assignments whose target role name
 * starts with `rolePrefix` — a re-runnable reset for SHARED users.
 *
 * Why: scenarios that assert a shared user's FULL assignment set (e.g. an approval
 * or role-request flow over a shared requester/approver) break when another scenario
 * leaves that user an extra role grant. Enumerating each leftover role in
 * every reset is whack-a-mole; this clears the whole family (a group of related
 * roles sharing a name prefix) in one step, so the reset is order/history-independent.
 * Only RoleType assignments match, so archetype/org/baseline assignments are kept.
 */
import { unassignMatchingRoles, userOidByName } from "../../actions/assign.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface UnassignMatchingStep {
  "unassign-matching": {
    /** User (focus name) whose matching role assignments are removed. */
    user: string;
    /** Remove every direct assignment to a role whose name STARTS WITH this. */
    rolePrefix: string;
  };
}

export const unassignMatchingStep: StepHandler<UnassignMatchingStep> = {
  kind: "unassign-matching",
  phase: "reset",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["unassign-matching"],
    description: "Reset: revoke every direct role assignment whose role name starts with rolePrefix (re-runnable).",
    properties: {
      "unassign-matching": {
        type: "object",
        additionalProperties: false,
        required: ["user", "rolePrefix"],
        properties: {
          user: { type: "string", description: "User whose matching role assignments are removed." },
          rolePrefix: { type: "string", description: "Role-name prefix; every direct assignment to a matching role is removed." },
        },
      },
    },
  },

  match(step): step is UnassignMatchingStep {
    return typeof step === "object" && step !== null && "unassign-matching" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["unassign-matching"];
    const userOid = await userOidByName(ctx.rest, s.user);
    if (!userOid) return; // a re-runnable reset tolerates an absent user
    await unassignMatchingRoles(ctx.rest, userOid, s.rolePrefix);
  },

  token() {
    return "unassign-matching";
  },

  detail(step) {
    const s = step["unassign-matching"];
    return `**unassign-matching** \`${s.rolePrefix}*\` roles from \`${s.user}\``;
  },
};
