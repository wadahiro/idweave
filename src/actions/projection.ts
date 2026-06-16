/**
 * actions — projection (shadow) repo actions used as scenario PRECONDITIONS.
 *
 * `deriveShadow` is the shadow-side twin of `deriveFocus`: it read-transform-writes
 * a SHADOW's own attribute/identifier (raw repo write), locating the shadow by its
 * OWNER focus and the RESOURCE it lives on — because a provisioned shadow's name is
 * minted at run time (a server-assigned identifier), so the harness can't name it
 * literally.
 *
 * Typical use: a date a scheduled task acts on is frozen at provisioning time into
 * the shadow's identifier and propagated to the focus by a STRONG inbound. To
 * simulate "now near/at the threshold" WITHOUT moving the clock we must rewind that
 * date at its SOURCE — the shadow — so (a) the task reads a consistent value, (b) the
 * inbound doesn't overwrite the focus back to the original future date on recompute,
 * and (c) any connector decision that reads the stored date behaves as in production.
 * The focus and DB layers are rewound by `derive-focus` and `db-mutate` to the SAME
 * instant (frozen `now`).
 */
import type { MidpointRest } from "../clients/midpointRest.ts";

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const readPath = (obj: unknown, path: string): unknown =>
  path.split("/").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );

/**
 * Read-transform-write a SHADOW's value across one or more `targets`. Finds the
 * owner's shadow(s) on `resource` (by linkRef → resourceRef match), reads the
 * (multi-value) `source` path, maps each value through `transform`, and REPLACEs each
 * `targets` path with the derived value — so a single derived end-date can be written
 * to BOTH the denormalized `primaryIdentifierValue` and the `attributes/<uid>` that
 * carry it. `raw` writes the repository directly (no recompute/provisioning): the
 * rewind itself does not act, the scheduled task under test does.
 *
 * Throws if the owner, the resource, or a matching shadow is absent (a precondition
 * expects the journey already provisioned the projection). Returns the derived values.
 */
export async function deriveShadow(
  rest: MidpointRest,
  owner: string,
  resource: string,
  source: string,
  targets: string[],
  transform: (sourceValue: string) => string,
  opts: { raw?: boolean } = {},
): Promise<string[]> {
  const users = await rest.searchByName("users", owner);
  if (users.length === 0) throw new Error(`derive-shadow: user "${owner}" not found`);
  const resources = await rest.searchByName("resources", resource);
  if (resources.length === 0) throw new Error(`derive-shadow: resource "${resource}" not found`);
  const resourceOid = String((resources[0] as Record<string, unknown>)["oid"]);

  const linkRefs = asArray((users[0] as Record<string, unknown>)["linkRef"]);
  const derivedAll: string[] = [];
  let matched = 0;
  for (const link of linkRefs) {
    const shadowOid = String((link as Record<string, unknown>)["oid"]);
    const shadow = await rest.getObject("shadows", shadowOid, true);
    if (!shadow) continue;
    const rr = (shadow["resourceRef"] as Record<string, unknown> | undefined)?.["oid"];
    if (String(rr) !== resourceOid) continue;
    matched++;
    const values = asArray(readPath(shadow, source)).map(String);
    if (values.length === 0) throw new Error(`derive-shadow: shadow ${shadowOid} has no value at "${source}"`);
    const derived = values.map(transform);
    const value: unknown = derived.length === 1 ? derived[0] : derived;
    const itemDelta = targets.map((path) => ({ modificationType: "replace", path, value }));
    await rest.modifyObject("shadows", shadowOid, itemDelta, { raw: opts.raw ?? true });
    derivedAll.push(...derived);
  }
  if (matched === 0) throw new Error(`derive-shadow: user "${owner}" has no shadow on resource "${resource}"`);
  return derivedAll;
}
