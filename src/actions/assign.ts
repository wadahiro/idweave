/**
 * actions — assignment domain actions.
 *
 * Granting a role to a user is provisioning-triggering: midPoint constructs the
 * induced target accounts (outbound). Verification of the resulting external
 * state lives in verify.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";

/** Resolve a user by name to its oid (or null if absent). */
export async function userOidByName(rest: MidpointRest, name: string): Promise<string | null> {
  const users = await rest.searchByName("users", name);
  if (users.length === 0) return null;
  return String((users[0] as Record<string, unknown>)["oid"]);
}

/** Resolve a role by name to its oid. Throws if not exactly one match. */
export async function resolveRoleOid(rest: MidpointRest, roleName: string): Promise<string> {
  const roles = await rest.searchByName("roles", roleName);
  if (roles.length !== 1) {
    throw new Error(`Expected exactly one role named "${roleName}", found ${roles.length}`);
  }
  return String((roles[0] as Record<string, unknown>)["oid"]);
}

/** Assign a role to a user (adds an assignment; runs provisioning). */
export async function assignRole(
  rest: MidpointRest,
  userOid: string,
  roleOid: string,
): Promise<void> {
  await rest.modifyObject("users", userOid, [
    {
      modificationType: "add",
      path: "assignment",
      value: { targetRef: { oid: roleOid, type: "RoleType" } },
    },
  ]);
}

/** Short relation name → midPoint relation URI (used by `assign`'s `relation:`). */
const RELATION_URI: Record<string, string> = {
  default: "http://midpoint.evolveum.com/xml/ns/public/common/org-3#default",
  member: "http://midpoint.evolveum.com/xml/ns/public/common/org-3#default",
  manager: "http://midpoint.evolveum.com/xml/ns/public/common/org-3#manager",
  owner: "http://midpoint.evolveum.com/xml/ns/public/common/org-3#owner",
  approver: "http://midpoint.evolveum.com/xml/ns/public/common/org-3#approver",
};

/** Resolve a name to a role OR org assignment target (tries role first, then org). */
export async function resolveTargetRef(
  rest: MidpointRest,
  name: string,
): Promise<{ oid: string; type: "RoleType" | "OrgType" }> {
  const roles = await rest.searchByName("roles", name);
  if (roles.length === 1) return { oid: String((roles[0] as Record<string, unknown>)["oid"]), type: "RoleType" };
  const orgs = await rest.searchByName("orgs", name);
  if (orgs.length === 1) return { oid: String((orgs[0] as Record<string, unknown>)["oid"]), type: "OrgType" };
  throw new Error(`Expected exactly one role or org named "${name}" (roles: ${roles.length}, orgs: ${orgs.length})`);
}

/**
 * Assign a target (role or org) to a user with an optional RELATION, e.g. make a
 * user the `manager` of an org (an org's manager-relation member becomes the
 * approver of requests for that org's roles). Omit `relation` for a plain member.
 */
export async function assignTargetWithRelation(
  rest: MidpointRest,
  userOid: string,
  ref: { oid: string; type: "RoleType" | "OrgType" },
  relation?: string,
): Promise<void> {
  const targetRef: Record<string, unknown> = { oid: ref.oid, type: ref.type };
  if (relation) targetRef["relation"] = RELATION_URI[relation] ?? relation;
  await rest.modifyObject("users", userOid, [
    { modificationType: "add", path: "assignment", value: { targetRef } },
  ]);
}

/**
 * Locate the assignment on a user that targets a given role, and return its PCV
 * container id (the reliable handle for a delta). The id key is "@id" in 4.4+ JSON
 * but plain "id" in 4.0 — echo back whichever the representation carries. Throws
 * with `what` (the calling intent) when the user is absent or has no such assignment.
 */
async function findAssignmentId(
  rest: MidpointRest,
  userOid: string,
  roleOid: string,
  what: string,
): Promise<{ idKey: "@id" | "id"; containerId: unknown }> {
  const user = await rest.getObject("users", userOid);
  if (!user) throw new Error(`Cannot ${what}: user ${userOid} not found`);
  const raw = (user as Record<string, unknown>)["assignment"];
  const assignments = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
  const match = assignments.find(
    (a) => (a?.["targetRef"] as Record<string, unknown> | undefined)?.["oid"] === roleOid,
  );
  const idKey: "@id" | "id" = match?.["@id"] !== undefined ? "@id" : "id";
  const containerId = match?.[idKey];
  if (containerId === undefined) {
    throw new Error(`No assignment of role ${roleOid} found on user ${userOid} to ${what}`);
  }
  return { idKey, containerId };
}

/**
 * Unassign a role from a user: delete the assignment whose targetRef points at
 * the role (matched by container @id, the reliable handle), which runs
 * deprovisioning of the induced target accounts (the access-revocation path).
 */
export async function unassignRole(
  rest: MidpointRest,
  userOid: string,
  roleOid: string,
): Promise<void> {
  const { idKey, containerId } = await findAssignmentId(rest, userOid, roleOid, "unassign");
  await rest.modifyObject("users", userOid, [
    { modificationType: "delete", path: "assignment", value: { [idKey]: containerId } },
  ]);
}

/**
 * Unassign EVERY direct role assignment whose target role NAME starts with
 * `rolePrefix` — a re-runnable reset that clears a shared user's accumulated
 * role grants in one step (so a scenario asserting that user's full
 * assignment set is order/history-independent without enumerating each role).
 * Only RoleType assignments are considered, so the archetype, main org, and other
 * baseline assignments are untouched. Returns how many were removed.
 */
export async function unassignMatchingRoles(rest: MidpointRest, userOid: string, rolePrefix: string): Promise<number> {
  const user = await rest.getObject("users", userOid);
  if (!user) return 0;
  const raw = (user as Record<string, unknown>)["assignment"];
  const assignments = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
  const deltas: Array<{ modificationType: string; path: string; value: unknown }> = [];
  for (const a of assignments) {
    const tr = a["targetRef"] as Record<string, unknown> | undefined;
    if (!tr || !String(tr["type"] ?? "").endsWith("RoleType") || typeof tr["oid"] !== "string") continue;
    const role = await rest.getObject("roles", tr["oid"]);
    if (!String((role as Record<string, unknown> | null)?.["name"] ?? "").startsWith(rolePrefix)) continue;
    const idKey: "@id" | "id" = a["@id"] !== undefined ? "@id" : "id";
    if (a[idKey] === undefined) continue;
    deltas.push({ modificationType: "delete", path: "assignment", value: { [idKey]: a[idKey] } });
  }
  if (deltas.length) await rest.modifyObject("users", userOid, deltas);
  return deltas.length;
}

/**
 * Seed an existing assignment's validity (validFrom/validTo) — found by the role
 * it targets. A time-control PRECONDITION: with `raw`, this writes the repository
 * directly so the seed itself does NOT recompute the assignment's effectiveStatus;
 * the membership stays live until the Validity Scanner runs and flips it. Seeding
 * `validTo` into the PAST is what makes that scanner disable it (and then the
 * "unassign expired roles" task delete it). The PCV id segments the item path in
 * BRACKETS — `assignment[<id>]/activation/validTo` (a bare `assignment/<id>/…`
 * parses the id as an item name and 400s); intermediate containers are created.
 */
export async function setAssignmentValidity(
  rest: MidpointRest,
  userOid: string,
  roleOid: string,
  validity: { validFrom?: string; validTo?: string },
  opts: { raw?: boolean } = {},
): Promise<void> {
  const { containerId } = await findAssignmentId(rest, userOid, roleOid, "set validity");
  const base = `assignment[${containerId}]/activation`;
  const itemDelta: Array<{ modificationType: string; path: string; value?: unknown }> = [];
  if (validity.validFrom !== undefined) {
    itemDelta.push({ modificationType: "replace", path: `${base}/validFrom`, value: validity.validFrom });
  }
  if (validity.validTo !== undefined) {
    itemDelta.push({ modificationType: "replace", path: `${base}/validTo`, value: validity.validTo });
  }
  if (itemDelta.length === 0) throw new Error("setAssignmentValidity: nothing to set (validFrom/validTo)");
  await rest.modifyObject("users", userOid, itemDelta, { raw: opts.raw });
}
