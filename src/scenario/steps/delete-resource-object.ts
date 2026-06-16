/**
 * Step: ARRANGE — delete an object FROM THE TARGET through midPoint's connector
 * (executeScript → ResourceObjectConverter.deleteResourceObject, NO shadow). Addressed
 * by `identifier`. No-op if the object is already absent (idempotent).
 */
import { deleteResourceObject } from "../../actions/resourceObject.ts";
import { suiteSystem } from "../suite.ts";
import { resolveResourceMidpoint } from "./resourceMidpoint.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface DeleteResourceObjectStep {
  "delete-resource-object": {
    system: string;
    identifier: string;
  };
}

export const deleteResourceObjectStep: StepHandler<DeleteResourceObjectStep> = {
  kind: "delete-resource-object",
  phase: "reset",
  appliesTo: ["resource"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["delete-resource-object"],
    description: "Delete an object from the target through midPoint's connector (no shadow).",
    properties: {
      "delete-resource-object": {
        type: "object",
        additionalProperties: false,
        required: ["system", "identifier"],
        properties: {
          system: { type: "string", description: "Resource system name." },
          identifier: { type: "string", description: "Value of the system's identifierAttr on the target object." },
        },
      },
    },
  },

  match(step): step is DeleteResourceObjectStep {
    return typeof step === "object" && step !== null && "delete-resource-object" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["delete-resource-object"];
    const { system } = suiteSystem(ctx.suite, s.system);
    if (!system.resource) throw new Error(`delete-resource-object: system "${s.system}" is not a resource system`);
    const { rest, version } = resolveResourceMidpoint(ctx.suite, system.resource, ctx.cfg);
    await deleteResourceObject(rest, version, system.resource, s.identifier);
  },

  token() {
    return "delete-resource-object";
  },

  detail(step) {
    const s = step["delete-resource-object"];
    return `**delete-resource-object** \`${s.identifier}\` @ \`${s.system}\``;
  },
};
