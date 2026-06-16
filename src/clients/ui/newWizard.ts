/**
 * clients — the new self-service "Request access" WIZARD, shared by midPoint 4.8+.
 *
 * 4.8 rebuilt request-access as a bs-stepper wizard (Person of interest →
 * [Relation] → Role catalog → Shopping cart), and 4.10 kept the same structure
 * (only refreshing a few controls). Both versions' page objects drive the SAME
 * catalog navigation, so it lives here ONCE; the per-version differences (how
 * "Myself" is selected, whether "Add to cart" is a link or a button) are passed
 * in as a small `WizardAdapter`. A new 4.x version reuses this by supplying its
 * own adapter — and the fiddly bits (stepper detach, lazy-tile settle) are fixed
 * in a single place instead of being copy-pasted per version.
 */
import type { Locator, Page } from "playwright";
import { VIEW_LABELS, type CatalogView, type RequestSubmission } from "./contract.ts";
import { clickAjax, withAjax } from "./wicket.ts";

/**
 * Switch the wizard catalog's left-nav to a logical view. The catalog's default
 * landing ALREADY lists every requestable ROLE, so both `role-catalog` (drilled by
 * its `catalog` path) and `all-roles` are that default — no switch. Only the
 * `all-organizations` / `all-services` flat lists are separate left-nav
 * `a.item-link` items (labelled by the view base), reached the SAME way
 * `drillCatalog` walks into an org.
 */
export async function selectCatalogView(page: Page, view: CatalogView): Promise<void> {
  if (view === "role-catalog" || view === "all-roles") return;
  await clickAjax(page, page.locator("a.item-link", { hasText: VIEW_LABELS[view] }).first());
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Render a scenario date (ISO `YYYY-MM-DD` or full ISO) in the EXACT format the
 * new-UI "Valid from/to" inputs (a Tempus Dominus picker, locale `en`) parse:
 * `MMMM d, yyyy, h:mm AM` — e.g. "January 2, 2030, 12:00 AM". Critically the
 * space before AM/PM is U+202F (narrow no-break space), which is what the picker
 * writes and the ONLY thing it parses; a normal space yields "not a valid Date".
 * Built by hand (not Intl) so that exact byte is guaranteed across Node/ICU
 * versions. The actual stored value is captured by `expected/`.
 */
function checkoutDate(iso: string): string {
  const d = /[T ]/.test(iso) ? new Date(iso) : new Date(`${iso}T00:00:00`);
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = d.getHours() < 12 ? "AM" : "PM";
  const h12 = d.getHours() % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h12}:${min}\u202F${ampm}`;
}

/**
 * Fill a Tempus Dominus date input AND commit it. `fill()` alone sets the text
 * but doesn't blur, so TD/Wicket never fire the `change` that PARSES the date
 * into the model — the submit then succeeds but the assignment gets NO validity.
 * Press Enter to commit (TD parses on enter), then let its change round-trip
 * settle. (Don't re-fill on a value mismatch: TD canonicalises the text, and a
 * second fill+enter resets the parsed date back out.)
 */
async function fillDate(page: Page, selectorSuffix: string, value: string): Promise<void> {
  const input = page.locator(`input[name$="${selectorSuffix}"]`).first();
  await input.waitFor();
  await input.fill(value);
  await input.press("Enter");
  await page.waitForTimeout(500);
}

/** On the Shopping-cart step, fill the request comment + the BULK assignment validity. */
async function fillCheckout(page: Page, submission: RequestSubmission): Promise<void> {
  if (submission.comment) {
    const comment = page.locator('textarea[name$="form:comment"]').first();
    if (await comment.isVisible().catch(() => false)) await comment.fill(submission.comment);
  }
  // The cart's "Custom length" control is a REQUEST-LEVEL (bulk) window applied to
  // ALL items, so it's driven from the submission-level validFrom/To — NOT per item
  // (per-item validity is a different operation: the per-role Edit dialog). The two
  // scopes are mutually exclusive (enforced in the step), so reading bulk here is
  // unambiguous.
  if (submission.validFrom || submission.validTo) {
    const validity = page.locator('select[name$="form:validity"]').first();
    if (await validity.isVisible().catch(() => false)) {
      // "Custom length" reveals the from/to date inputs (a Wicket-AJAX re-render).
      await withAjax(page, async () => {
        await validity.selectOption({ label: "Custom length" });
      });
      // Let the revealed Tempus Dominus pickers initialize before typing —
      // filling before they're wired leaves the text but never commits a date.
      await page.waitForTimeout(800);
      if (submission.validFrom)
        await fillDate(page, "customValidity:from:container:input", checkoutDate(submission.validFrom));
      if (submission.validTo)
        await fillDate(page, "customValidity:to:container:input", checkoutDate(submission.validTo));
    }
  }
}

/** The version-specific controls the otherwise-shared wizard flow needs. */
export interface WizardAdapter {
  /** Select "Myself" as the (sole) person of interest, if not already selected. */
  selectMyself(page: Page): Promise<void>;
  /** The "Add to cart" control inside a given role tile (a link in 4.8, a button in 4.10). */
  addToCart(tile: Locator): Locator;
  /**
   * Open the cart row's PER-ROLE assignment editor (the validity dialog) for the
   * access named `access`. 4.10: a `button` whose accessible name is "Edit
   * shopping cart item <access> …"; 4.8: an `a[title="Edit"]` inside that row.
   */
  openItemEditor(page: Page, access: string): Promise<void>;
}

/**
 * Drive the PER-ROLE validity for each item that carries its OWN window
 * (items[].validFrom/To) — the per-role operation, distinct from the cart's bulk
 * panel. For each such item: open its row editor, set the validity, save. The
 * editor exposes the assignment's validity directly (no length dropdown) as
 * `content:customValidity:from/to:container:input` — the SAME Tempus Dominus
 * widget as the cart panel, committed the same way. (Bulk and per-role are
 * mutually exclusive upstream, so at most one of fillCheckout/this does work.)
 */
async function fillPerItemValidity(page: Page, submission: RequestSubmission, adapter: WizardAdapter): Promise<void> {
  for (const item of submission.items) {
    if (!item.validFrom && !item.validTo) continue;
    await adapter.openItemEditor(page, item.access);
    // Set BOTH dates BEFORE committing either. On 4.8 the modal re-renders on a
    // per-field commit and HIDES the still-empty sibling field, so an Enter-after-
    // each-field approach (which works on the 4.10 cart panel) loses the second
    // date. Instead: fill both inputs' text while both are visible, THEN commit
    // via the `change` event the Tempus Dominus + Wicket behaviors listen for —
    // NOT Enter, which on 4.8 fires the modal's default action.
    const filled: Locator[] = [];
    const setText = async (suffix: string, iso: string) => {
      const input = page.locator(`input[name$="${suffix}"]`).first();
      await input.waitFor();
      await input.fill(checkoutDate(iso));
      filled.push(input);
    };
    if (item.validFrom) await setText("content:customValidity:from:container:input", item.validFrom);
    if (item.validTo) await setText("content:customValidity:to:container:input", item.validTo);
    for (const input of filled) {
      await input
        .evaluate((el) => {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        })
        .catch(() => undefined);
      await page.waitForTimeout(300);
    }
    // Persist the dialog's edits back onto the cart row.
    await page
      .getByRole("link", { name: /Save changes/ })
      .or(page.getByRole("button", { name: /Save changes/ }))
      .first()
      .click();
    await page.waitForTimeout(500);
  }
}

/**
 * Tame two bits of UI chrome that fight Playwright's actionability checks:
 *  - the wizard SLIDES between steps, so a click landing mid-animation fails the
 *    stability check ("element is not stable") — kill all transitions/animations
 *    so the stepper jumps instantly and every control is immediately stable.
 *  - "Add to cart" pops a `.toast` ("Item added…") in the top-right that OVERLAPS
 *    the "Next: Shopping cart" button and auto-dismisses only after ~5s; clicking
 *    Next would then block on the toast clearing (a flat ~5s/request tax, worst
 *    on 4.8). Hide the toast — it's a cosmetic notification; the assertable
 *    rejection feedback is a separate `.feedback-message`, untouched here.
 */
export async function disableAnimations(page: Page): Promise<void> {
  await page
    .addStyleTag({
      content:
        "*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}" +
        ".toast{display:none!important}",
    })
    .catch(() => undefined);
}

/**
 * Drive the wizard from the start to the Role catalog step: select "Myself" as
 * the person of interest and advance past the optional Relation step. Returns
 * with the catalog rendered (its role tiles or its org left-nav visible).
 *
 * The Relation step is config-dependent, so the number of "Next:" hops varies;
 * and the bs-stepper re-renders each step, so a "Next:" link can detach mid-click
 * ("element is not stable" / "detached from the DOM"). Drive it as a loop that
 * re-locates the link fresh each pass, tolerates a racing detach, and stops as
 * soon as the catalog shows.
 */
export async function openRoleCatalog(page: Page, baseUrl: string, adapter: WizardAdapter): Promise<void> {
  await page.goto(`${baseUrl}/self/requestAccess`);
  await disableAnimations(page);
  await adapter.selectMyself(page);
  // The role tiles AND the org left-nav both appear only on the catalog step; a
  // single combined locator is a strict-safe "we're on the catalog" signal.
  const ready = page.locator(".catalog-tile-panel, a.item-link").first();
  for (let i = 0; i < 8; i++) {
    if (await ready.isVisible().catch(() => false)) return;
    // Click ONLY the toward-catalog hops ("Next: Relation" / "Next: Role
    // catalog"); the catalog step's own "Next: Shopping cart" must NOT be clicked
    // or we'd overshoot past the catalog.
    const next = page.getByRole("link", { name: /^Next: (Relation|Role catalog)/ }).first();
    if (!(await next.isVisible().catch(() => false))) {
      await page.waitForTimeout(300);
      continue;
    }
    const toCatalog = /Role catalog/i.test(await next.innerText().catch(() => ""));
    await clickAjax(page, next).catch(() => undefined);
    // Only the "Role catalog" hop lands ON the catalog — wait for it to render so
    // the next pass doesn't re-click a stale link (whose AJAX never fires → a full
    // 30s hang). The "Relation" hop needs no wait: the loop immediately finds the
    // next link. (An unconditional per-hop wait would instead burn the timeout on
    // the Relation hop, where the catalog never appears.)
    if (toCatalog) await ready.waitFor({ timeout: 8000 }).catch(() => undefined);
  }
  await ready.waitFor();
}

/**
 * Drill the role catalog to a leaf org. The new UI roots the catalog at the
 * configured org (accessRequest/roleCatalog/roleCatalogRef), so the FIRST path
 * element (the root) is the implicit start and is skipped; each remaining org is
 * an `a.item-link` you click to navigate INTO it (a drill-down, not a tree
 * expand), and the leaf then lists its member roles as `.catalog-tile-panel`.
 */
export async function drillCatalog(page: Page, path: string[]): Promise<void> {
  const orgs = path.slice(1);
  for (let i = 0; i < orgs.length; i++) {
    // The clickable is the row's `a.item-link` (clicking the inner span.label
    // intermittently no-ops the navigation), and it carries the org name.
    await clickAjax(page, page.locator("a.item-link", { hasText: orgs[i]! }).first());
    await page.waitForLoadState("networkidle").catch(() => undefined);
    // For a non-leaf, confirm the drill revealed the next level before clicking
    // it. For the LEAF there's nothing further to click — clickAjax already
    // awaited the nav round-trip and the settle-poll below confirms its tiles, so
    // we add no wait here (an earlier "leaf landed" heuristic matched no element
    // and burned its full 8s timeout on every leaf drill).
    const next = orgs[i + 1];
    if (next) {
      await page.locator("a.item-link", { hasText: next }).first().waitFor({ timeout: 8000 }).catch(() => undefined);
    }
  }
  // The leaf's role tiles arrive inside the nav AJAX response but are applied to
  // the DOM a beat after clickAjax sees the response (~tens of ms), and
  // networkidle can resolve in the gap BEFORE the click's request even starts —
  // so a single post-nav read can catch 0 tiles mid-load, indistinguishable from
  // a genuinely empty intermediate node. Settle by requiring the count to hold
  // across 3 consecutive samples: a transient early 0 rises to N within a tick,
  // while a real empty node stays 0. (This matters for `absent` assertions: a
  // premature empty read would let a should-be-visible role pass as hidden.)
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 16 && stable < 3; i++) {
    await page.waitForTimeout(250);
    const n = await page.locator(".catalog-tile-panel").count();
    stable = n === last ? stable + 1 : 0;
    last = n;
  }
}

/** Submit the filled cart expecting SUCCESS — a full navigation back to the dashboard. */
export async function submitRequest(page: Page, submission: RequestSubmission, adapter: WizardAdapter): Promise<void> {
  await clickAjax(page, page.getByRole("link", { name: "Next: Shopping cart" }));
  // Wait for the cart to render before touching checkout fields: clickAjax sees
  // the response but the form lags, and fillCheckout SKIPS fields it finds
  // not-yet-visible — so an early call silently drops the comment/validity.
  const submit = page.getByRole("link", { name: /Submit/ }).first();
  await submit.waitFor();
  await fillCheckout(page, submission); // bulk (request-level) validity + comment
  await fillPerItemValidity(page, submission, adapter); // per-role (item-level) validity
  await submit.click();
  await page.waitForURL(/\/self\/dashboard/);
}

/**
 * Submit the filled cart EXPECTING rejection. On a policy violation midPoint
 * keeps the wizard on the request page and renders the reason in a
 * `.feedback-message` (card-danger) panel; return that text. Throws if the
 * request instead SUCCEEDS (navigates to the dashboard) or if no error appears.
 */
export async function submitExpectingError(page: Page): Promise<string> {
  await clickAjax(page, page.getByRole("link", { name: "Next: Shopping cart" }));
  const submit = page.getByRole("link", { name: /Submit/ }).first();
  await submit.waitFor();
  const feedback = page.locator(".feedback-message");
  await submit.click();
  // Either it succeeds (navigates to the dashboard) or it's rejected (the
  // feedback panel renders and we stay on the request page).
  await Promise.race([
    page.waitForURL(/\/self\/dashboard/, { timeout: 10_000 }).catch(() => undefined),
    feedback.first().waitFor({ timeout: 10_000 }).catch(() => undefined),
  ]);
  if (/\/self\/dashboard/.test(page.url())) {
    throw new Error("Expected the request to be rejected by policy, but it succeeded (reached the dashboard).");
  }
  const texts = await feedback.evaluateAll((els: any[]) => els.map((e) => (e.innerText || "").trim()).filter(Boolean));
  if (!texts.length) throw new Error("Expected a rejection error in the GUI, but no feedback message was shown.");
  return texts.join("\n");
}

/** Read the display names of the role tiles currently shown in the catalog. */
export function readTileNames(page: Page): Promise<string[]> {
  return page
    .locator(".catalog-tile-panel")
    .evaluateAll((els: any[]) => els.map((e) => (e.innerText || "").split("\n")[0].trim()).filter(Boolean));
}
