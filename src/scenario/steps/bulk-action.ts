/**
 * Step: run a midPoint bulk-action (`<executeScript>` scripting object) — the
 * operator's entry point for one-off bulk work that isn't a registered task
 * (一括 manager 変更 / 棚卸し出力 / 組織ツリー出力 など). Primary form is
 * `{file}`, a reference to the REAL deployed BulkAction XML (so the test drives
 * the actual operational artifact); `{xml}` carries an ad-hoc script inline.
 *
 * This is an ACTION, not an assertion: it runs in capture mode too, so the
 * downstream `expect` / `expect-file` / `expect-mail` oracles see (and capture)
 * the post-run state. The script's EFFECT is asserted by those steps — this step
 * only drives it and fails fast on a fatal_error result (via clients).
 *
 * Gotcha (in the XML, not here): a midPoint `execute-script` action runs ONCE PER
 * INPUT ITEM by default, so a STANDALONE script (no preceding search/pipe → empty
 * input) runs its body ZERO times and silently no-ops (status still `success`).
 * Add `<s:parameter><s:name>forWholeInput</s:name><c:value>true</c:value></s:parameter>`
 * to the action so the body runs once regardless of input.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runBulkAction } from "../../actions/bulkAction.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface BulkActionStep {
  "bulk-action": {
    /** Path (relative to the scenario dir) to an `<executeScript>` XML file. */
    file?: string;
    /** Inline `<executeScript>` XML, for an ad-hoc script. */
    xml?: string;
  };
}

export const bulkActionStep: StepHandler<BulkActionStep> = {
  kind: "bulk-action",
  phase: "act",
  appliesTo: ["midpoint"],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["bulk-action"],
    description: "Run a midPoint bulk-action (executeScript) — a deployed BulkAction XML file or an inline script.",
    properties: {
      "bulk-action": {
        type: "object",
        additionalProperties: false,
        oneOf: [{ required: ["file"] }, { required: ["xml"] }],
        properties: {
          file: { type: "string", description: "Path (relative to the scenario dir) to an <executeScript> XML file." },
          xml: { type: "string", description: "Inline <executeScript> XML (ad-hoc script)." },
        },
      },
    },
  },

  match(step): step is BulkActionStep {
    return typeof step === "object" && step !== null && "bulk-action" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["bulk-action"];
    const xml = s.file !== undefined ? await readFile(resolve(ctx.scenarioDir, s.file), "utf8") : s.xml!;
    await runBulkAction(ctx.rest, xml);
  },

  token() {
    return "bulk-action";
  },

  detail(step) {
    const s = step["bulk-action"];
    return `**bulk-action** ${s.file !== undefined ? `\`${s.file}\`` : "inline script"}`;
  },
};
