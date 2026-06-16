/**
 * Step: a time-control PRECONDITION that seeds an existing assignment's validity
 * (validFrom/validTo) — the assignment is selected by the role it targets on a
 * user. Pairs with `run-task` to test the validity pipeline WITHOUT moving the
 * clock: raw-seed `validTo` into the past (raw → no recompute, the membership
 * stays live), then run the Validity Scanner (flips effectiveStatus to disabled,
 * dropping the membership) and the "unassign expired roles" task (deletes it).
 *
 * `raw` defaults to true: the whole point is to plant the date without the seed
 * recomputing the effect, so the scanner under test is what acts. Set raw:false to
 * let the model run on the change (immediate recompute), e.g. to disable at once.
 */
import { resolveTimeExpr } from "../../time.ts";
import { resolveRoleOid, setAssignmentValidity, userOidByName } from "../../actions/assign.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface SetAssignmentStep {
  "set-assignment": {
    /** User holding the assignment. */
    user: string;
    /** Role the target assignment points at (targetRef), selecting which assignment. */
    role: string;
    /** New validFrom (relative `now…` or literal ISO dateTime). Optional. */
    validFrom?: string;
    /** New validTo (relative `now…` or literal ISO dateTime). Optional. */
    validTo?: string;
    /** Direct repository write — no recompute (default true). */
    raw?: boolean;
  };
}

export const setAssignmentStep: StepHandler<SetAssignmentStep> = {
  kind: "set-assignment",
  phase: "arrange",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["set-assignment"],
    description: "Precondition: seed an assignment's validity (validFrom/validTo), selected by user + role — for time-control tests.",
    properties: {
      "set-assignment": {
        type: "object",
        additionalProperties: false,
        required: ["user", "role"],
        anyOf: [{ required: ["validFrom"] }, { required: ["validTo"] }],
        properties: {
          user: { type: "string", description: "User holding the assignment." },
          role: { type: "string", description: "Role the assignment targets (selects which assignment)." },
          validFrom: { type: "string", description: "New validFrom; `now`/`now-P31D`/`now+PT1H` or literal ISO dateTime." },
          validTo: { type: "string", description: "New validTo; `now`/`now-P31D`/`now+PT1H` or literal ISO dateTime." },
          raw: { type: "boolean", description: "Direct repository write, no recompute (default true)." },
        },
      },
    },
  },

  match(step): step is SetAssignmentStep {
    return typeof step === "object" && step !== null && "set-assignment" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["set-assignment"];
    const userOid = await userOidByName(ctx.rest, s.user);
    if (!userOid) throw new Error(`set-assignment: user "${s.user}" not found`);
    const roleOid = await resolveRoleOid(ctx.rest, s.role);
    const now = ctx.now();
    const validity: { validFrom?: string; validTo?: string } = {};
    if (s.validFrom !== undefined) validity.validFrom = resolveTimeExpr(s.validFrom, now);
    if (s.validTo !== undefined) validity.validTo = resolveTimeExpr(s.validTo, now);
    await setAssignmentValidity(ctx.rest, userOid, roleOid, validity, { raw: s.raw ?? true });
  },

  token() {
    return "set-assignment";
  },

  detail(step) {
    const s = step["set-assignment"];
    const parts = [
      s.validFrom !== undefined ? `validFrom=${s.validFrom}` : "",
      s.validTo !== undefined ? `validTo=${s.validTo}` : "",
    ].filter(Boolean).join(", ");
    return `**set-assignment** role \`${s.role}\` on \`${s.user}\` — ${parts}${s.raw === false ? "" : " (raw)"}`;
  },
};
