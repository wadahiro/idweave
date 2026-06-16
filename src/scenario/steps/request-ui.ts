/**
 * Step: request a requestable role for oneself via the self-service GUI, AS the
 * requester. Used where REST is not faithful — an End user cannot request over
 * REST, only from the screen. The resulting case/provisioning is asserted with
 * `expect` (REST/verify).
 */
import { requestAccessViaUi, requestExpectingErrorViaUi } from "../../actions/ui.ts";
import { guiPassword } from "../suite.ts";
import type { CatalogView } from "../../clients/ui/contract.ts";
import type { RunContext, StepHandler } from "./types.ts";

/** Logical request-screen views — each PO maps to its version's actual tab/nav. */
const VIEW_KEYS = ["role-catalog", "all-roles", "all-organizations", "all-services"] as const;

interface RequestUiItem {
  access: string;
  view?: CatalogView;
  catalog?: string[];
  validFrom?: string;
  validTo?: string;
  relation?: string;
}
interface RequestUiStep {
  "request-ui": {
    as: string;
    for?: string[];
    comment?: string;
    /** Request-level (BULK) validity — one window for ALL items. Mutually exclusive with item-level. */
    validFrom?: string;
    validTo?: string;
    items: RequestUiItem[];
    expectError?: string;
  };
}

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["access"],
  properties: {
    access: { type: "string", description: "Display name of the requestable role/org/service." },
    view: {
      type: "string",
      enum: VIEW_KEYS,
      description: "Logical view to find it under: 'role-catalog' (default), 'all-roles', 'all-organizations', 'all-services'. The page object maps it to the version's UI.",
    },
    catalog: {
      type: "array",
      items: { type: "string" },
      description: "Role-catalog org path to drill through (root → leaf) before the access is listed.",
    },
    validFrom: {
      type: "string",
      description:
        "PER-ROLE validity start (ISO date) — this item's own window (new UI: its Edit dialog; old UI: its panel). Mutually exclusive with request-level validFrom/validTo.",
    },
    validTo: { type: "string", description: "Per-role validity end (ISO date). See validFrom." },
    relation: { type: "string", description: "Relation for the assignment (e.g. 'Default', 'Manager', 'Owner')." },
  },
} as const;

export const requestUiStep: StepHandler<RequestUiStep> = {
  kind: "request-ui",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["request-ui"],
    description: "Submit a self-service access request via the GUI (as the requester).",
    properties: {
      "request-ui": {
        type: "object",
        additionalProperties: false,
        required: ["as", "items"],
        properties: {
          as: { type: "string", description: "Login of the requester (GUI password from env)." },
          for: {
            type: "array",
            items: { type: "string" },
            description: "Persons of interest (logins) the access is for. Omit → the requester themselves.",
          },
          comment: { type: "string", description: "Optional request-level comment." },
          validFrom: {
            type: "string",
            description:
              "Request-level (BULK) validity start (ISO date) — ONE window for ALL items (new UI: the cart 'Custom length' panel; old UI: looped onto every panel). Mutually exclusive with any item-level validFrom/validTo.",
          },
          validTo: { type: "string", description: "Request-level (bulk) validity end (ISO date). See validFrom." },
          items: { type: "array", minItems: 1, items: ITEM_SCHEMA, description: "Access items to request together." },
          expectError: {
            type: "string",
            description:
              "If set, the request is expected to be REJECTED: submit, then assert the GUI shows an error containing this substring (and did not succeed). For requestable-but-policy-blocked access.",
          },
        },
      },
    },
  },

  match(step): step is RequestUiStep {
    return typeof step === "object" && step !== null && "request-ui" in step;
  },

  async run(step, ctx: RunContext) {
    const { as, for: forUsers, comment, validFrom, validTo, items, expectError } = step["request-ui"];
    // Validity is set at ONE scope: request-level (BULK, one window for all) OR
    // per-item (PER-ROLE, each its own) — never both. Combining is rejected here
    // (not in JSON-Schema, which can't express the cross-`items[]` rule): on both
    // new-UI versions the bulk silently wins, so a mixed request isn't portably
    // assertable. Pick one operation per request.
    const hasBulk = validFrom !== undefined || validTo !== undefined;
    const hasPerItem = items.some((i) => i.validFrom !== undefined || i.validTo !== undefined);
    if (hasBulk && hasPerItem) {
      throw new Error(
        "request-ui: set validity at the request level (bulk, one window for all items) " +
          "OR on items[] (per-role), not both — they are different UI operations and the bulk " +
          "silently wins when combined. Use one scope per request.",
      );
    }
    const submission = { items, for: forUsers, comment, validFrom, validTo };
    if (expectError === undefined) {
      await requestAccessViaUi(ctx.ui, as, guiPassword(ctx.suite, as, ctx.cfg.gui.password), submission);
      return;
    }
    // Negative path: the request must be rejected and show an error in the GUI.
    const shown = await requestExpectingErrorViaUi(ctx.ui, as, guiPassword(ctx.suite, as, ctx.cfg.gui.password), submission);
    if (!shown.includes(expectError)) {
      throw new Error(
        `Expected the request to be rejected with an error containing "${expectError}", ` +
          `but the GUI showed: ${shown ? JSON.stringify(shown) : "(no error text)"}`,
      );
    }
  },

  token() {
    return "request-ui";
  },

  detail(step) {
    const r = step["request-ui"];
    const names = r.items.map((i) => i.access).join(", ");
    const forWhom = r.for?.length ? ` for \`${r.for.join(", ")}\`` : "";
    const neg = r.expectError !== undefined ? " (expecting error)" : "";
    return `**request-ui** \`${names}\` as \`${r.as}\`${forWhom}${neg}`;
  },
};
