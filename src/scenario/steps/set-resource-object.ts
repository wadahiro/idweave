/**
 * Step: ARRANGE — set/replace attribute values on a target object through midPoint's
 * connector (executeScript → ResourceObjectConverter.modifyResourceObject, NO shadow).
 * Addressed by `identifier` (the value of the system's identifierAttr).
 */
import { setResourceObjectAttrs } from "../../actions/resourceObject.ts";
import { suiteSystem } from "../suite.ts";
import { resolveResourceMidpoint } from "./resourceMidpoint.ts";
import type { RunContext, StepHandler } from "./types.ts";

const toArr = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);

interface SetResourceObjectStep {
  "set-resource-object": {
    system: string;
    identifier: string;
    set: Record<string, string | string[]>;
  };
}

export const setResourceObjectStep: StepHandler<SetResourceObjectStep> = {
  kind: "set-resource-object",
  phase: "arrange",
  appliesTo: ["resource"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["set-resource-object"],
    description: "Set/replace attributes on a target object through midPoint's connector (no shadow).",
    properties: {
      "set-resource-object": {
        type: "object",
        additionalProperties: false,
        required: ["system", "identifier", "set"],
        properties: {
          system: { type: "string", description: "Resource system name." },
          identifier: { type: "string", description: "Value of the system's identifierAttr on the target object." },
          set: {
            type: "object",
            minProperties: 1,
            additionalProperties: { type: ["string", "array"], items: { type: "string" } },
            description: "Attribute → value (string) or values (array) to replace on the target object.",
          },
        },
      },
    },
  },

  match(step): step is SetResourceObjectStep {
    return typeof step === "object" && step !== null && "set-resource-object" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["set-resource-object"];
    const { system } = suiteSystem(ctx.suite, s.system);
    if (!system.resource) throw new Error(`set-resource-object: system "${s.system}" is not a resource system`);
    const { rest, version } = resolveResourceMidpoint(ctx.suite, system.resource, ctx.cfg);
    const replaces = Object.fromEntries(Object.entries(s.set).map(([k, v]) => [k, toArr(v)]));
    await setResourceObjectAttrs(rest, version, system.resource, s.identifier, replaces);
  },

  token() {
    return "set-resource-object";
  },

  detail(step) {
    const s = step["set-resource-object"];
    return `**set-resource-object** \`${s.identifier}\` @ \`${s.system}\` — {${Object.keys(s.set).join(", ")}}`;
  },
};
