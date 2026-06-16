/**
 * actions — focus repo actions used as scenario PRECONDITIONS, to put a midPoint focus
 * into a known un-run state so a journey is repeatable: revert a property (e.g.
 * lifecycleState back to draft/proposed) and/or clear its password, or delete a
 * focus the journey creates. Declarative setup over REST — not assertions.
 */
import type { MidpointRest } from "../clients/midpointRest.ts";
import type { ObjectType } from "../scenario/steps/types.ts";

/**
 * What `set-focus` can target. Beyond the focus types, `shadow` lets a
 * precondition seed a directory account's own raw properties (e.g. a date that is
 * also part of the shadow's naming attribute) — found by name = its DN.
 */
export type SetFocusType = ObjectType | "shadow";

const COLLECTION: Record<SetFocusType, string> = {
  user: "users",
  role: "roles",
  org: "orgs",
  service: "services",
  shadow: "shadows",
};

/**
 * Modify a focus found by name: REPLACE each `set` property with its value, and
 * optionally reset its password. Throws if the focus is absent (a precondition
 * expects it to exist).
 *
 * `clearPassword` removes the password so the focus is un-activated again. The delta
 * MUST target the value path `credentials/password/value` (replace with empty), NOT
 * the container `credentials/password`:
 *  - replacing the value clears the repo password AND fires the resource's password
 *    outbound mapping (whose source is `credentials/password/value`), so the directory
 *    account's password is actually removed too — the same secondary delta the GUI
 *    produces (LDAP userPassword + x-pwdChangeTime). A later "set the same password"
 *    then passes (no `historyLength=1` "recently used").
 *  - replacing/deleting the whole container instead clears the repo value but does
 *    NOT trigger that mapping, leaving the old LDAP password bindable. (And a plain
 *    `delete credentials/password` REST mod is a silent no-op: the value stays.)
 */
export async function setFocus(
  rest: MidpointRest,
  type: SetFocusType,
  name: string,
  set: Record<string, string>,
  opts: { clearPassword?: boolean; raw?: boolean } = {},
): Promise<void> {
  const collection = COLLECTION[type];
  const found = await rest.searchByName(collection, name);
  if (found.length === 0) throw new Error(`set-focus: ${type} "${name}" not found`);
  const oid = String((found[0] as Record<string, unknown>)["oid"]);
  const itemDelta: Array<{ modificationType: string; path: string; value?: unknown }> = Object.entries(set).map(
    ([path, value]) => ({ modificationType: "replace", path, value }),
  );
  // Replace the VALUE (not the container) with empty: clears the repo password AND
  // fires the resource password outbound mapping → the LDAP password is removed too.
  if (opts.clearPassword) itemDelta.push({ modificationType: "replace", path: "credentials/password/value" });
  // `raw` seeds the repository directly (no recompute/provisioning) — used to plant
  // a past timestamp the scanner-under-test will later act on; see modifyObject.
  await rest.modifyObject(collection, oid, itemDelta, { raw: opts.raw });
}

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const readPath = (obj: unknown, path: string): unknown =>
  path.split("/").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );

/**
 * Read a focus's `oid` and the (multi-value) string values at `source`. Throws if
 * the focus is absent (a precondition expects it to exist). Shared by the
 * read-transform-write and capture verbs below.
 */
export async function readFocusProperty(
  rest: MidpointRest,
  type: SetFocusType,
  name: string,
  source: string,
): Promise<{ oid: string; values: string[] }> {
  const found = await rest.searchByName(COLLECTION[type], name);
  if (found.length === 0) throw new Error(`focus ${type} "${name}" not found`);
  const obj = found[0] as Record<string, unknown>;
  return { oid: String(obj["oid"]), values: asArray(readPath(obj, source)).map(String) };
}

/**
 * Read-transform-write a focus property: read the (multi-value) `source` property,
 * map each value through `transform`, and REPLACE the `target` property with the
 * derived set. The point is to seed a value DERIVED from a runtime value the harness
 * can't know in advance — e.g. a server-assigned identifier minted at provisioning
 * time — so a scheduled/scanner task under test then acts on it.
 *
 * `raw` writes the repository directly (no recompute/provisioning): the seed itself
 * does not trigger the effect, the task under test does. Returns the derived values.
 * Throws if the focus is absent or has no value at `source` (a precondition that the
 * journey already produced the source state — e.g. the account was already provisioned).
 */
export async function deriveFocus(
  rest: MidpointRest,
  type: SetFocusType,
  name: string,
  source: string,
  target: string,
  transform: (sourceValue: string) => string,
  opts: { raw?: boolean } = {},
): Promise<string[]> {
  const { oid, values } = await readFocusProperty(rest, type, name, source);
  if (values.length === 0) throw new Error(`derive-focus: ${type} "${name}" has no value at "${source}"`);
  const derived = values.map(transform);
  await rest.modifyObject(COLLECTION[type], oid, [{ modificationType: "replace", path: target, value: derived }], {
    raw: opts.raw,
  });
  return derived;
}
