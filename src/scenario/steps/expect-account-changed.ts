/**
 * Step: assert an LDAP account attribute has CHANGED from a value captured earlier
 * (by `capture-account`) — POLLING until it differs, so it deterministically waits
 * out asynchronous propagation instead of a guessed sleep. The motivating case is a
 * self-service password change: capture `userPassword` before, then assert it
 * changed after the GUI change (the {SSHA} hash is salted, so any set differs),
 * confirming midPoint actually wrote the new credential to the directory before a
 * following login check relies on it.
 */
import { readLdapAccountAttr } from "../../actions/ldapAttr.ts";
import { pollUntil, PollTimeoutError } from "../../poll.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ExpectAccountChangedStep {
  "expect-account-changed": {
    /** Name of the LDAP system (in suite.systems) holding the account. */
    system: string;
    /** Account identifier (the RDN value, e.g. the uid). */
    identifier: string;
    /** Attribute to check (e.g. `userPassword`). */
    attr: string;
    /** Capture slot (from a prior `capture-account`) holding the pre-change value(s). */
    from: string;
  };
}

const key = (v: string[]): string => JSON.stringify(v);

export const expectAccountChangedStep: StepHandler<ExpectAccountChangedStep> = {
  kind: "expect-account-changed",
  phase: "assert",
  appliesTo: ["ldap"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect-account-changed"],
    description: "Assert (poll until) an LDAP account attribute differs from a value captured earlier by capture-account.",
    properties: {
      "expect-account-changed": {
        type: "object",
        additionalProperties: false,
        required: ["system", "identifier", "attr", "from"],
        properties: {
          system: { type: "string", description: "LDAP system name (in suite.systems)." },
          identifier: { type: "string", description: "Account identifier (RDN value, e.g. uid)." },
          attr: { type: "string", description: "Attribute to check (e.g. userPassword)." },
          from: { type: "string", description: "capture-account slot holding the pre-change value(s)." },
        },
      },
    },
  },

  match(step): step is ExpectAccountChangedStep {
    return typeof step === "object" && step !== null && "expect-account-changed" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["expect-account-changed"];
    const system = ctx.suite.systems[s.system];
    if (!system?.ldap) throw new Error(`expect-account-changed: system "${s.system}" is not an LDAP system`);
    const baseline = ctx.state.captures?.[s.from];
    if (baseline === undefined) throw new Error(`expect-account-changed: no capture slot "${s.from}" (run capture-account first)`);
    const before = key(baseline);
    const last = await pollUntil(
      () => readLdapAccountAttr(system, s.identifier, s.attr),
      (cur) => cur.length > 0 && key(cur) !== before,
      ctx.cfg.poll,
      `${s.attr} of "${s.identifier}" in "${s.system}" to change from the captured value`,
    ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as string[]) : Promise.reject(e)));
    if (key(last) === before) {
      throw new Error(
        `expect-account-changed: ${s.attr} of "${s.identifier}" in "${s.system}" did NOT change from the captured value (still ${last.length} value(s)).`,
      );
    }
  },

  token() {
    return "expect-account-changed";
  },

  detail(step) {
    const s = step["expect-account-changed"];
    return `**expect-account-changed** ${s.system}/${s.identifier} ${s.attr} ≠ \`${s.from}\``;
  },
};
