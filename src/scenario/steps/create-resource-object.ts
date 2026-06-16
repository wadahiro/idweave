/**
 * Step: ARRANGE — create a new object ON THE TARGET through midPoint's connector
 * (executeScript → ResourceObjectConverter.addResourceObject, NO shadow persisted).
 * `attributes` includes the naming attribute. The created object is auto-cleaned at the
 * next reset (resetCleanup), so the scenario stays declarative and re-runnable.
 */
import { createResourceObject } from "../../actions/resourceObject.ts";
import { suiteSystem } from "../suite.ts";
import { resolveResourceMidpoint } from "./resourceMidpoint.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface CreateResourceObjectStep {
  "create-resource-object": {
    system: string;
    attributes: Record<string, string | string[]>;
  };
}

export const createResourceObjectStep: StepHandler<CreateResourceObjectStep> = {
  kind: "create-resource-object",
  phase: "arrange",
  appliesTo: ["resource"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["create-resource-object"],
    description: "Create a new object on the target through midPoint's connector (no shadow).",
    properties: {
      "create-resource-object": {
        type: "object",
        additionalProperties: false,
        required: ["system", "attributes"],
        properties: {
          system: { type: "string", description: "Resource system name (its objectClass fixes the type)." },
          attributes: {
            type: "object",
            minProperties: 1,
            additionalProperties: { type: ["string", "array"], items: { type: "string" } },
            description: "Attribute → value(s) for the new object (must include the identifier attribute).",
          },
        },
      },
    },
  },

  match(step): step is CreateResourceObjectStep {
    return typeof step === "object" && step !== null && "create-resource-object" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["create-resource-object"];
    const { system } = suiteSystem(ctx.suite, s.system);
    if (!system.resource) throw new Error(`create-resource-object: system "${s.system}" is not a resource system`);
    const { rest, version } = resolveResourceMidpoint(ctx.suite, system.resource, ctx.cfg);
    await createResourceObject(rest, version, system.resource, s.attributes);
  },

  // The created object's identifier (value of the system's identifierAttr) — deleted
  // through the connector at the next reset, so a created object never leaks across runs.
  resetCleanup(step, suite) {
    const s = step["create-resource-object"];
    const sys = suite.systems[s.system];
    if (!sys?.resource) return [];
    const idAttr = sys.resource.identifierAttr ?? "name";
    const v = s.attributes[idAttr];
    const identifier = Array.isArray(v) ? v[0] : v;
    return identifier ? [{ system: s.system, identifier: String(identifier) }] : [];
  },

  token() {
    return "create-resource-object";
  },

  detail(step) {
    const s = step["create-resource-object"];
    return `**create-resource-object** @ \`${s.system}\` — {${Object.keys(s.attributes).join(", ")}}`;
  },
};
