/**
 * Step: delete an org and the subtree it spawned — the org, its descendant orgs,
 * and every role parented into that subtree (the auto-generated project-root/project
 * roles), leaf-first via the NORMAL path so provisioned LDAP groups deprovision
 * rather than orphan. No-op if the org is absent, so it doubles as a re-runnable
 * PRECONDITION reset at the top of a create-org scenario. The complement of
 * `create-org`.
 */
import { deleteOrgTree } from "../../actions/org.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface DeleteOrgStep {
  "delete-org": {
    /** Root org name; its whole spawned subtree is torn down. */
    name: string;
  };
}

export const deleteOrgStep: StepHandler<DeleteOrgStep> = {
  kind: "delete-org",
  phase: "reset",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["delete-org"],
    description: "Delete an org and the subtree it spawned (descendant orgs + parented roles); no-op if absent.",
    properties: {
      "delete-org": {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", description: "Root org name; its whole spawned subtree is torn down." },
        },
      },
    },
  },

  match(step): step is DeleteOrgStep {
    return typeof step === "object" && step !== null && "delete-org" in step;
  },

  async run(step, ctx: RunContext) {
    await deleteOrgTree(ctx.rest, step["delete-org"].name);
  },

  token() {
    return "delete-org";
  },

  detail(step) {
    return `**delete-org** \`${step["delete-org"].name}\` (+ spawned subtree)`;
  },
};
