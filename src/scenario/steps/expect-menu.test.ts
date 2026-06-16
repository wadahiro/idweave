/**
 * Unit: expect-menu's pure comparison (evaluateMenu) + path formatting + the
 * handler surface (match/token/detail). No running stack, no browser — the set math is the
 * interesting part and is IO-free.
 */
import { describe, it, expect } from "vitest";
import { expectMenuStep, evaluateMenu, formatMenuPath } from "./expect-menu.ts";

const OBSERVED = ["Home", "Users > All users", "Users > New user", "Resources > All resources"];

describe("formatMenuPath", () => {
  it("joins a path root → leaf with ' > '", () => {
    expect(formatMenuPath(["Users", "All users"])).toBe("Users > All users");
    expect(formatMenuPath(["Home"])).toBe("Home");
  });
});

describe("evaluateMenu", () => {
  it("passes when present items are all visible and absent ones are not", () => {
    const f = evaluateMenu(OBSERVED, { present: ["Home", "Users > All users"], absent: ["Server tasks > All tasks"] });
    expect(f).toEqual([]);
  });

  it("reports present items that are missing", () => {
    const f = evaluateMenu(OBSERVED, { present: ["Reports > All reports"] });
    expect(f.join("\n")).toMatch(/ABSENT: Reports > All reports/);
  });

  it("reports absent items that leaked in", () => {
    const f = evaluateMenu(OBSERVED, { absent: ["Users > New user"] });
    expect(f.join("\n")).toMatch(/PRESENT: Users > New user/);
  });

  it("exact: flags both missing and unexpected, order-independent", () => {
    const f = evaluateMenu(OBSERVED, { exact: ["Resources > All resources", "Users > All users", "Users > New user", "Home"] });
    expect(f).toEqual([]); // same set, different order
    const f2 = evaluateMenu(OBSERVED, { exact: ["Home", "Users > All users"] });
    expect(f2.join("\n")).toMatch(/UNEXPECTED: Users > New user, Resources > All resources/);
    const f3 = evaluateMenu(OBSERVED, { exact: [...OBSERVED, "Configuration > Bulk actions"] });
    expect(f3.join("\n")).toMatch(/MISSING: Configuration > Bulk actions/);
  });
});

describe("expect-menu handler", () => {
  it("matches its own declaration and nothing else", () => {
    expect(expectMenuStep.match({ "expect-menu": { as: "administrator", present: ["Home"] } })).toBe(true);
    expect(expectMenuStep.match({ "expect-requestable": { as: "alice" } })).toBe(false);
    expect(expectMenuStep.match(null)).toBe(false);
  });

  it("renders token and a detail naming the principal and modes", () => {
    const step = { "expect-menu": { as: "administrator", present: ["Home"], expected: "expected/menu.json" } };
    expect(expectMenuStep.token(step)).toBe("expect-menu");
    const d = expectMenuStep.detail(step, { suite: {} as never });
    expect(d).toContain("administrator");
    expect(d).toContain("expected/menu.json");
  });
});
