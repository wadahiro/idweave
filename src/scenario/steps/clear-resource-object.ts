/**
 * Step: ARRANGE — clear attribute value(s) on a target object through midPoint's
 * connector (a modify replacing the attribute with empty, NO shadow). Addressed by
 * `identifier`.
 */
import { setResourceObjectAttrs } from "../../actions/resourceObject.ts";
import { suiteSystem } from "../suite.ts";
import { resolveResourceMidpoint } from "./resourceMidpoint.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ClearResourceObjectStep {
  "clear-resource-object": {
    system: string;
    identifier: string;
    clear: string[];
  };
}

export const clearResourceObjectStep: StepHandler<ClearResourceObjectStep> = {
  kind: "clear-resource-object",
  phase: "reset",
  appliesTo: ["resource"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["clear-resource-object"],
    description: "Clear attribute value(s) on a target object through midPoint's connector (no shadow).",
    properties: {
      "clear-resource-object": {
        type: "object",
        additionalProperties: false,
        required: ["system", "identifier", "clear"],
        properties: {
          system: { type: "string", description: "Resource system name." },
          identifier: { type: "string", description: "Value of the system's identifierAttr on the target object." },
          clear: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Attribute names to clear (empty out) on the target object.",
          },
        },
      },
    },
  },

  match(step): step is ClearResourceObjectStep {
    return typeof step === "object" && step !== null && "clear-resource-object" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["clear-resource-object"];
    const { system } = suiteSystem(ctx.suite, s.system);
    if (!system.resource) throw new Error(`clear-resource-object: system "${s.system}" is not a resource system`);
    const { rest, version } = resolveResourceMidpoint(ctx.suite, system.resource, ctx.cfg);
    const replaces = Object.fromEntries(s.clear.map((attr) => [attr, [] as string[]]));
    await setResourceObjectAttrs(rest, version, system.resource, s.identifier, replaces);
  },

  token() {
    return "clear-resource-object";
  },

  detail(step) {
    const s = step["clear-resource-object"];
    return `**clear-resource-object** \`${s.identifier}\` @ \`${s.system}\` — [${s.clear.join(", ")}]`;
  },
};
