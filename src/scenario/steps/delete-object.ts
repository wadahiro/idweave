/**
 * Step: delete a midPoint object — FAITHFUL to midPoint's own delete (`DELETE /{type}/{oid}`),
 * with `raw` matching `?options=raw`. Use this to drive/observe midPoint's real delete
 * behaviour (e.g. a leaver via the model). For a setup TEARDOWN that also tidies the
 * shadows and (by default) deprovisions the external accounts, use `clear-focus`.
 *
 * - `raw: false` (default) — a NORMAL model delete: the projector deprovisions the linked
 *   accounts (the real directory/SCIM entries). The clockwork runs, so a deletion-approval
 *   policy could open a workflow.
 * - `raw: true` — a REPOSITORY-only delete of just the object: no projector, no deprovision,
 *   no workflow. Like midPoint's raw delete, it leaves the linked SHADOWS orphaned — so
 *   it's not a clean teardown (that's `clear-focus`).
 */
import { deleteObjectByName } from "../../actions/cleanup.ts";
import { resolveMidpoint } from "./resourceMidpoint.ts";
import type { ObjectType, RunContext, StepHandler } from "./types.ts";

interface DeleteObjectStep {
  "delete-object": {
    /** Object type (default user). */
    type?: ObjectType;
    /** Object name to delete if present. */
    name: string;
    /** Repository-only delete (`?options=raw`): no projector/deprovision/workflow. Default false (model delete). */
    raw?: boolean;
    /** midPoint instance to delete from (required only when several are declared; or use the `<system>/` key prefix). */
    midpoint?: string;
  };
}

export const deleteObjectStep: StepHandler<DeleteObjectStep> = {
  kind: "delete-object",
  phase: "reset",
  appliesTo: ["midpoint"],
  prefix: { param: "midpoint", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["delete-object"],
    description: "Precondition: delete a midPoint object (and its shadows) if it exists (idempotent).",
    properties: {
      "delete-object": {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          type: { type: "string", enum: ["user", "role", "org", "service"], description: "Object type (default user)." },
          name: { type: "string", description: "Object name to delete if present." },
          raw: { type: "boolean", description: "Repository-only delete (no deprovision/workflow). Default false = model delete (deprovisions linked accounts)." },
          midpoint: { type: "string", description: "midPoint instance (only needed with several declared; or the `<system>/` key prefix)." },
        },
      },
    },
  },

  match(step): step is DeleteObjectStep {
    return typeof step === "object" && step !== null && "delete-object" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["delete-object"];
    const { rest } = resolveMidpoint(ctx.suite, ctx.cfg, s.midpoint, "delete-object");
    await deleteObjectByName(rest, s.type ?? "user", s.name, { raw: s.raw ?? false });
  },

  token() {
    return "delete-object";
  },

  detail(step) {
    return `**delete-object** \`${step["delete-object"].name}\` (if present)`;
  },
};
