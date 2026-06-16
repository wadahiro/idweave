/**
 * actions: create / tear down a midPoint OrgType — the operator path for standing up a
 * project-root or project org. Creating an org with a deployment-recognized `subtype`
 * lets the running system's Org object template auto-assign the `{subtype}-metarole`, which (for
 * a project org) auto-generates a set of child roles under the org. idweave only
 * DRIVES the create; the existing expect oracles assert the generated end-state.
 */
import type { MidpointRest, MidpointObject } from "../clients/midpointRest.ts";

/** parentOrgRef oids of an object (handles the single-object or array JSON shape). */
function parentOids(o: MidpointObject): string[] {
  const ref = o.parentOrgRef;
  const arr = Array.isArray(ref) ? ref : ref ? [ref] : [];
  return arr.map((r) => String((r as MidpointObject)?.oid ?? "")).filter(Boolean);
}

/**
 * Create an OrgType named `name` with `subtype`, optionally under `parentName`.
 * The parent is attached as an ASSIGNMENT, not a raw `parentOrgRef` — midPoint
 * derives parentOrgRef from the assignment and rejects a bare parentOrgRef as
 * "not allowed by assignments". Returns the new org's oid.
 */
export async function createOrg(
  rest: MidpointRest,
  name: string,
  subtype: string,
  parentName?: string,
): Promise<string> {
  const org: MidpointObject = { name, subtype };
  if (parentName) {
    const parent = (await rest.searchByName("orgs", parentName))[0];
    if (!parent) throw new Error(`create-org: parent org "${parentName}" not found`);
    org.assignment = [{ targetRef: { oid: String(parent.oid), type: "OrgType" } }];
  }
  return rest.addObject("orgs", { org });
}

/**
 * Tear down an org and everything it spawned: the org, its descendant orgs, and all
 * roles parented anywhere in that subtree (the auto-generated project-root/project roles).
 * Deletes via the NORMAL path so provisioned LDAP groups are DEPROVISIONED, not
 * orphaned (we own this subtree end-to-end, so surgical reset is safe here — unlike
 * washing an externally-populated directory). No-op if the org is absent: safe as a
 * precondition reset.
 */
export async function deleteOrgTree(rest: MidpointRest, name: string): Promise<void> {
  const roots = await rest.searchByName("orgs", name);
  if (roots.length === 0) return;

  const [allOrgs, allRoles] = await Promise.all([rest.listObjects("orgs"), rest.listObjects("roles")]);

  // Grow the subtree from the root org(s) by following parentOrgRef downward.
  const subtree = new Set<string>(roots.map((o) => String(o.oid)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of allOrgs) {
      const oid = String(o.oid);
      if (!subtree.has(oid) && parentOids(o).some((p) => subtree.has(p))) {
        subtree.add(oid);
        grew = true;
      }
    }
  }

  // Roles parented into the subtree first (their LDAP groups deprovision on delete).
  for (const r of allRoles) {
    if (parentOids(r).some((p) => subtree.has(p))) await rest.deleteObject("roles", String(r.oid));
  }

  // Then the orgs, leaf-first (a child org before its parent), by leaf elimination.
  const remaining = new Map(allOrgs.filter((o) => subtree.has(String(o.oid))).map((o) => [String(o.oid), o]));
  while (remaining.size) {
    const leaves = [...remaining.values()].filter(
      (o) => ![...remaining.values()].some((c) => c !== o && parentOids(c).includes(String(o.oid))),
    );
    const batch = leaves.length ? leaves : [...remaining.values()]; // safety: break any cycle
    for (const o of batch) {
      await rest.deleteObject("orgs", String(o.oid));
      remaining.delete(String(o.oid));
    }
  }
}
