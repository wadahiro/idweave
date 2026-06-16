/**
 * Step: assert a host file's content — typically a deployment task's OUTPUT file
 * (e.g. a restrict-user run's `output-<key>.tsv` result rows). The path resolves
 * against the configured files host dir (or is absolute). A task writes its output
 * asynchronously, so this POLLS until the file appears and matches (eventual
 * consistency, like the other expect oracles).
 *
 * `contains` asserts every listed substring is present (robust to volatile content
 * like the `# START/END <timestamp>` lines the result file wraps rows in — assert
 * the stable per-subject line, e.g. `<user>\t成功`). `absent` asserts the file does
 * not exist or is empty.
 */
import { readHostFile } from "../../actions/files.ts";
import { pollUntil, PollTimeoutError } from "../../poll.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface ExpectFileStep {
  "expect-file": {
    /** Path relative to the files host dir (or absolute). */
    path: string;
    /** Substrings that MUST all be present in the file. */
    contains?: string[];
    /** Assert the file does not exist or is empty. */
    absent?: boolean;
  };
}

/** Missing substrings (empty ⇒ all present). null content ⇒ all missing. */
function missingSubstrings(content: string | null, contains: string[]): string[] {
  if (content === null) return [...contains];
  return contains.filter((c) => !content.includes(c));
}

export const expectFileStep: StepHandler<ExpectFileStep> = {
  kind: "expect-file",
  phase: "assert",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["expect-file"],
    description: "Assert a host file (e.g. a task output file) contains substrings, or is absent. Polls (eventual consistency).",
    properties: {
      "expect-file": {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        oneOf: [{ required: ["contains"] }, { required: ["absent"] }],
        properties: {
          path: { type: "string", description: "Path relative to the files host dir (or absolute)." },
          contains: { type: "array", items: { type: "string" }, description: "Substrings that must all be present." },
          absent: { type: "boolean", description: "Assert the file does not exist or is empty." },
        },
      },
    },
  },

  match(step): step is ExpectFileStep {
    return typeof step === "object" && step !== null && "expect-file" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["expect-file"];
    const read = () => readHostFile(ctx.cfg.files.hostDir, s.path);

    if (s.absent) {
      if (ctx.captureExpected) return;
      const content = await read();
      if (content !== null && content.trim() !== "") {
        throw new Error(`expect-file: "${s.path}" expected ABSENT/empty, but it has content (${content.length} chars).`);
      }
      return;
    }

    if (ctx.captureExpected) return; // contains is a declared assertion, nothing to capture
    const contains = s.contains!;
    const last = await pollUntil(
      read,
      (content) => missingSubstrings(content, contains).length === 0,
      ctx.cfg.poll,
      `file "${s.path}" to contain the expected substrings`,
      { settleKey: (c) => (c === null ? null : String(c.length)) },
    ).catch((e) => (e instanceof PollTimeoutError ? (e.lastValue as string | null) : Promise.reject(e)));
    const missing = missingSubstrings(last, contains);
    if (missing.length) {
      throw new Error(
        `expect-file: "${s.path}" is missing expected substring(s): ${missing.map((m) => JSON.stringify(m)).join(", ")}` +
          (last === null ? " (file not found)" : `.\nFile:\n${last}`),
      );
    }
  },

  token() {
    return "expect-file";
  },

  detail(step) {
    const s = step["expect-file"];
    return `**expect-file** \`${s.path}\` — ${s.absent ? "absent" : `contains ${(s.contains ?? []).length}`}`;
  },
};
