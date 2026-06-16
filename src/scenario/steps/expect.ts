/**
 * Step: assert repo objects and/or target accounts at this point in the flow.
 * Also the source of truth for the upfront namespace reset and the listing's
 * asserts summary (via `assertions`). In capture mode, writes expected files
 * instead of asserting (current-behaviour capture).
 */
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { readRepoObjectProjection, loadExpected, assertMatchesExpected, compareToExpected } from "../../verify/expected.ts";
import { readAccountProjection, readAllAccountProjections } from "../../verify/target.ts";
import { readLiveProjections } from "../../verify/projections.ts";
import { csvSystemPath } from "../../actions/csvSource.ts";
import { suiteSystem, systemIdAttr } from "../suite.ts";
import { pollUntil, PollTimeoutError } from "../../poll.ts";
import type {
  ExpectedAccount, ExpectedObject, ExpectedProjections, RunContext, StepHandler,
} from "./types.ts";
import { expectedPath, captureExpectedFile } from "./expectedPath.ts";

interface ExpectStep {
  expect: { objects?: ExpectedObject[]; accounts?: ExpectedAccount[]; projections?: ExpectedProjections[] };
}

/** Stable-state key for the settled-mismatch fast-fail: null (absent) keeps waiting;
 * a non-null value identical across consecutive polls is "converged" — see pollUntil. */
const settleKey = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));


/**
 * Read the projection for CAPTURE, but wait for it to SETTLE first. A request
 * (GUI or REST) persists asynchronously, so reading once right after the step
 * can snapshot a mid-propagation state (e.g. a freshly-imported focus before its
 * requested role assignment lands). Poll until two consecutive non-null reads
 * are identical — the converged end-state — mirroring the eventual-consistency
 * poll the assert path uses (which instead waits to match the committed
 * expected). Falls back to the last read on timeout. Capture is still
 * current-behaviour capture: the result MUST be verified against intent (by design).
 */
async function readSettledForCapture<T>(read: () => Promise<T>, cfg: RunContext["cfg"]["poll"]): Promise<T | null> {
  let prev: string | undefined;
  return await pollUntil(
    read,
    (value) => {
      if (value === null || value === undefined) return false;
      const s = JSON.stringify(value);
      const settled = s === prev;
      prev = s;
      return settled;
    },
    cfg,
    "object projection to settle for capture",
  ).catch((e) => (e instanceof PollTimeoutError ? ((e.lastValue as T | null) ?? null) : null));
}

async function accountDump(ctx: RunContext, a: ExpectedAccount): Promise<string | null> {
  const { system } = suiteSystem(ctx.suite, a.system);
  const label = a.all ? "all" : a.identifier!;
  const dir = await ctx.dump(`account-${a.system}-${label}`, a.all ? [] : [a.identifier!]);
  if (!dir) return null;
  // CSV systems back the account with a file; copy it into the dump. LDAP targets
  // have no file to snapshot here (the cross-system dump covers the directory).
  if (system.csv) {
    await copyFile(csvSystemPath(ctx.hostDir, system), join(dir, `target.${a.system}.csv`)).catch(() => {});
  }
  return dir;
}

async function assertObject(o: ExpectedObject, ctx: RunContext): Promise<void> {
  const dumpFor = () => ctx.dump(`${ctx.scenarioId}-${o.name}`);
  const read = () => readRepoObjectProjection(ctx.rest, o.type, o.name, ctx.suite.normalize?.mask);
  if (o.absent) {
    if (ctx.captureExpected) return;
    if ((await read()) !== null) {
      const d = await dumpFor().catch(() => null);
      throw new Error(`Expected ${o.type} "${o.name}" to be ABSENT, but it exists` + (d ? ` (dump: ${d})` : ""));
    }
    return;
  }
  const expectedFile = expectedPath(ctx, o.expected!);
  if (ctx.captureExpected) return void (await captureExpectedFile(ctx, expectedFile, await readSettledForCapture(read, ctx.cfg.poll)));
  const expected = await loadExpected(expectedFile);
  // A request (GUI or REST) persists asynchronously, so the projection can lag
  // the step that triggered it. Poll until it matches the committed expected —
  // eventual consistency, like assertAccount. On timeout (or a settled mismatch),
  // fall through to the final assert with the LAST projection so the failure carries
  // the field-level diff (PollTimeoutError.lastValue), not a bare "not found".
  const projection = await pollUntil(
    read,
    (p) => p !== null && compareToExpected(p, expected).match,
    ctx.cfg.poll,
    `${o.type} "${o.name}" to match expected`,
    { settleKey },
  ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as Record<string, unknown> | null) : null));
  if (projection === null) {
    const d = await dumpFor().catch(() => null);
    throw new Error(`Expected ${o.type} "${o.name}" not found` + (d ? ` (dump: ${d})` : ""));
  }
  await assertMatchesExpected(projection, expected, dumpFor);
}

async function assertAccount(a: ExpectedAccount, ctx: RunContext): Promise<void> {
  const { system } = suiteSystem(ctx.suite, a.system);
  const idAttr = systemIdAttr(system);
  const who = a.all ? "all accounts" : `"${a.identifier}"`;
  const dumpFor = () => accountDump(ctx, a);
  // `all` reads the whole set; else a single account addressed by identifier.
  const read = a.all
    ? () => readAllAccountProjections(ctx.hostDir, system)
    : () => readAccountProjection(ctx.hostDir, system, a.identifier!, ctx.rest, ctx.state.captures);
  if (a.absent) {
    const record = await read();
    if (ctx.captureExpected) return;
    if (record !== null) {
      const d = await dumpFor().catch(() => null);
      throw new Error(`Expected account ${who} in "${a.system}" to be ABSENT, but it exists` + (d ? ` (dump: ${d})` : ""));
    }
    return;
  }
  const expectedFile = expectedPath(ctx, a.expected!);
  // Capture waits for the account to SETTLE (two identical reads), same as objects,
  // so a value still being deprovisioned (e.g. a just-removed value the target hasn't
  // finished removing) is not pinned from a transient mid-flight state.
  if (ctx.captureExpected) return void (await captureExpectedFile(ctx, expectedFile, await readSettledForCapture(read, ctx.cfg.poll)));
  const expected = await loadExpected(expectedFile);
  // Eventual consistency: poll until the account MATCHES expected (not merely
  // appears), like assertObject. On timeout (or a settled mismatch), keep the last
  // read for the diff.
  const record = await pollUntil(
    read,
    (r) => r !== null && compareToExpected(r, expected).match,
    ctx.cfg.poll,
    a.all ? `all accounts to match expected in target ${a.system}` : `account ${idAttr}="${a.identifier}" to match expected in target ${a.system}`,
    { settleKey },
  ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as Record<string, unknown> | null) : null));
  if (record === null) {
    const d = await dumpFor().catch(() => null);
    throw new Error(`Expected account ${who} not found in target "${a.system}"` + (d ? ` (dump: ${d})` : ""));
  }
  await assertMatchesExpected(record, expected, dumpFor);
}

async function assertProjections(s: ExpectedProjections, ctx: RunContext): Promise<void> {
  const read = () => readLiveProjections(ctx.rest, s.owner);
  if (s.absent) {
    if (ctx.captureExpected) return;
    const projections = await read();
    if (projections && projections.length > 0) {
      throw new Error(`Expected "${s.owner}" to have NO live projections, but it has ${projections.length}`);
    }
    return;
  }
  const expectedFile = expectedPath(ctx, s.expected!);
  if (ctx.captureExpected) {
    const p = await pollUntil(read, (v) => v !== null, ctx.cfg.poll, `projections of "${s.owner}"`).catch(() => null);
    return void (await captureExpectedFile(ctx, expectedFile, p));
  }
  const expected = await loadExpected(expectedFile);
  // Provisioning is asynchronous — poll until the live projection set matches. A
  // settled mismatch (e.g. an expected set pinned at a different point in the flow)
  // fast-fails with the diff instead of waiting out the whole timeout.
  const projections = await pollUntil(
    read,
    (p) => p !== null && compareToExpected(p, expected).match,
    ctx.cfg.poll,
    `projections of "${s.owner}" to match expected`,
    { settleKey },
  ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as Record<string, unknown> | null) : null));
  if (projections === null) throw new Error(`Focus "${s.owner}" not found for projection assertion`);
  await assertMatchesExpected(projections, expected, () => Promise.resolve(null));
}

export const expectStep: StepHandler<ExpectStep> = {
  kind: "expect",
  phase: "assert",
  appliesTo: ["midpoint", "csv", "ldap", "scim", "db", "keycloak", "resource"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect"],
    description: "Assert repo objects and/or target accounts at this point in the flow.",
    properties: {
      expect: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          objects: { type: "array", minItems: 1, items: { $ref: "#/definitions/expectedObject" } },
          accounts: { type: "array", minItems: 1, items: { $ref: "#/definitions/expectedAccount" } },
          projections: { type: "array", minItems: 1, items: { $ref: "#/definitions/expectedProjections" } },
        },
      },
    },
  },

  match(step): step is ExpectStep {
    return typeof step === "object" && step !== null && "expect" in step;
  },

  async run(step, ctx) {
    for (const o of step.expect.objects ?? []) await assertObject(o, ctx);
    for (const a of step.expect.accounts ?? []) await assertAccount(a, ctx);
    for (const s of step.expect.projections ?? []) await assertProjections(s, ctx);
  },

  token() {
    return "expect";
  },

  detail() {
    return "**expect**";
  },

  assertions(step) {
    return { objects: step.expect.objects, accounts: step.expect.accounts };
  },
};
