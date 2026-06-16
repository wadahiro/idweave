/**
 * Unit: pollUntil — the bounded-poll primitive, focused on the settled-mismatch
 * fast-fail (returns a converged-but-mismatched value early instead of waiting out
 * the whole timeout). intervalMs:0 keeps the tests instant.
 */
import { describe, it, expect, vi } from "vitest";
import { pollUntil, PollTimeoutError } from "./poll.ts";

const cfg = { timeoutMs: 100_000, intervalMs: 0 };
const settleKey = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

describe("pollUntil settled-mismatch fast-fail", () => {
  it("returns as soon as `done` holds (no fast-fail involved)", async () => {
    const seq = ["a", "a", "b"]; // matches on the 3rd
    const probe = vi.fn(async () => seq.shift());
    const got = await pollUntil(probe, (v) => v === "b", cfg, "b", { settleKey });
    expect(got).toBe("b");
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("fast-fails after `settleProbes` identical non-null mismatches, returning the value", async () => {
    const probe = vi.fn(async () => ({ resource: "x" })); // stable, never matches
    const got = await pollUntil(probe, () => false, cfg, "never", { settleKey, settleProbes: 4 });
    expect(got).toEqual({ resource: "x" });
    expect(probe).toHaveBeenCalledTimes(4); // gave up at the 4th identical read
  });

  it("does NOT fast-fail while the value keeps changing (resets the streak) — times out", async () => {
    let n = 0;
    const probe = vi.fn(async () => ({ n: n++ })); // every read differs
    await expect(
      pollUntil(probe, () => false, { timeoutMs: 30, intervalMs: 0 }, "moving", { settleKey, settleProbes: 3 }),
    ).rejects.toBeInstanceOf(PollTimeoutError);
  });

  it("treats a null value as 'not settled' — no fast-fail on a still-absent projection", async () => {
    const probe = vi.fn(async () => null); // absent forever
    await expect(
      pollUntil(probe, (v) => v !== null, { timeoutMs: 30, intervalMs: 0 }, "absent", { settleKey, settleProbes: 3 }),
    ).rejects.toBeInstanceOf(PollTimeoutError);
    // null keys never accumulate a streak, so it ran to the deadline (not an early return)
    expect(probe.mock.calls.length).toBeGreaterThan(3);
  });

  it("without settleKey, a stable mismatch waits out the full timeout (original behaviour)", async () => {
    const probe = vi.fn(async () => "stable");
    const err = await pollUntil(probe, () => false, { timeoutMs: 25, intervalMs: 0 }, "x").catch((e) => e);
    expect(err).toBeInstanceOf(PollTimeoutError);
    expect((err as PollTimeoutError).lastValue).toBe("stable");
  });
});
