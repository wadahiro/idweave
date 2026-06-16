/**
 * verify — cross-system CONSISTENCY: assert a target value (an LDAP attribute or a DB
 * column) equals a transform of a midPoint focus property, rather than a static
 * golden. The value is typically volatile (a random server-assigned id), so there is
 * no fixed expected — instead the engine DERIVES it from the focus at run time and,
 * on a SET-equal match (order-independent, de-duplicated), collapses the value to a
 * self-documenting token; a mismatch leaves the actual value, which then diffs.
 *
 * Used by both targets so the SAME declarative `consistentWith` works for ldap and
 * db. The TRANSFORM is grouped under a method key (currently `fields`; e.g. a future
 * `regex` slots in beside it without touching existing rules — the idweave
 * discriminated-key idiom, like csv/ldap/db systems).
 */
import type { MidpointRest } from "../clients/midpointRest.ts";

/**
 * Field-split transform: split each `from` value by `delimiter` into positional
 * fields, then build the derived value with `format`. `format` references fields by
 * NAME (`{a}`) when `names` is given (self-documenting), else by 0-based INDEX
 * (`{0}`); literals pass through. E.g. `a/b/c` with delimiter `/`,
 * names `[a, b, c]`, format `{a}/{b}`.
 */
export interface DelimitedTransform {
  delimiter: string;
  names?: string[];
  format: string;
}

export interface ConsistencyRule {
  /** Focus property path to derive the expected value(s) from (multi-value supported). */
  from: string;
  /**
   * Use ONLY when the target system can't store multiple values natively and packs
   * them into a SINGLE field joined by this separator (e.g. a custom
   * attribute holding `a,b`) — the string is split into a set before the
   * comparison. A genuinely multi-valued attribute (an LDAP multi-value attribute is
   * already an array) does NOT need this. Either way the comparison is a SET.
   */
  listSeparator?: string;
  /**
   * Transform METHOD — exactly one, named by its KEY (externally tagged, like the
   * system protocols). `delimited` = split-and-format; a future `regex` slots in
   * beside it without touching existing rules.
   */
  delimited?: DelimitedTransform;
}

/** The self-documenting token a CONSISTENT value collapses to. */
export function consistencyToken(from: string): string {
  return `<consistent:${from}>`;
}

const uniqSort = (xs: string[]): string[] => [...new Set(xs)].sort();

/**
 * Apply the delimited split-and-format transform to one source value. `extra`
 * supplies named substitutions that take precedence over the split fields — e.g.
 * the `derive-focus` step injects a resolved `{time}` so the same format can mix
 * source fields and a seeded date (`{a}/{b}:{time}`).
 */
export function applyDelimited(value: string, t: DelimitedTransform, extra?: Record<string, string>): string {
  const parts = value.split(t.delimiter);
  return t.format.replace(/\{([^}]+)\}/g, (_m, key: string) => {
    if (extra && key in extra) return extra[key]!;
    if (t.names) {
      const i = t.names.indexOf(key);
      if (i >= 0) return parts[i] ?? "";
    }
    const n = Number(key);
    return Number.isInteger(n) && n >= 0 ? (parts[n] ?? "") : "";
  });
}

/** Derive the expected value from one source value via the rule's transform method. */
function derive(value: string, rule: ConsistencyRule): string {
  if (rule.delimited) return applyDelimited(value, rule.delimited);
  throw new Error("consistentWith: no transform method declared (expected `delimited`)");
}

/**
 * Compare the actual target value-SET to the focus values transformed by the rule.
 * On a set-equal match return the token; otherwise return the actual value (so it
 * diffs). Order-independent and de-duplicated. Absent actual -> undefined.
 */
export function checkConsistency(
  actual: string | string[] | undefined,
  focusValues: string[],
  rule: ConsistencyRule,
): string | string[] | undefined {
  // Absent OR empty actual -> undefined (caller drops the key). An empty value is
  // "no value", never "consistent" with the focus — without this, an empty target
  // attribute and an empty focus would spuriously match (both empty sets) and emit
  // the consistency token for something that is actually absent.
  if (actual === undefined || (Array.isArray(actual) && actual.length === 0) || actual === "") return undefined;
  const derived = uniqSort(focusValues.map((v) => derive(v, rule)));
  const actualSet = rule.listSeparator
    ? uniqSort(String(actual).split(rule.listSeparator))
    : uniqSort(Array.isArray(actual) ? actual : [String(actual)]);
  const equal = actualSet.length === derived.length && actualSet.every((v, i) => v === derived[i]);
  return equal ? consistencyToken(rule.from) : actual;
}

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const readPath = (obj: unknown, path: string): unknown =>
  path.split("/").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Read a focus user's property values (multi-value -> array of strings; absent -> []). */
export async function readFocusValues(rest: MidpointRest, identifier: string, path: string): Promise<string[]> {
  const found = await rest.searchByName("users", identifier);
  if (found.length === 0) return [];
  return asArray(readPath(found[0], path)).map(String);
}

/**
 * Apply every `consistentWith` entry to a projected record IN PLACE: read the focus,
 * check consistency, collapse a match to the token (or leave/delete the actual).
 * Shared by the ldap and db targets.
 */
export async function applyConsistency(
  rest: MidpointRest,
  record: Record<string, unknown>,
  identifier: string,
  consistentWith: Record<string, ConsistencyRule>,
): Promise<void> {
  for (const [key, rule] of Object.entries(consistentWith)) {
    const focusValues = await readFocusValues(rest, identifier, rule.from);
    const v = checkConsistency(record[key] as string | string[] | undefined, focusValues, rule);
    if (v === undefined) delete record[key];
    else record[key] = v;
  }
}
