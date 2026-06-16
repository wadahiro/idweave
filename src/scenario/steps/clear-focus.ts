/**
 * Step: a PRECONDITION that cleans up a FOCUS and its provisioned footprint — the
 * dedicated setup teardown (idempotent, an absent focus is a no-op). Focus-scoped on
 * purpose: a focus is the thing that OWNS projections (linkRef → shadows → accounts).
 *
 * `deprovision` controls whether the external resource accounts are removed too:
 * - `deprovision: true` (default) — also delete the real external accounts, without
 *   triggering an approval workflow: for each linked shadow, connector-delete the
 *   resource object via the provisioning layer (BELOW the model, so no deletion-approval
 *   workflow runs), keyed by the shadow's
 *   primary identifier; then drop the shadow; finally delete the focus. A
 *   protected/read-only SOURCE account is auto-skipped (only its shadow dropped, the
 *   source record left intact). The thorough force-clean for a live directory/SCIM.
 * - `deprovision: false` — DON'T touch the external systems (no connector call). Remove
 *   the focus + its shadows only (repository). For host-managed externals (an all-CSV
 *   suite empties the file host-side via `clear-system`) or to spare a source you
 *   manage yourself.
 *
 * An `indestructible` focus is refused (a guard against force-removing a baseline object
 * matched only by name). See actions/purgeFocus.ts + actions/cleanup.ts.
 */
import { purgeFocus } from "../../actions/purgeFocus.ts";
import { cleanupFocusRepo } from "../../actions/cleanup.ts";
import { resolveMidpoint } from "./resourceMidpoint.ts";
import type { ObjectType, RunContext, StepHandler } from "./types.ts";

interface ClearFocusStep {
  "clear-focus": {
    /** Focus type (default user). */
    type?: ObjectType;
    /** Focus name to clean up if present. */
    name: string;
    /** Also delete the external resource accounts (default true). false = shadows + focus only. */
    deprovision?: boolean;
    /** midPoint instance owning the focus (required only when several are declared). */
    midpoint?: string;
  };
}

export const clearFocusStep: StepHandler<ClearFocusStep> = {
  kind: "clear-focus",
  phase: "reset",
  appliesTo: ["midpoint"],
  prefix: { param: "midpoint", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["clear-focus"],
    description: "Precondition: clean up a focus and (by default) its provisioned external accounts (idempotent).",
    properties: {
      "clear-focus": {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          type: { type: "string", enum: ["user", "role", "org", "service"], description: "Focus type (default user)." },
          name: { type: "string", description: "Focus name to clean up if present." },
          deprovision: { type: "boolean", description: "Also delete the external resource accounts (default true). false = shadows + focus only, external untouched." },
          midpoint: { type: "string", description: "midPoint instance owning the focus (only needed with several declared)." },
        },
      },
    },
  },

  match(step): step is ClearFocusStep {
    return typeof step === "object" && step !== null && "clear-focus" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["clear-focus"];
    const type = s.type ?? "user";
    const { rest, version } = resolveMidpoint(ctx.suite, ctx.cfg, s.midpoint, "clear-focus");
    if (s.deprovision ?? true) {
      await purgeFocus(rest, version, type, s.name);
    } else {
      // No external touch — repository-only removal of the focus + its shadows.
      await cleanupFocusRepo(rest, type, s.name);
    }
  },

  token() {
    return "clear-focus";
  },

  detail(step) {
    const s = step["clear-focus"];
    const ext = (s.deprovision ?? true) ? "+ external accounts" : "repo only";
    return `**clear-focus** \`${s.name}\` (${ext}, if present)`;
  },
};
