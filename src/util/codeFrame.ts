/**
 * A source excerpt rendered like a compiler/test code frame — but for the
 * scenario.yaml step that failed, so a developer sees the offending declaration
 * inline (not just a line number). The shown span [fromLine, toLine] can be
 * wider than the marked line (`markLine`), so the immediately preceding step can
 * appear as leading context. Trailing blank lines are trimmed and the span is
 * capped (keeping the marked line visible). Colors auto-disable off a TTY /
 * under NO_COLOR (picocolors), so piping to a file or CI log yields plain text.
 */
import pc from "picocolors";

export function codeFrame(
  source: string,
  fromLine: number,
  toLine: number,
  opts: { markLine?: number; maxLines?: number } = {},
): string {
  const maxLines = opts.maxLines ?? 16;
  const lines = source.split("\n");
  let from = Math.max(1, fromLine);
  let to = Math.min(lines.length, Math.max(from, toLine));
  while (to > from && (lines[to - 1] ?? "").trim() === "") to--; // trim trailing blanks
  const mark = opts.markLine ?? from;
  let truncated = false;
  if (to - from + 1 > maxLines) {
    // Keep a window that still includes the marked line.
    from = Math.max(from, Math.min(mark - 3, to - maxLines + 1));
    to = Math.min(to, from + maxLines - 1);
    truncated = true;
  }
  const gutterW = String(to).length;
  const out: string[] = [];
  for (let ln = from; ln <= to; ln++) {
    const marker = ln === mark ? pc.red("❯") : " ";
    const gutter = pc.dim(`${String(ln).padStart(gutterW)} │`);
    out.push(`${marker} ${gutter} ${lines[ln - 1] ?? ""}`);
  }
  if (truncated) out.push(`  ${pc.dim(`${" ".repeat(gutterW)} │ …`)}`);
  return out.join("\n");
}
