/**
 * Step: create a midPoint org (project-root / project) with a deployment-recognized
 * `subtype`, optionally under `parent` (by name). The running system's Org object template
 * then auto-assigns the `{subtype}-metarole`, which for a project org spawns the
 * child roles under it. The effect (metarole assignment, generated roles) is
 * asserted by the downstream `expect` steps.
 *
 * It is an ACTION: runs in capture mode too, so downstream `expect` captures the
 * generated end-state. Pair with `delete-org` at the top of the scenario for a
 * re-runnable reset (the created subtree cascades, see delete-org).
 */
import { createOrg } from "../../actions/org.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface CreateOrgStep {
  "create-org": {
    /** Org name (the template may decorate it, e.g. project-root `-project-root` suffix). */
    name: string;
    /** Deployment org subtype, e.g. `example-project-root-org` / `example-project-org`. */
    subtype: string;
    /** Parent org NAME to attach under (resolved to an assignment). */
    parent?: string;
  };
}

export const createOrgStep: StepHandler<CreateOrgStep> = {
  kind: "create-org",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["create-org"],
    description: "Create a midPoint org (project-root/project) with a subtype, optionally under a parent org (by name).",
    properties: {
      "create-org": {
        type: "object",
        additionalProperties: false,
        required: ["name", "subtype"],
        properties: {
          name: { type: "string", description: "Org name." },
          subtype: { type: "string", description: "Deployment org subtype (e.g. example-project-root-org / example-project-org)." },
          parent: { type: "string", description: "Parent org name to attach under (becomes an assignment)." },
        },
      },
    },
  },

  match(step): step is CreateOrgStep {
    return typeof step === "object" && step !== null && "create-org" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["create-org"];
    await createOrg(ctx.rest, s.name, s.subtype, s.parent);
  },

  token() {
    return "create-org";
  },

  detail(step) {
    const s = step["create-org"];
    return `**create-org** \`${s.name}\` (${s.subtype})${s.parent ? ` under \`${s.parent}\`` : ""}`;
  },
};
