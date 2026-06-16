/**
 * The step registry: the single list every layer iterates. Adding a step kind =
 * a new handler module + one entry here (and its actions verb in actions/, if any).
 *
 * `buildScenarioSchema` assembles the JSON Schema from each handler's fragment
 * plus the shared definitions, so the contract stays co-located with the code.
 */
import type { StepHandler } from "./types.ts";
import { mutateStep } from "./mutate.ts";
import { clearSystemStep } from "./clear-system.ts";
import { triggerStep } from "./trigger.ts";
import { runTaskStep } from "./run-task.ts";
import { assignStep } from "./assign.ts";
import { unassignStep } from "./unassign.ts";
import { unassignMatchingStep } from "./unassign-matching.ts";
import { setFocusStep } from "./set-focus.ts";
import { deriveFocusStep } from "./derive-focus.ts";
import { deriveShadowStep } from "./derive-shadow.ts";
import { dbMutateStep } from "./db-mutate.ts";
import { captureFocusStep } from "./capture-focus.ts";
import { captureAccountStep } from "./capture-account.ts";
import { expectAccountChangedStep } from "./expect-account-changed.ts";
import { setAssignmentStep } from "./set-assignment.ts";
import { deleteObjectStep } from "./delete-object.ts";
import { clearFocusStep } from "./clear-focus.ts";
import { clearShadowStep } from "./clear-shadow.ts";
import { clearLookupRowStep } from "./clear-lookup-row.ts";
import { setLookupRowStep } from "./set-lookup-row.ts";
import { bulkActionStep } from "./bulk-action.ts";
import { createOrgStep } from "./create-org.ts";
import { createOrgUiStep } from "./create-org-ui.ts";
import { deleteOrgStep } from "./delete-org.ts";
import { writeFileStep } from "./write-file.ts";
import { expectFileStep } from "./expect-file.ts";
import { clearMailStep } from "./clear-mail.ts";
import { searchFederatedUserStep } from "./search-federated-user.ts";
import { loginUiStep } from "./login-ui.ts";
import { requestUiStep } from "./request-ui.ts";
import { expectRequestableStep } from "./expect-requestable.ts";
import { expectMenuStep } from "./expect-menu.ts";
import { expectFieldsStep } from "./expect-fields.ts";
import { expectMailStep } from "./expect-mail.ts";
import { openMailLinkStep } from "./open-mail-link.ts";
import { uiFlowStep } from "./ui-flow.ts";
import { approveUiStep } from "./approve-ui.ts";
import { assignUiStep } from "./assign-ui.ts";
import { unassignUiStep } from "./unassign-ui.ts";
import { forwardUiStep } from "./forward-ui.ts";
import { rejectUiStep } from "./reject-ui.ts";
import { expectResourceObjectStep } from "./expect-resource-object.ts";
import { createResourceObjectStep } from "./create-resource-object.ts";
import { setResourceObjectStep } from "./set-resource-object.ts";
import { clearResourceObjectStep } from "./clear-resource-object.ts";
import { deleteResourceObjectStep } from "./delete-resource-object.ts";
import { expectStep } from "./expect.ts";

export const STEP_HANDLERS: ReadonlyArray<StepHandler> = [
  mutateStep,
  clearSystemStep,
  triggerStep,
  runTaskStep,
  assignStep,
  unassignStep,
  unassignMatchingStep,
  setFocusStep,
  deriveFocusStep,
  deriveShadowStep,
  dbMutateStep,
  captureFocusStep,
  captureAccountStep,
  expectAccountChangedStep,
  setAssignmentStep,
  deleteObjectStep,
  clearFocusStep,
  clearShadowStep,
  clearLookupRowStep,
  setLookupRowStep,
  bulkActionStep,
  createOrgStep,
  createOrgUiStep,
  deleteOrgStep,
  writeFileStep,
  expectFileStep,
  clearMailStep,
  searchFederatedUserStep,
  loginUiStep,
  assignUiStep,
  unassignUiStep,
  requestUiStep,
  expectRequestableStep,
  expectMenuStep,
  expectFieldsStep,
  expectMailStep,
  openMailLinkStep,
  uiFlowStep,
  approveUiStep,
  forwardUiStep,
  rejectUiStep,
  expectResourceObjectStep,
  createResourceObjectStep,
  setResourceObjectStep,
  clearResourceObjectStep,
  deleteResourceObjectStep,
  expectStep,
];

/** The handler that owns a step declaration, or undefined if none matches. */
export function handlerFor(step: unknown): StepHandler | undefined {
  return STEP_HANDLERS.find((h) => h.match(step));
}

/** Shared JSON-Schema definitions handlers reference via `#/definitions/...`. */
const definitions = {
  rowsOrFile: {
    oneOf: [
      {
        type: "array",
        description: "Inline rows.",
        items: { type: "object", additionalProperties: { type: "string" } },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["file"],
        description: "Reference to a CSV fixture file (path relative to the scenario dir).",
        properties: { file: { type: "string" } },
      },
    ],
  },
  expectedObject: {
    type: "object",
    additionalProperties: false,
    required: ["type", "name"],
    properties: {
      type: { type: "string", enum: ["user", "role", "org", "service"] },
      name: { type: "string" },
      expected: { type: "string", description: "Path to the expected normalized projection." },
      absent: { type: "boolean", description: "Assert the object does NOT exist." },
    },
    oneOf: [{ required: ["expected"] }, { required: ["absent"] }],
  },
  expectedAccount: {
    type: "object",
    additionalProperties: false,
    required: ["system"],
    properties: {
      system: { type: "string", description: "System name (in suite.systems) to read the provisioned account from." },
      identifier: { type: "string", description: "The account to read (its idColumn/rdnAttr/filterAttr value). Omit when `all`." },
      all: { const: true, description: "Assert the WHOLE account set of the system (order-independent), not one account. csv/ldap/scim only." },
      expected: { type: "string" },
      absent: { type: "boolean" },
    },
    oneOf: [
      { required: ["identifier", "expected"] },
      { required: ["identifier", "absent"] },
      { required: ["all", "expected"] },
    ],
  },
  expectedProjections: {
    type: "object",
    additionalProperties: false,
    required: ["owner"],
    description: "Assert a focus user's set of LIVE projections (non-dead shadows), by resource/kind/intent.",
    properties: {
      owner: { type: "string", description: "Focus user whose live projections to assert." },
      expected: { type: "string", description: "Path to the captured expected projection set." },
      absent: { type: "boolean", description: "Assert the focus has NO live projections." },
    },
    oneOf: [{ required: ["expected"] }, { required: ["absent"] }],
  },
};

/**
 * Schema for a PARAMETERIZED scenario template (one carrying a `cases:` table).
 * Validated before expansion: `cases` must be literal string-valued data and
 * `steps` is only checked structurally here (its leaves may hold {from-case}
 * reference nodes). After expansion each concrete scenario's resolved steps go
 * through `buildScenarioSchema()` (the strict step `oneOf`), so the real step
 * contract is enforced post-resolution without loosening any handler's fragment.
 */
export function buildCaseTemplateSchema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/wadahiro/idweave/scenario.cases.schema.json",
    title: "Parameterized connected-test scenario",
    type: "object",
    additionalProperties: false,
    // `requirement` is optional here: a case may carry its own (see below); each
    // expanded scenario is then re-validated against the strict schema, which
    // requires one — so a case lacking both a per-case and a base requirement
    // fails post-expansion.
    required: ["id", "cases", "steps"],
    properties: {
      id: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9-]*$",
        description: "Stable base scenario id; each case expands to `id[name]`.",
      },
      requirement: { type: "string", description: "Base/fallback requirement id (a case may override)." },
      description: { type: "string" },
      cases: {
        type: "array",
        minItems: 1,
        description:
          "Parameterization table — pure literal data (NO logic). The engine iterates it " +
          "(control flow → code); steps bind a case's value via { from-case: <field> }.",
        items: {
          type: "object",
          required: ["name"],
          // Case fields are strings only — they fill string step leaves and keep
          // the table free of nested logic.
          additionalProperties: { type: "string" },
          properties: {
            name: {
              type: "string",
              pattern: "^[a-z0-9][a-z0-9-]*$",
              description: "Case id; appended as the expanded scenario `id[name]`.",
            },
            requirement: {
              type: "string",
              description: "Per-case requirement id, overriding the base (traceability).",
            },
          },
        },
      },
      setup: {
        type: "array",
        minItems: 1,
        description: "Optional setup template (same as steps; leaf values may be { from-case: <field> }).",
        items: { type: "object" },
      },
      steps: {
        type: "array",
        minItems: 1,
        description: "Step template; leaf values may be { from-case: <field> }, validated after expansion.",
        items: { type: "object" },
      },
    },
  };
}

/** Assemble the full scenario JSON Schema from the registry. */
export function buildScenarioSchema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/wadahiro/idweave/scenario.schema.json",
    title: "Connected-test scenario",
    description:
      "Declarative scenario: ordered steps. Each step mutates a source, triggers " +
      "import/recon, assigns or unassigns a role, or asserts (expect) — so " +
      "assertions can be placed at any point. No logic (ordered declarations only).",
    type: "object",
    additionalProperties: false,
    required: ["id", "requirement", "steps"],
    definitions,
    properties: {
      id: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9-]*$",
        description: "Stable scenario id (also the test name).",
      },
      requirement: { type: "string", description: "Requirement id for traceability." },
      description: { type: "string" },
      setup: {
        type: "array",
        minItems: 1,
        description:
          "Optional preconditions run BEFORE steps — the idempotent pre-clean that " +
          "establishes a known starting state (same step kinds as steps; a failure here " +
          "is a setup failure, kept apart from the behaviour under test).",
        items: { oneOf: STEP_HANDLERS.map((h) => h.schema) },
      },
      steps: {
        type: "array",
        minItems: 1,
        description: "Ordered steps; each is one action handled by a registered StepHandler.",
        items: { oneOf: STEP_HANDLERS.map((h) => h.schema) },
      },
    },
  };
}
