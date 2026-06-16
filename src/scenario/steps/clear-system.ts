/**
 * Step: clear a source/target system — empty it of its objects while keeping the
 * container itself. A precondition primitive for the "own your data" discipline:
 * start a scenario from a known-empty system (e.g. before an `all`-set assertion on
 * a target that accumulates across scenarios).
 *
 * Protocol-dispatched (via actions/source.ts), so the meaning is uniform —
 * "remove the contents, keep the vessel":
 *   csv  → rewrite the file empty (header only)
 *   ldap → delete the account entries one level under the container (the container
 *          OU and any sub-OUs/groups are left alone)
 *   scim → delete every resource of the configured resourceType
 * Clears only what idweave OWNS directly; to undo midPoint-managed state (a
 * provisioned account and its group membership), deprovision the focus instead
 * (`clear-focus`), which removes both sides consistently.
 */
import { resetSource } from "../../actions/source.ts";
import { suiteSystem } from "../suite.ts";
import type { DescribeContext, RunContext, StepHandler } from "./types.ts";

interface ClearSystemStep {
  "clear-system": string;
}

export const clearSystemStep: StepHandler<ClearSystemStep> = {
  kind: "clear-system",
  phase: "reset",
  appliesTo: ["csv", "ldap", "scim"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["clear-system"],
    description: "Empty a source system (csv rows / ldap entries under the container / scim resources), keeping the container.",
    properties: {
      "clear-system": { type: "string", description: "System name (csv | ldap | scim) to clear." },
    },
  },

  match(step): step is ClearSystemStep {
    return typeof step === "object" && step !== null && "clear-system" in step;
  },

  async run(step, ctx: RunContext) {
    const { system } = suiteSystem(ctx.suite, step["clear-system"]);
    if (!(system.csv || system.ldap || system.scim)) {
      throw new Error(`clear-system: "${step["clear-system"]}" is not a clearable source (csv | ldap | scim)`);
    }
    await resetSource(ctx.hostDir, system);
  },

  token() {
    return "clear-system";
  },

  detail(step, _ctx: DescribeContext) {
    return `**clear-system** \`${step["clear-system"]}\``;
  },
};
