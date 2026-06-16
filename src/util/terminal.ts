/**
 * Terminal helpers (pure). Kept out of error messages so JUnit/CTRF artifacts
 * stay free of escape codes — only console-facing output uses these.
 */

/** OSC 8 hyperlink. Falls back to plain text when not a TTY. */
export function hyperlink(label: string, url: string, isTty: boolean): string {
  if (!isTty) return label;
  const ESC = "\x1b";
  const BEL = "\x07";
  const open = `${ESC}]8;;${url}${BEL}`;
  const close = `${ESC}]8;;${BEL}`;
  return `${open}${label}${close}`;
}

/** Make a filesystem path clickable (file:// URL) when on a TTY. */
export function fileLink(path: string, isTty: boolean): string {
  return hyperlink(path, `file://${path}`, isTty);
}
