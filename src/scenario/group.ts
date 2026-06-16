/**
 * scenario — Group manifest (group.yaml).
 *
 * A directory containing a group.yaml is a GROUP: the scenarios beneath it form an
 * ordered, stateful CHAIN (reset: none) — each member runs on the previous member's
 * real end-state. It is the sound cheap option when a surgical per-scenario reset
 * can't isolate (e.g. LDAP), and grouped members therefore SKIP the per-scenario
 * surgical reset by design — their isolation comes from running in declared order.
 *
 * Order is declared by member scenario id (NOT a folder-name prefix), so a reorder
 * is a one-line edit with no directory churn.
 *
 * (Idempotency RESET across runs is a separate, standalone concern — the snapshot
 * CLI; see src/cli/snapshot.ts. It is deliberately NOT wired into scenario runs.)
 */
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import Ajv, { type ValidateFunction } from "ajv";
import type { ResetPolicy } from "./steps/types.ts";

export interface Group {
  id: string;
  reset: ResetPolicy;
  /** Member scenario ids in execution order; required when reset: none. */
  order?: string[];
  /** Absolute group directory. */
  dir: string;
}

/** JSON Schema for a group.yaml manifest. */
export function buildGroupSchema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/wadahiro/idweave/group.schema.json",
    title: "Scenario group manifest",
    type: "object",
    additionalProperties: false,
    required: ["id", "reset"],
    properties: {
      id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", description: "Group id." },
      reset: {
        enum: ["none"],
        description:
          "Inter-member reset: 'none' = ordered chain (members run on the prior end-state, " +
          "skipping the per-scenario surgical reset).",
      },
      order: {
        type: "array",
        items: { type: "string" },
        description: "Member scenario ids in execution order (required for reset: none).",
      },
    },
  };
}

let validator: ValidateFunction | undefined;
function groupValidator(): ValidateFunction {
  if (!validator) validator = new Ajv({ allErrors: true, strict: false }).compile(buildGroupSchema());
  return validator;
}

/** Parse + validate one group.yaml into a Group (dir = the manifest's directory). */
export async function loadGroup(file: string, dir: string): Promise<Group> {
  const parsed = parse(await readFile(file, "utf-8"));
  const validate = groupValidator();
  if (!validate(parsed)) {
    const errors = (validate.errors ?? []).map((e) => `  ${e.instancePath || "/"} ${e.message}`).join("\n");
    throw new Error(`Group ${file} failed schema validation:\n${errors}`);
  }
  const g = parsed as { id: string; reset: ResetPolicy; order?: string[] };
  if (g.reset === "none" && !g.order) {
    throw new Error(`Group ${file}: reset: none requires an explicit \`order\` (the chain sequence).`);
  }
  return { id: g.id, reset: g.reset, order: g.order, dir };
}

/**
 * Validate a group's `order` against the base ids of its discovered members:
 * when an order is declared it must be a permutation of the members (no missing,
 * no unknown). reset: none requires an order (already enforced in loadGroup).
 */
export function validateGroupOrder(group: Group, memberBaseIds: readonly string[]): void {
  if (!group.order) return;
  const ordered = new Set(group.order);
  if (ordered.size !== group.order.length) {
    throw new Error(`Group "${group.id}": duplicate id in \`order\`.`);
  }
  const members = new Set(memberBaseIds);
  const unknown = group.order.filter((id) => !members.has(id));
  const missing = memberBaseIds.filter((id) => !ordered.has(id));
  if (unknown.length || missing.length) {
    const parts = [
      unknown.length ? `order lists unknown member(s): ${unknown.join(", ")}` : "",
      missing.length ? `member(s) absent from order: ${missing.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(`Group "${group.id}" order does not match its members — ${parts.join("; ")}.`);
  }
}

/** Position of a member (by base id) in the group's order, or 0 when unordered. */
export function orderIndexOf(group: Group, baseId: string): number {
  if (!group.order) return 0;
  const i = group.order.indexOf(baseId);
  return i < 0 ? 0 : i;
}

/** The base scenario id of a (possibly parameterized) id — strips a `[case]` suffix. */
export function baseScenarioId(id: string): string {
  return id.replace(/\[[^\]]*\]$/, "");
}
