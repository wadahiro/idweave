/**
 * Step: a PRECONDITION that raw-deletes orphan/tombstone shadows for an identifier
 * on one system — idempotent, so a journey that re-creates the same entry can be
 * re-run WITHOUT a whole-environment snapshot-restore.
 *
 * Why it exists: clear-focus only clears the shadows in the focus's linkRef. A
 * tombstone left by a prior reconciliation (source entry removed) is UNLINKED and
 * survives — then the next recon finds two shadows with the same secondary identifier
 * and constraint-violates the object. Run this in the reset, after `remove` and before
 * the re-`add`, to clear those leftovers (see actions/purgeShadows.ts). A setup
 * action, not an assert.
 *
 * Resource-agnostic: it matches the shadow's secondary identifier (midPoint's shadow
 * `name`), so any connector-backed system with shadows works (csv/ldap/scim/resource);
 * an LDAP/AD system is scoped by its `containerDn` (the name is a DN), a flat-id system
 * by exact name. midpoint/keycloak/db have no connector shadows, so they're rejected.
 */
import { purgeShadows } from "../../actions/purgeShadows.ts";
import { suiteSystem } from "../suite.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ClearShadowStep {
  "clear-shadow": {
    /** System (in suite.systems) whose shadows to purge; omit when the suite has one. */
    system?: string;
    /** Account identifier (the secondary-identifier value — an LDAP rdn value, a csv/scim id) whose shadows to purge. */
    identifier: string;
  };
}

export const clearShadowStep: StepHandler<ClearShadowStep> = {
  kind: "clear-shadow",
  phase: "reset",
  appliesTo: ["csv", "ldap", "scim", "resource"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["clear-shadow"],
    description: "Precondition: raw-delete orphan/tombstone shadows for an identifier on a connector-backed system (csv/ldap/scim/resource) — idempotent recon reset.",
    properties: {
      "clear-shadow": {
        type: "object",
        additionalProperties: false,
        required: ["identifier"],
        properties: {
          system: { type: "string", description: "System name; omit when the suite has a single system." },
          identifier: { type: "string", description: "Account identifier (rdn value) whose shadows to purge." },
        },
      },
    },
  },

  match(step): step is ClearShadowStep {
    return typeof step === "object" && step !== null && "clear-shadow" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["clear-shadow"];
    const { name, system } = suiteSystem(ctx.suite, s.system);
    if (system.midpoint || system.keycloak || system.db) {
      throw new Error(`clear-shadow: system "${name}" has no connector shadows (use a csv/ldap/scim/resource system)`);
    }
    // Scope to one resource: an LDAP system by its containerDn (the shadow name is a DN
    // suffix-matched); a flat-id system (csv/scim/resource) has no subtree — the name IS
    // the identifier, matched exactly.
    await purgeShadows(ctx.rest, s.identifier, system.ldap?.containerDn);
  },

  token() {
    return "clear-shadow";
  },

  detail(step) {
    const s = step["clear-shadow"];
    return `**clear-shadow** \`${s.identifier}\`${s.system ? ` (${s.system})` : ""}`;
  },
};
