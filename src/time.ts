/**
 * env util — resolve a RELATIVE time expression against a caller-supplied "now".
 *
 * Time-control scenarios seed a PAST (or future) timestamp onto a focus/shadow so
 * a scanner task (validity scan, cleanup) picks it up as "threshold already
 * crossed" — WITHOUT moving the server clock (which would dirty audit/metadata and
 * force restores). A literal date would rot across calendar days, so a scenario
 * may write the value relative to now and the engine resolves it at run time:
 *   now            -> the current instant
 *   now-P31D       -> 31 days ago        (ISO-8601 duration after the sign)
 *   now+PT1H       -> in one hour
 *   now-P1Y2M10D   -> calendar-aware (years/months honour real month lengths)
 *
 * Anything that is NOT a `now[±<duration>]` expression is returned UNCHANGED, so
 * ordinary literal values (and non-date properties) pass straight through — a
 * scenario can mix seeded timestamps and plain values in one `set`.
 *
 * `nowMs` is injected (RunContext.now) — this never reads the wall clock, so the
 * resolution is deterministic and unit-testable (by design: no hidden time, the
 * engine's "now" is a single injected point).
 */

// `now` optionally followed by a sign and an offset token; the offset is captured
// loosely (any non-space run) and validated by applyDuration, so a malformed
// `now-…` fails loudly instead of slipping through as a literal.
const NOW_RE = /^now(?:\s*([+-])\s*(\S+))?$/i;
const DUR_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Add an ISO-8601 duration (signed) to a Date, in UTC. Throws on a malformed duration. */
function applyDuration(date: Date, sign: 1 | -1, iso: string): void {
  const m = DUR_RE.exec(iso);
  if (!m || m.slice(1).every((g) => g === undefined)) {
    throw new Error(`invalid ISO-8601 duration in time expression: "${iso}"`);
  }
  const [, y, mo, w, d, h, mi, s] = m.map((g) => (g === undefined ? 0 : Number(g)));
  // Calendar parts first (month-length aware), then a fixed millisecond span.
  if (y) date.setUTCFullYear(date.getUTCFullYear() + sign * y);
  if (mo) date.setUTCMonth(date.getUTCMonth() + sign * mo);
  const ms = (((w! * 7 + d!) * 24 + h!) * 60 + mi!) * 60_000 + s! * 1000;
  date.setTime(date.getTime() + sign * ms);
}

/** Format a UTC Date for a target field. Default ISO; some systems want other shapes. */
function formatDate(date: Date, fmt: string): string {
  const iso = date.toISOString(); // yyyy-MM-ddTHH:mm:ss.sssZ
  switch (fmt) {
    case "iso":
      return iso;
    case "yyyy-MM-dd":
      return iso.slice(0, 10);
    case "yyyyMMddHHmmss": // e.g. a client-cert validity field (UTC, no separators)
      return iso.slice(0, 19).replace(/[-:T]/g, "");
    default:
      throw new Error(`unknown date format "${fmt}" in time expression (use iso | yyyy-MM-dd | yyyyMMddHHmmss)`);
  }
}

/**
 * Resolve a single value: if it is a `now[±<ISO-8601 duration>]` expression,
 * return the corresponding dateTime; otherwise return it verbatim. A `now±` with a
 * malformed duration throws (a scenario authoring error should fail loudly).
 *
 * An optional `|<format>` suffix picks the output shape for systems that don't use
 * ISO — e.g. `now+P30D|yyyyMMddHHmmss` (a client-cert end-date) or `now|yyyy-MM-dd`.
 * Default is ISO. The suffix only applies to a `now…` expression; any other literal
 * (even one containing `|`) passes through unchanged.
 */
export function resolveTimeExpr(value: string, nowMs: number): string {
  let expr = value.trim();
  let fmt = "iso";
  const pipe = /^(now.*?)\s*\|\s*([\w-]+)\s*$/i.exec(expr);
  if (pipe) {
    expr = pipe[1]!;
    fmt = pipe[2]!;
  }
  const m = NOW_RE.exec(expr);
  if (!m) return value;
  const date = new Date(nowMs);
  if (m[1] && m[2]) applyDuration(date, m[1] === "-" ? -1 : 1, m[2]);
  return formatDate(date, fmt);
}
