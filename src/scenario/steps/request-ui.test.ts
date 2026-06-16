/**
 * Unit: request-ui's validity SCOPE guard — no running stack. Validity is set at ONE scope
 * per request: request-level (BULK, one window for all items) OR per-item
 * (PER-ROLE), never both (combining isn't portable — the bulk silently wins on
 * both new-UI versions). The guard runs before any UI is touched, so a bare fake
 * RunContext exercises it.
 */
import { describe, it, expect } from "vitest";
import { requestUiStep } from "./request-ui.ts";
import type { RunContext } from "./types.ts";

const ctx = {} as RunContext;

describe("request-ui validity scope guard", () => {
  it("rejects a request that sets BOTH request-level (bulk) and item-level validity", async () => {
    const step = {
      "request-ui": {
        as: "carol",
        validFrom: "2030-01-02",
        validTo: "2030-12-31",
        items: [{ access: "Catalog App Access", validFrom: "2031-01-01" }],
      },
    };
    await expect(requestUiStep.run(step, ctx)).rejects.toThrow(/not both/);
  });

  it("does not trip the guard for request-level (bulk) validity alone", async () => {
    // Past the guard it reaches the UI driver and fails for an UNRELATED reason
    // (the bare ctx has no `ui`/`cfg`), so it must NOT throw the scope message.
    const step = { "request-ui": { as: "carol", validFrom: "2030-01-02", items: [{ access: "Catalog App Access" }] } };
    await expect(requestUiStep.run(step, ctx)).rejects.not.toThrow(/not both/);
  });

  it("does not trip the guard for per-item validity alone", async () => {
    const step = {
      "request-ui": { as: "carol", items: [{ access: "Catalog App Access", validFrom: "2030-01-02" }] },
    };
    await expect(requestUiStep.run(step, ctx)).rejects.not.toThrow(/not both/);
  });
});
