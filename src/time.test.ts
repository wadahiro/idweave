/**
 * Unit: relative-time resolution — deterministic against an injected `now`, no
 * wall clock. Covers the injection point time-control scenarios rely on to seed past dates.
 */
import { describe, it, expect } from "vitest";
import { resolveTimeExpr } from "./time.ts";

// Fixed reference instant: 2026-06-05T12:00:00.000Z.
const NOW = Date.UTC(2026, 5, 5, 12, 0, 0);

describe("resolveTimeExpr", () => {
  it("returns `now` as the injected instant (ISO)", () => {
    expect(resolveTimeExpr("now", NOW)).toBe("2026-06-05T12:00:00.000Z");
  });

  it("subtracts a day-based duration (the 30-day cleanup threshold case)", () => {
    expect(resolveTimeExpr("now-P31D", NOW)).toBe("2026-05-05T12:00:00.000Z");
    expect(resolveTimeExpr("now-P7D", NOW)).toBe("2026-05-29T12:00:00.000Z");
  });

  it("adds a future offset", () => {
    expect(resolveTimeExpr("now+PT1H", NOW)).toBe("2026-06-05T13:00:00.000Z");
  });

  it("is calendar-aware for months/years (honours month lengths)", () => {
    // 2026-06-05 minus 1 month = 2026-05-05 (May has 31 days, but month math is
    // by calendar field, not 30d).
    expect(resolveTimeExpr("now-P1M", NOW)).toBe("2026-05-05T12:00:00.000Z");
    expect(resolveTimeExpr("now-P1Y", NOW)).toBe("2025-06-05T12:00:00.000Z");
  });

  it("combines calendar and time parts (calendar Y/M applied, then a fixed D/H span)", () => {
    // 2026-06-05 −1Y→2025-06-05, −2M→2025-04-05, −10d3h→2025-03-26T09:00.
    expect(resolveTimeExpr("now-P1Y2M10DT3H", NOW)).toBe("2025-03-26T09:00:00.000Z");
  });

  it("tolerates surrounding whitespace and the sign spacing", () => {
    expect(resolveTimeExpr("  now - P1D ", NOW)).toBe("2026-06-04T12:00:00.000Z");
  });

  it("passes non-expressions through unchanged (literals and plain values)", () => {
    expect(resolveTimeExpr("draft", NOW)).toBe("draft");
    expect(resolveTimeExpr("2026-01-01T00:00:00.000Z", NOW)).toBe("2026-01-01T00:00:00.000Z");
    expect(resolveTimeExpr("true", NOW)).toBe("true");
    expect(resolveTimeExpr("", NOW)).toBe("");
  });

  it("throws on a `now±` expression with a malformed duration (authoring error)", () => {
    expect(() => resolveTimeExpr("now-P", NOW)).toThrow(/invalid ISO-8601 duration/);
  });

  describe("format suffix", () => {
    it("yyyyMMddHHmmss (client-cert validity field)", () => {
      expect(resolveTimeExpr("now+P30D|yyyyMMddHHmmss", NOW)).toBe("20260705120000");
    });
    it("yyyy-MM-dd", () => {
      expect(resolveTimeExpr("now|yyyy-MM-dd", NOW)).toBe("2026-06-05");
      expect(resolveTimeExpr("now+P30D | yyyy-MM-dd", NOW)).toBe("2026-07-05");
    });
    it("explicit iso == default", () => {
      expect(resolveTimeExpr("now|iso", NOW)).toBe("2026-06-05T12:00:00.000Z");
    });
    it("a non-now literal containing | passes through unchanged", () => {
      expect(resolveTimeExpr("a|b", NOW)).toBe("a|b");
      expect(resolveTimeExpr("svc|users", NOW)).toBe("svc|users");
    });
    it("throws on an unknown format", () => {
      expect(() => resolveTimeExpr("now|bogus", NOW)).toThrow(/unknown date format/);
    });
  });
});
