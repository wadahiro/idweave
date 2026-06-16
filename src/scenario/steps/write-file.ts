/**
 * Step: a PRECONDITION that WRITES a host file a deployment task will read — e.g. an
 * operational task's per-key INPUT file (a list of user IDs to process). The path
 * resolves against the configured files host dir (the deployment's mounted volume),
 * or may be absolute. Content is either `content` (verbatim) or `lines` (joined with
 * newlines + a trailing newline — the natural shape for an ID-per-line input file).
 */
import { writeHostFile } from "../../actions/files.ts";
import type { RunContext, StepHandler } from "./types.ts";

interface WriteFileStep {
  "write-file": {
    /** Path relative to the files host dir (or absolute). */
    path: string;
    /** Verbatim file content. Mutually exclusive with `lines`. */
    content?: string;
    /** Lines written one per line with a trailing newline. Mutually exclusive with `content`. */
    lines?: string[];
  };
}

export const writeFileStep: StepHandler<WriteFileStep> = {
  kind: "write-file",
  phase: "arrange",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["write-file"],
    description: "Precondition: write a host file (task input) under the files host dir (or an absolute path).",
    properties: {
      "write-file": {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        oneOf: [{ required: ["content"] }, { required: ["lines"] }],
        properties: {
          path: { type: "string", description: "Path relative to the files host dir (or absolute)." },
          content: { type: "string", description: "Verbatim file content." },
          lines: { type: "array", items: { type: "string" }, description: "Lines written one per line (trailing newline)." },
        },
      },
    },
  },

  match(step): step is WriteFileStep {
    return typeof step === "object" && step !== null && "write-file" in step;
  },

  async run(step, ctx: RunContext) {
    const s = step["write-file"];
    const content = s.content !== undefined ? s.content : (s.lines ?? []).map((l) => l + "\n").join("");
    await writeHostFile(ctx.cfg.files.hostDir, s.path, content);
  },

  token() {
    return "write-file";
  },

  detail(step) {
    const s = step["write-file"];
    const n = s.content !== undefined ? `${s.content.length} chars` : `${(s.lines ?? []).length} line(s)`;
    return `**write-file** \`${s.path}\` — ${n}`;
  },
};
