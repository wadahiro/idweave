/**
 * Bounded polling — the ONLY waiting primitive in the harness.
 *
 * by design: there are no `sleep`-and-assume-done waits anywhere. Asynchronous
 * completion is detected by polling a condition until it holds or a deadline is
 * hit. The inter-poll delay below is the polling mechanism, not a guessed wait.
 */
import type { PollConfig } from "./config.ts";

export class PollTimeoutError extends Error {
  constructor(
    message: string,
    readonly lastValue: unknown,
  ) {
    super(message);
    this.name = "PollTimeoutError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Optional behaviours layered onto {@link pollUntil}. */
export interface PollOptions<T> {
  /**
   * Settled-mismatch FAST-FAIL. A waiting-for-MATCH poll otherwise burns the whole
   * timeout when the value will never converge (e.g. an expected file pinned to a
   * different state than this point produces). `settleKey` returns a stable-state
   * key for a value (null = "not settled yet", e.g. a still-absent projection —
   * resets the streak). When the key is non-null and UNCHANGED across `settleProbes`
   * consecutive probes while `done` is still false, the value has converged on a
   * mismatch, so `pollUntil` RETURNS that last value early (the caller renders the
   * field-level diff) instead of waiting out the deadline. Omit to keep waiting the
   * full timeout (the original behaviour).
   */
  settleKey?: (value: T) => string | null;
  /** Consecutive identical `settleKey` probes that count as "settled" (default 10). */
  settleProbes?: number;
}

/**
 * Repeatedly call `probe` until `done` returns true, then resolve with the last
 * probed value. Throws {@link PollTimeoutError} if the deadline passes first.
 *
 * With `opts.settleKey`, a mismatch that has SETTLED (see {@link PollOptions}) is
 * returned early rather than waited out — so a wrong-expected assert fails in
 * seconds with its diff instead of stalling for the whole timeout.
 *
 * @param describe label used in the timeout message (what we were waiting for).
 */
export async function pollUntil<T>(
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  cfg: PollConfig,
  describe: string,
  opts: PollOptions<T> = {},
): Promise<T> {
  const deadline = Date.now() + cfg.timeoutMs;
  const settleProbes = opts.settleProbes ?? 10;
  let last: T;
  let streakKey: string | null = null;
  let streak = 0;
  for (;;) {
    last = await probe();
    if (done(last)) return last;
    // Settled-mismatch fast-fail: a non-null value identical across `settleProbes`
    // consecutive probes has converged — if it still isn't `done`, it never will be.
    if (opts.settleKey) {
      const key = opts.settleKey(last);
      if (key !== null && key === streakKey) {
        if (++streak >= settleProbes) return last;
      } else {
        streakKey = key;
        streak = key === null ? 0 : 1;
      }
    }
    if (Date.now() >= deadline) {
      throw new PollTimeoutError(
        `Timed out after ${cfg.timeoutMs}ms waiting for: ${describe}`,
        last,
      );
    }
    await delay(cfg.intervalMs);
  }
}
