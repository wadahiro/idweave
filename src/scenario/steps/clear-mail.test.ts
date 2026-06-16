/**
 * Unit: clear-mail handler — passes the configured Mailpit URL and the optional
 * recipient through to the clearMail action. The action itself is mocked (no sink).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { clearMail } = vi.hoisted(() => ({ clearMail: vi.fn(async (_url: string, _to?: string) => {}) }));
vi.mock("../../actions/mail.ts", () => ({ clearMail }));

import { clearMailStep } from "./clear-mail.ts";
import type { RunContext } from "./types.ts";

const ctx = { cfg: { mail: { url: "http://mp/maildev" } } } as unknown as RunContext;

beforeEach(() => clearMail.mockClear());

describe("clear-mail handler", () => {
  it("clears a specific recipient", async () => {
    await clearMailStep.run({ "clear-mail": { to: "x@y" } }, ctx);
    expect(clearMail).toHaveBeenCalledWith("http://mp/maildev", "x@y");
  });

  it("clears the whole sink when `to` is omitted", async () => {
    await clearMailStep.run({ "clear-mail": {} }, ctx);
    expect(clearMail).toHaveBeenCalledWith("http://mp/maildev", undefined);
  });

  it("renders detail for both forms", () => {
    const dc = {} as Parameters<typeof clearMailStep.detail>[1];
    expect(clearMailStep.detail({ "clear-mail": { to: "x@y" } }, dc)).toMatch(/x@y/);
    expect(clearMailStep.detail({ "clear-mail": {} }, dc)).toMatch(/all/);
  });
});
