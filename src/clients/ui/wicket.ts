/**
 * clients — version-agnostic Wicket helpers.
 *
 * midPoint's GUI is built on Apache Wicket across every version this harness
 * targets, so these utilities are shared by all REFERENCE page-object modules
 * and stay in the framework (not in any version-specific file).
 */
import type { Locator, Page } from "playwright";

/** Escape a string for safe interpolation into a `RegExp`. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ValidityItem = { access: string; validFrom?: string; validTo?: string };
type CartValidity = { items: ReadonlyArray<ValidityItem>; validFrom?: string; validTo?: string };

/**
 * Old-UI (4.0/4.4) assignment validity. The old shopping cart has no single bulk
 * control, so BOTH validity operations go through the same per-assignment editor:
 * on the cart-review page each requested role is a `a.check-table-header*` link;
 * clicking it EXPANDS an editor panel with `validFrom`/`validTo`, each split into
 * `…:date / :hours / :minutes` inputs (the date sub-field is a YUI calendar that
 * parses `MM/DD/YYYY` only — other formats are silently dropped).
 *
 * The effective window per item is `item.validFrom/To ?? submission.validFrom/To`
 * — so a request-level (BULK) window is realized by looping the SAME dates onto
 * every item's panel, and a per-item window sets just that item. (The two scopes
 * are mutually exclusive upstream, so this never mixes them.) Call after the cart
 * items render, before clicking Request.
 */
export async function fillCartValidity(page: Page, submission: CartValidity): Promise<void> {
  // Expanded panels COEXIST (clicking a second role's header doesn't collapse the
  // first), and each adds its own `…validFrom:date` etc. inputs in cart-row order.
  // So target the N-th panel's inputs by index — NOT `.first()`, which (with two
  // roles expanded) would write every role's dates onto the first panel, leaving
  // the rest empty. `panel` counts the assignment editors opened so far.
  let panel = 0;
  for (const item of submission.items) {
    const validFrom = item.validFrom ?? submission.validFrom;
    const validTo = item.validTo ?? submission.validTo;
    if (!validFrom && !validTo) continue;
    // Expand this assignment's editor (a Wicket-Ajax re-render).
    await page.locator("a[class*=check-table-header]", { hasText: item.access }).first().click();
    await page.locator('input[name$="validFrom:date"]').nth(panel).waitFor();
    if (validFrom) await fillYuiDate(page, "validFrom", validFrom, panel);
    if (validTo) await fillYuiDate(page, "validTo", validTo, panel);
    panel++;
  }
}

async function fillYuiDate(page: Page, which: "validFrom" | "validTo", iso: string, panel: number): Promise<void> {
  const d = /[T ]/.test(iso) ? new Date(iso) : new Date(`${iso}T00:00:00`);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  await page.locator(`input[name$="${which}:date"]`).nth(panel).fill(`${mm}/${dd}/${d.getFullYear()}`);
  await page.locator(`input[name$="${which}:hours"]`).nth(panel).fill(String(d.getHours()));
  await page.locator(`input[name$="${which}:minutes"]`).nth(panel).fill(String(d.getMinutes()));
}

/**
 * Wizard steps and list filters update via AJAX, which carries the
 * `Wicket-Ajax: true` request header. Pairing a click with a wait for that
 * response is the reliable way to know the round-trip finished — far more
 * deterministic than re-clicking or sleeping. Callers still wait for the
 * rendered element the action produces.
 */
export async function clickAjax(page: Page, target: Locator): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().headers()["wicket-ajax"] === "true").catch(() => undefined),
    target.click(),
  ]);
}

/** Wait for the next Wicket AJAX round-trip while running `trigger` (e.g. a keypress). */
export async function withAjax(page: Page, trigger: () => Promise<void>): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().headers()["wicket-ajax"] === "true").catch(() => undefined),
    trigger(),
  ]);
}
