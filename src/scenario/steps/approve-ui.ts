/**
 * Step: approve a pending request from the approver's GUI work-item inbox, AS
 * the approver. Used where REST is not faithful — an approver who is an End user
 * cannot complete a work item over REST, only from the screen. The resulting
 * provisioning is asserted with `expect` (REST/verify).
 */
import { decideRequestViaUi, decideBulkViaUi } from "../../actions/ui.ts";
import { guiPassword } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ApproveUiStep {
  "approve-ui": { as: string; request?: string; requests?: string[]; comment?: string };
}

export const approveUiStep: StepHandler<ApproveUiStep> = {
  kind: "approve-ui",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["approve-ui"],
    description: "Approve a pending request from the approver's GUI work-item inbox (one item, or many at once).",
    properties: {
      "approve-ui": {
        type: "object",
        additionalProperties: false,
        required: ["as"],
        oneOf: [{ required: ["request"] }, { required: ["requests"] }],
        properties: {
          as: { type: "string", description: "Login of the approver (GUI password from env)." },
          request: { type: "string", description: "Substring identifying a single work item (e.g. the requested role name)." },
          requests: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Substrings identifying MANY work items — selected and approved together in ONE bulk inbox action (no per-item comment).",
          },
          comment: { type: "string", description: "Optional approver comment (single-item decisions only)." },
        },
      },
    },
  },

  match(step): step is ApproveUiStep {
    return typeof step === "object" && step !== null && "approve-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const { as, request, requests, comment } = step["approve-ui"];
    const pw = guiPassword(ctx.suite, as, ctx.cfg.gui.password);
    if (requests) await decideBulkViaUi(ctx.ui, as, pw, requests, { outcome: "approve" });
    else await decideRequestViaUi(ctx.ui, as, pw, request!, { outcome: "approve", comment });
  },

  token() {
    return "approve-ui";
  },

  detail(step) {
    const r = step["approve-ui"];
    const what = r.requests ? `[${r.requests.join(", ")}] (bulk)` : `\`${r.request}\``;
    return `**approve-ui** ${what} as \`${r.as}\``;
  },
};
