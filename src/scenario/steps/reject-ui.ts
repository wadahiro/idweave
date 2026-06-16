/**
 * Step: REJECT a pending request from the approver's GUI work-item inbox, AS the
 * approver. The negative counterpart to `approve-ui`: the request is denied, so
 * nothing is granted — asserted with `expect` (REST/verify), e.g. the target account
 * is `absent`. Same screen action as approve, with the Reject outcome.
 */
import { decideRequestViaUi, decideBulkViaUi } from "../../actions/ui.ts";
import { guiPassword } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface RejectUiStep {
  "reject-ui": { as: string; request?: string; requests?: string[]; comment?: string };
}

export const rejectUiStep: StepHandler<RejectUiStep> = {
  kind: "reject-ui",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reject-ui"],
    description: "Reject a pending request from the approver's GUI work-item inbox (one item, or many at once).",
    properties: {
      "reject-ui": {
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
            description: "Substrings identifying MANY work items — selected and rejected together in ONE bulk inbox action (no per-item comment).",
          },
          comment: { type: "string", description: "Optional approver comment (single-item decisions only)." },
        },
      },
    },
  },

  match(step): step is RejectUiStep {
    return typeof step === "object" && step !== null && "reject-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const { as, request, requests, comment } = step["reject-ui"];
    const pw = guiPassword(ctx.suite, as, ctx.cfg.gui.password);
    if (requests) await decideBulkViaUi(ctx.ui, as, pw, requests, { outcome: "reject" });
    else await decideRequestViaUi(ctx.ui, as, pw, request!, { outcome: "reject", comment });
  },

  token() {
    return "reject-ui";
  },

  detail(step) {
    const r = step["reject-ui"];
    const what = r.requests ? `[${r.requests.join(", ")}] (bulk)` : `\`${r.request}\``;
    return `**reject-ui** ${what} as \`${r.as}\``;
  },
};
