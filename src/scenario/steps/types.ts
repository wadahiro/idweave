/**
 * scenario — Step contracts (the contract that makes step kinds pluggable).
 *
 * One step kind = one StepHandler module that co-locates EVERYTHING about it:
 * its JSON-Schema fragment (contract), its type guard, how it runs (calling actions
 * verbs), and how it renders in the scenarios listing. The loader, runner, and
 * the listing iterate the registry instead of hard-coding each kind, so adding a
 * kind is a new file + one registry line — no shotgun surgery across layers.
 */
import type { Config } from "../../config.ts";
import type { MidpointRest } from "../../clients/midpointRest.ts";
import type { UiDriver } from "../../clients/ui/driver.ts";
import type { Suite } from "../suite.ts";

export type Row = Record<string, string>;
/** A list of rows inline, or a reference to a CSV fixture file. */
export type RowsOrFile = Row[] | { file: string };

export type ObjectType = "user" | "role" | "org" | "service";

export interface ExpectedObject {
  type: ObjectType;
  name: string;
  expected?: string;
  absent?: boolean;
}
export interface ExpectedAccount {
  /** Name of the system (in suite.systems) to read the provisioned account from. */
  system: string;
  /** The account to read (its idColumn/rdnAttr/filterAttr value). Omit when `all`. */
  identifier?: string;
  /** Assert the WHOLE account set of the system (order-independent), not one account.
   * Requires `expected`; supported for csv/ldap/scim targets. */
  all?: boolean;
  expected?: string;
  absent?: boolean;
}

/** Assert a focus user's set of LIVE projections (non-dead shadows). */
export interface ExpectedProjections {
  /** Focus user whose live projections to assert. */
  owner: string;
  /** Path to the captured expected projection set. */
  expected?: string;
  /** Assert the focus has NO live projections. */
  absent?: boolean;
}

/** A validated step declaration (its concrete shape is narrowed by handlers). */
export type Step = Record<string, unknown>;

export interface Scenario {
  id: string;
  requirement: string;
  description?: string;
  /**
   * Optional preconditions run BEFORE `steps`: the idempotent pre-clean that
   * establishes a known starting state (clear-focus / clear-system / search-federated-user
   * / clear-mail / …). Same step kinds as `steps`; separated so the reset reads
   * apart from the behaviour under test. A failure here is a setup failure.
   */
  setup?: Step[];
  steps: Step[];
}

/** Inter-member reset policy of a group (see scenario/group.ts). */
export type ResetPolicy = "none";

/** A scenario's membership in a group (when it lives under a group.yaml dir). */
export interface GroupMembership {
  id: string;
  reset: ResetPolicy;
  /** Position within the group's order (for stable ordering/listing). */
  orderIndex: number;
}

export interface LoadedScenario {
  scenario: Scenario;
  /** Absolute path to the scenario directory (expected paths resolve here). */
  dir: string;
  /** Absolute path to scenario.yaml. */
  file: string;
  /** 1-based start line of each step in scenario.yaml (parallel to scenario.steps; 0 = unknown). */
  stepLines: number[];
  /** 1-based start line of each setup step (parallel to scenario.setup; 0 = unknown). */
  setupLines?: number[];
  /** Group membership, when this scenario lives under a group.yaml directory. */
  group?: GroupMembership;
}

/** A single step's identity + source span, for failure reporting. */
export interface StepRef {
  /** 0-based step index and total, for "step 4/7". */
  index: number;
  count: number;
  /** 1-based line where the step starts in scenario.yaml (0 if unknown). */
  line: number;
  /** 1-based line where the step block ends (for the source excerpt). */
  endLine: number;
  /** Step kind token (e.g. "expect", "import"). */
  kind: string;
  /** Plain-text one-liner describing the step (markdown stripped). */
  detail: string;
}

/**
 * Where a scenario failed, attached to the thrown error so the reporter can
 * point at the offending step in scenario.yaml (not at generic harness frames).
 * `prev` is the immediately preceding step: for an `expect` failure the wrong
 * state was produced by that action, so it's usually the real subject of the bug.
 */
export interface StepFailureLocation {
  scenarioId: string;
  /** Absolute path to scenario.yaml. */
  file: string;
  /** The step that threw. */
  step: StepRef;
  /** The step before it (if any). */
  prev?: StepRef;
}

/**
 * Per-run state and services passed to every handler. Built once per scenario by
 * the runner. `state.lastTaskOid` is mutable: a trigger writes it, later dumps
 * read it.
 */
export interface RunContext {
  rest: MidpointRest;
  cfg: Config;
  suite: Suite;
  /** Host CSV directory (source/target files live here). */
  hostDir: string;
  /** Absolute scenario directory (fixtures and expected files resolve here). */
  scenarioDir: string;
  scenarioId: string;
  /** Current-behaviour capture mode: capture expected files instead of asserting. */
  captureExpected: boolean;
  /** All asserted focus user names — the default subjects of a cross-system dump. */
  userNames: string[];
  /**
   * Mutable per-run scratch. `lastTaskOid`: a trigger writes it, later dumps read
   * it. `captures`: named focus-property snapshots a `capture-focus` step records,
   * which a later db `linkFrom: { capture }` assert binds as its `:id` — used to
   * assert a row whose linking value the run since destroyed (e.g. a rotated cert).
   */
  state: {
    lastTaskOid?: string;
    captures?: Record<string, string[]>;
    /** Capture mode only: expected file path -> content written, to detect two
     * expect steps capturing the SAME file with DIFFERENT content (a collision). */
    capturedFiles?: Map<string, string>;
  };
  /**
   * Epoch ms, FROZEN once per scenario: all relative-time values (`now-P1D`) the
   * steps resolve share this single anchor, so timestamps seeded across steps keep
   * a fixed relation (latency-independent) — e.g. a `now-PT1M` seed and a `now-PT2M`
   * rewind stay exactly one minute apart. The same value on every call within a run.
   */
  now: () => number;
  /**
   * Cross-system dump for failure diagnostics; returns the dump dir path, or
   * null when dumping is disabled (the default — enable with DUMP_ON_FAILURE).
   */
  dump(scenarioLabel: string, userNames?: string[]): Promise<string | null>;
  /** GUI driver for UI steps (browser launches lazily, closed at scenario end). */
  ui: UiDriver;
}

/** Context for rendering a step in the scenarios listing (no running stack needed). */
export interface DescribeContext {
  suite: Suite;
}

/**
 * A step's role in the scenario lifecycle — the spine a developer writes along
 * (setup pre-clean → arrange → act → assert). Drives the grouping in `idw steps`.
 */
export type StepPhase = "arrange" | "act" | "assert" | "reset";

/** A suite-system protocol a step's `system:` reference may resolve to. */
export type SystemKind = "csv" | "ldap" | "scim" | "db" | "keycloak" | "resource" | "midpoint";

/**
 * A self-contained step kind. `schema` is the JSON-Schema fragment for this
 * variant (a `oneOf` branch; it may $ref shared `#/definitions/...`).
 */
export interface StepHandler<S = unknown> {
  readonly kind: string;
  readonly schema: Record<string, unknown>;
  /**
   * Lifecycle role (required, so a new handler can't silently miss it — the
   * `idw steps` grouping is generated from it). `arrange` seeds input/state,
   * `act` invokes the behaviour under test, `assert` checks end-state, `reset`
   * is a setup pre-clean / teardown.
   */
  readonly phase: StepPhase;
  /**
   * The suite-system KINDS this step's `system:`/prefix may name — the declarative
   * source for the `idw steps` system column and (later) load-time validation. Omit
   * for a step that names no suite system (it targets the mail sink or a host file).
   * `["midpoint"]` marks a step that drives midPoint itself (focus/GUI operations).
   */
  readonly appliesTo?: ReadonlyArray<SystemKind>;
  /**
   * Opt-in to the `<system>/<kind>` key prefix (e.g. `idm/delete-object`): the loader
   * resolves the prefix and injects it as the named system param so the handler runs
   * unchanged. `into: "value"` sets `step[kind][param]` (a nested step like delete-object);
   * `into: "sibling"` sets `step[param]` (a flat step like mutate). Absent ⇒ the kind
   * cannot be prefixed (its system is its value or an env default).
   */
  readonly prefix?: { param: string; into: "value" | "sibling" };
  match(step: unknown): step is S;
  run(step: S, ctx: RunContext): Promise<void>;
  /** Short token for the steps summary (e.g. "import", "set(file)"). */
  token(step: S): string;
  /** One detailed Markdown line for the listing's per-step view. */
  detail(step: S, ctx: DescribeContext): string;
  /**
   * Assertions this step contributes to the upfront namespace reset and the
   * listing's asserts summary. Only `expect` implements it.
   */
  assertions?(step: S): { objects?: ExpectedObject[]; accounts?: ExpectedAccount[] };
  /**
   * Resource objects this step CREATES on a target that the surgical reset should
   * delete THROUGH the connector before the scenario runs — so a connector-created
   * object is idempotently pre-cleaned (like the asserted focus objects), keeping the
   * suite self-contained. Only `create-resource-object` implements it.
   */
  resetCleanup?(step: S, suite: Suite): Array<{ system: string; identifier: string }>;
}
