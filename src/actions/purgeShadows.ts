/**
 * actions — purge orphan/tombstone shadows by identifier.
 *
 * A deprovisioning clear-focus raw-evicts the shadows in the focus's linkRef, but
 * a shadow that is already UNLINKED — a tombstone left when reconciliation noticed
 * the source entry was removed, or an orphan from an interrupted run — survives it.
 * On the next reconciliation midPoint's ConstraintsChecker then finds TWO objects
 * with the same secondary identifier (the dn on LDAP, the id elsewhere) for one
 * resource object and fails it ("Found more than one object with attribute …").
 * Purging BY IDENTIFIER (not via the focus) clears those leftovers so a re-run
 * reconciles cleanly WITHOUT a whole-environment snapshot-restore.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";

/**
 * Raw-delete shadows by their SECONDARY IDENTIFIER (midPoint puts it in the shadow
 * `name` — for LDAP the entry DN, for a flat resource the bare id), so this is
 * resource-agnostic: a substring search on `name` finds the candidates, then `scope`
 * keeps the purge to ONE resource. The scoping has two shapes because the secondary
 * identifier does:
 *  - a SUBTREE system (LDAP/AD) passes its `containerDn` — the shadow name is a DN, so
 *    its suffix identifies the resource (the bare identifier alone is just the RDN value);
 *  - a FLAT system (csv/scim/…) passes nothing — the name IS the identifier, matched
 *    exactly, so it can't bleed into another resource that happens to share the substring.
 * Returns the count.
 */
export async function purgeShadows(rest: MidpointRest, identifier: string, scope?: string): Promise<number> {
  const shadows = await rest.searchShadowsByNameSubstring(identifier);
  const suffix = scope?.toLowerCase();
  let purged = 0;
  for (const shadow of shadows) {
    const rec = shadow as Record<string, unknown>;
    const name = String(rec["name"] ?? "");
    const match = suffix ? name.toLowerCase().includes(suffix) : name === identifier;
    if (!match) continue;
    await rest.deleteObject("shadows", String(rec["oid"]), true).catch(() => undefined);
    purged++;
  }
  return purged;
}
