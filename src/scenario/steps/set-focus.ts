/**
 * Step: a PRECONDITION that reverts a midPoint focus (or shadow) to a known state
 * so a journey is repeatable — REPLACE the named properties and (optionally) clear
 * its password. Two uses:
 *  - revert: e.g. before a self-activation, set lifecycleState back to draft/proposed
 *    and drop the password so the user is "un-activated" again.
 *  - time-seed: plant a PAST date (relative, e.g. `now-P31D`) with `raw: true`, so a
 *    later scanner task (validity scan / cleanup) sees a "threshold already crossed"
 *    state — without moving the server clock. `raw` writes the repository directly,
 *    so the seed itself does NOT recompute the effect; the scanner under test does.
 * A setup mutation, not an assert.
 */
import { resolveTimeExpr } from "../../time.ts";
import { setFocus, type SetFocusType } from "../../actions/focus.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface SetFocusStep {
  "set-focus": {
    /** Target type (default user). `shadow` seeds a directory account by its DN (raw). */
    type?: SetFocusType;
    /** Focus name (or, for `shadow`, the entry DN) to modify. */
    name: string;
    /**
     * Properties to REPLACE (path → value), e.g. { lifecycleState: draft }. A value
     * may be a relative-time expression resolved at run time: `now`, `now-P31D`,
     * `now+PT1H` (ISO-8601 duration). Non-expressions pass through verbatim.
     */
    set: Record<string, string>;
    /**
     * Remove the password so the focus is un-activated again (and a re-run can set
     * the same password). Implemented as a replace-with-empty, not a delete, which
     * REST silently no-ops — see setFocus. (Not for `raw`/shadow seeding.)
     */
    clearPassword?: boolean;
    /**
     * Write the repository DIRECTLY (`?options=raw`): no recompute, no provisioning;
     * operational/protected items (metadata timestamps, a shadow's naming attribute)
     * become writable. Use when planting a past date the scanner-under-test must be
     * the one to act on.
     */
    raw?: boolean;
  };
}

export const setFocusStep: StepHandler<SetFocusStep> = {
  kind: "set-focus",
  phase: "arrange",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["set-focus"],
    description: "Precondition: revert a focus/shadow's properties (and optionally clear its password or seed a raw past date).",
    properties: {
      "set-focus": {
        type: "object",
        additionalProperties: false,
        required: ["name", "set"],
        properties: {
          type: {
            type: "string",
            enum: ["user", "role", "org", "service", "shadow"],
            description: "Target type (default user); shadow seeds a directory account by DN (raw).",
          },
          name: { type: "string", description: "Focus name (or entry DN for shadow) to modify." },
          set: {
            type: "object",
            minProperties: 1,
            additionalProperties: { type: "string" },
            description: "Properties to REPLACE (path → value); a value may be `now`/`now-P31D`/`now+PT1H` (resolved at run time).",
          },
          clearPassword: { type: "boolean", description: "Remove the password (un-activate), so a re-run can set the same value." },
          raw: { type: "boolean", description: "Direct repository write (?options=raw): no recompute/provisioning — for seeding a past date." },
        },
      },
    },
  },

  match(step): step is SetFocusStep {
    return typeof step === "object" && step !== null && "set-focus" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["set-focus"];
    // Resolve any relative-time values (now / now±duration) against the injected clock.
    const resolved = Object.fromEntries(
      Object.entries(s.set).map(([path, value]) => [path, resolveTimeExpr(value, ctx.now())]),
    );
    await setFocus(ctx.rest, s.type ?? "user", s.name, resolved, { clearPassword: s.clearPassword, raw: s.raw });
  },

  token() {
    return "set-focus";
  },

  detail(step) {
    const s = step["set-focus"];
    const props = Object.entries(s.set).map(([k, v]) => `${k}=${v}`).join(", ");
    const flags = [s.clearPassword ? "clear password" : "", s.raw ? "raw" : ""].filter(Boolean).join(", ");
    return `**set-focus** \`${s.name}\` — ${props}${flags ? ` (${flags})` : ""}`;
  },
};
