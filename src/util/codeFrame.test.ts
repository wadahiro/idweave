/** Unit: the scenario.yaml source-excerpt renderer (pure, no running stack). */
import { describe, it, expect } from "vitest";
import { codeFrame } from "./codeFrame.ts";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const SRC = ["a: 1", "b: 2", "c: 3", "d: 4", "e: 5", ""].join("\n");

describe("codeFrame", () => {
  it("renders the line span with a gutter and marks the start line", () => {
    expect(strip(codeFrame(SRC, 2, 4))).toBe(["❯ 2 │ b: 2", "  3 │ c: 3", "  4 │ d: 4"].join("\n"));
  });

  it("trims trailing blank lines inside the span", () => {
    expect(strip(codeFrame(SRC, 4, 6))).toBe(["❯ 4 │ d: 4", "  5 │ e: 5"].join("\n"));
  });

  it("caps the excerpt at maxLines with an ellipsis", () => {
    const out = strip(codeFrame(SRC, 1, 5, { maxLines: 2 }));
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("…");
  });

  it("marks an arbitrary line while showing leading context", () => {
    expect(strip(codeFrame(SRC, 1, 3, { markLine: 3 }))).toBe(
      ["  1 │ a: 1", "  2 │ b: 2", "❯ 3 │ c: 3"].join("\n"),
    );
  });
});
