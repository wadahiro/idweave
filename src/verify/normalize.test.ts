/** Unit: applyMask — replace volatile project-declared paths with a stable token. */
import { describe, it, expect } from "vitest";
import { applyMask, MASK_TOKEN } from "./normalize.ts";

describe("applyMask", () => {
  it("masks a nested path's value, leaving siblings intact", () => {
    const obj = { extension: { externalRef: "15/uuid/fp/dates", company: "テスト会社" } };
    applyMask(obj, ["extension/externalRef"]);
    expect(obj).toEqual({ extension: { externalRef: MASK_TOKEN, company: "テスト会社" } });
  });

  it("masks multiple paths", () => {
    const obj = { a: { b: "x" }, c: "y" };
    applyMask(obj, ["a/b", "c"]);
    expect(obj).toEqual({ a: { b: MASK_TOKEN }, c: MASK_TOKEN });
  });

  it("is a no-op for an absent path", () => {
    const obj = { a: { b: "x" } };
    applyMask(obj, ["a/missing", "x/y/z"]);
    expect(obj).toEqual({ a: { b: "x" } });
  });

  it("does not descend into arrays", () => {
    const obj = { a: [{ b: "x" }] };
    applyMask(obj, ["a/b"]);
    expect(obj).toEqual({ a: [{ b: "x" }] }); // unchanged — `a` is an array, not an object map
  });
});
