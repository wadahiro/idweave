/**
 * Step: assert a CONNECTOR-MEDIATED resource object — read a target object (or ALL
 * objects) THROUGH midPoint's connector (no shadow persisted) and assert the projected
 * attributes. The generic, SIDE-EFFECT-FREE oracle for a target idweave has no native
 * client for; standardized protocols use their direct readers via `expect.accounts`.
 *
 * Addressing (a single object): `identifier` is matched per the resource system's
 * `identifierAttr` — `__uid__` (primary identifier), `__name__` (secondary identifier),
 * or a regular attribute name. `expected: <path>` asserts the projection, `absent: true`
 * asserts it is gone. `all: true` (no identifier) asserts the FULL set of objects on the
 * target (order-independent). Eventual-consistency poll; capture mode writes the (settled)
 * projection.
 */
import { loadExpected, assertMatchesExpected, compareToExpected } from "../../verify/expected.ts";
import { readResourceObjectProjection, readAllResourceObjectsProjection } from "../../verify/resourceTarget.ts";
import { suiteSystem } from "../suite.ts";
import { resolveResourceMidpoint } from "./resourceMidpoint.ts";
import { pollUntil, PollTimeoutError } from "../../poll.ts";
import type { RunContext, StepHandler } from "./types.ts";
import { expectedPath, captureExpectedFile } from "./expectedPath.ts";

interface ExpectResourceObjectStep {
  "expect-resource-object": {
    system: string;
    identifier?: string;
    all?: boolean;
    expected?: string;
    absent?: boolean;
  };
}

const settleKey = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));


/** Poll a projection read until it SETTLES (two identical reads), for capture. */
async function settle<T>(read: () => Promise<T>, cfg: RunContext["cfg"]["poll"]): Promise<T | null> {
  let prev: string | undefined;
  return await pollUntil(
    read,
    (v) => {
      if (v == null) return false;
      const k = JSON.stringify(v);
      const done = k === prev;
      prev = k;
      return done;
    },
    cfg,
    "resource object to settle for capture",
  ).catch((e) => (e instanceof PollTimeoutError ? ((e.lastValue as T | null) ?? null) : null));
}

export const expectResourceObjectStep: StepHandler<ExpectResourceObjectStep> = {
  kind: "expect-resource-object",
  phase: "assert",
  appliesTo: ["resource"],
  prefix: { param: "system", into: "value" },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect-resource-object"],
    description: "Assert a connector-mediated resource object, or all objects (read through midPoint's connector, no shadow).",
    properties: {
      "expect-resource-object": {
        type: "object",
        additionalProperties: false,
        required: ["system"],
        oneOf: [
          { required: ["identifier", "expected"] },
          { required: ["identifier", "absent"] },
          { required: ["all", "expected"] },
        ],
        properties: {
          system: { type: "string", description: "Resource system name (in suite.systems)." },
          identifier: { type: "string", description: "Value matched per the system's identifierAttr (__uid__ / __name__ / a regular attribute)." },
          all: { const: true, description: "Assert the FULL set of objects of the class on the target (order-independent)." },
          expected: { type: "string", description: "Path to the captured expected projection (or set, for `all`)." },
          absent: { type: "boolean", description: "Assert the object does NOT exist on the target." },
        },
      },
    },
  },

  match(step): step is ExpectResourceObjectStep {
    return typeof step === "object" && step !== null && "expect-resource-object" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["expect-resource-object"];
    const { system } = suiteSystem(ctx.suite, s.system);
    if (!system.resource) throw new Error(`expect-resource-object: system "${s.system}" is not a resource system`);
    const { rest, version } = resolveResourceMidpoint(ctx.suite, system.resource, ctx.cfg);
    const who = s.all ? "all objects" : `"${s.identifier}"`;

    // `all` → the full object set; else a single object addressed by identifier.
    type Projection = Record<string, unknown> | Array<Record<string, unknown>> | null;
    const read: () => Promise<Projection> = s.all
      ? () => readAllResourceObjectsProjection(rest, version, system.resource!)
      : () => readResourceObjectProjection(rest, version, system.resource!, s.identifier!);

    if (s.absent) {
      if (ctx.captureExpected) return;
      if ((await read()) !== null) {
        throw new Error(`Expected resource object ${who} on "${s.system}" to be ABSENT, but it exists`);
      }
      return;
    }

    const expectedFile = expectedPath(ctx, s.expected!);
    if (ctx.captureExpected) {
      return void (await captureExpectedFile(ctx, expectedFile, await settle(read, ctx.cfg.poll)));
    }

    const expected = await loadExpected(expectedFile);
    const record = await pollUntil(
      read,
      (r) => r !== null && compareToExpected(r, expected).match,
      ctx.cfg.poll,
      `resource object ${who} to match expected on "${s.system}"`,
      { settleKey },
    ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as Projection) : null));
    if (record === null) throw new Error(`Expected resource object ${who} not found on "${s.system}"`);
    await assertMatchesExpected(record, expected, () => Promise.resolve(null));
  },

  token() {
    return "expect-resource-object";
  },

  detail(step) {
    const s = step["expect-resource-object"];
    const who = s.all ? "all" : `\`${s.identifier}\``;
    const mode = s.absent ? "absent" : `expected (\`${s.expected}\`)`;
    return `**expect-resource-object** ${who} @ \`${s.system}\` — ${mode}`;
  },
};
