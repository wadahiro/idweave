/**
 * Step: CAPTURE an LDAP account attribute's current value(s) into a named state
 * slot, for a later `expect-account-changed` to compare against. The motivating
 * case is a credential change: capture `userPassword` (a salted {SSHA} hash that
 * differs on every set) BEFORE a GUI password change, so the assert afterwards can
 * deterministically wait until it actually changed — no guessed sleep.
 */
import { readLdapAccountAttr } from "../../actions/ldapAttr.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface CaptureAccountStep {
  "capture-account": {
    /** Name of the LDAP system (in suite.systems) holding the account. */
    system: string;
    /** Account identifier (the RDN value, e.g. the uid). */
    identifier: string;
    /** Attribute to capture (e.g. `userPassword`). */
    attr: string;
    /** State slot name to store the value(s) under. */
    as: string;
  };
}

export const captureAccountStep: StepHandler<CaptureAccountStep> = {
  kind: "capture-account",
  phase: "arrange",
  appliesTo: ["ldap"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["capture-account"],
    description: "Capture an LDAP account attribute's value(s) into a named slot, for a later expect-account-changed.",
    properties: {
      "capture-account": {
        type: "object",
        additionalProperties: false,
        required: ["system", "identifier", "attr", "as"],
        properties: {
          system: { type: "string", description: "LDAP system name (in suite.systems)." },
          identifier: { type: "string", description: "Account identifier (RDN value, e.g. uid)." },
          attr: { type: "string", description: "Attribute to capture (e.g. userPassword)." },
          as: { type: "string", description: "State slot name to store the value(s) under." },
        },
      },
    },
  },

  match(step): step is CaptureAccountStep {
    return typeof step === "object" && step !== null && "capture-account" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["capture-account"];
    const system = ctx.suite.systems[s.system];
    if (!system?.ldap) throw new Error(`capture-account: system "${s.system}" is not an LDAP system`);
    const values = await readLdapAccountAttr(system, s.identifier, s.attr);
    (ctx.state.captures ??= {})[s.as] = values;
  },

  token() {
    return "capture-account";
  },

  detail(step) {
    const s = step["capture-account"];
    return `**capture-account** ${s.system}/${s.identifier} ${s.attr} → \`${s.as}\``;
  },
};
