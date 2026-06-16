/**
 * Step: FORWARD (転送) a pending request from the approver's GUI work-item inbox to
 * another user, AS the current approver. midPoint's "forward" REPLACES the approver:
 * the forwarder drops off the actors and `to` becomes the new approver, so the item
 * then appears in `to`'s inbox to approve. Used where REST is not faithful (an
 * End-user approver acts only from the screen). The end-state is asserted with
 * `expect` after `to` approves.
 */
import { forwardWorkItemViaUi } from "../../actions/ui.ts";
import { guiPassword } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ForwardUiStep {
  "forward-ui": { as: string; request: string; to: string };
}

export const forwardUiStep: StepHandler<ForwardUiStep> = {
  kind: "forward-ui",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["forward-ui"],
    description: "Forward a pending request to another user from the approver's GUI work-item inbox (as the approver).",
    properties: {
      "forward-ui": {
        type: "object",
        additionalProperties: false,
        required: ["as", "request", "to"],
        properties: {
          as: { type: "string", description: "Login of the current approver (GUI password from env)." },
          request: { type: "string", description: "Substring identifying the work item (e.g. the requested role name)." },
          to: { type: "string", description: "The forward-to user (becomes the new approver)." },
        },
      },
    },
  },

  match(step): step is ForwardUiStep {
    return typeof step === "object" && step !== null && "forward-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const { as, request, to } = step["forward-ui"];
    await forwardWorkItemViaUi(ctx.ui, as, guiPassword(ctx.suite, as, ctx.cfg.gui.password), request, to);
  },

  token() {
    return "forward-ui";
  },

  detail(step) {
    const r = step["forward-ui"];
    return `**forward-ui** \`${r.request}\` from \`${r.as}\` to \`${r.to}\``;
  },
};
