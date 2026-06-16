/**
 * REFERENCE page objects for stock midPoint 4.8.x.
 *
 * Implements the version-agnostic contract (`../contract.ts`) for the 4.8 GUI,
 * using accessible-name locators (stable across Wicket's generated ids) and the
 * shared `clickAjax` helper. This is the version-DEPENDENT layer; project
 * deviations override only the changed screen (project > reference).
 *
 * ── What changed in 4.8 from 4.4 (the previous major we support) ─────────────
 * • REQUEST ACCESS was rebuilt: 4.4's two-page shopping cart became the
 *   /self/requestAccess WIZARD — a bs-stepper (Person of interest → [Relation] →
 *   Role catalog → Shopping cart), finished with "Submit my request". The wizard
 *   SLIDES between steps, which fights Playwright's actionability checks — see
 *   disableAnimations (in newWizard.ts).
 * • ROLE CATALOG changed from 4.4's tree-EXPAND to a DRILL-DOWN: you click an
 *   `a.item-link` org node to navigate INTO it (not expand a `tree-junction`),
 *   and the leaf lists its member roles as `.catalog-tile-panel` tiles (4.4 used
 *   `.shopping-cart-item-box`). Add-to-cart is an `<a>` link inside the tile.
 *   A configured catalog is set via adminGuiConfiguration/accessRequest/
 *   roleCatalog/roleCatalogRef (4.4 used roleManagement/roleCatalogRef).
 * • LOGIN is unchanged from 4.4 (name-based inputs). (later: 4.10 adds #ids.)
 * • WORK ITEMS inbox stays /admin/myWorkItems; the Approve control is a
 *   `button[title="Approve"]` and a "Yes" confirm dialog completes the item.
 *
 * The wizard catalog navigation (openRoleCatalog/drillCatalog/readTileNames,
 * disableAnimations, and the lazy-tile settle) is IDENTICAL in 4.10, so it lives
 * once in `../newWizard.ts`; this file only supplies the `WizardAdapter` for the
 * version-specific controls (how "Myself" is selected, link vs button add-to-cart).
 *
 * Adding a version = a sibling `pages/<version>.ts` exporting a PageObjectModule
 * + one line in `../loader.ts`'s registry.
 */
import type { Page } from "playwright";
import type {
  LoginPage,
  BrowseOptions,
  PageContext,
  PageObjectModule,
  RequestAccessPage,
  RequestSubmission,
  WorkItemDecision,
  WorkItemsPage,
} from "../contract.ts";
import type { Locator } from "playwright";
import { clickAjax } from "../wicket.ts";
import { NewUiAdminAssign } from "../adminAssign.ts";
import { bulkDecide } from "../workItems.ts";
import {
  openRoleCatalog,
  drillCatalog,
  selectCatalogView,
  readTileNames,
  disableAnimations,
  submitRequest,
  submitExpectingError,
  type WizardAdapter,
} from "../newWizard.ts";

/**
 * 4.8's per-version controls for the shared request-access wizard
 * (`../newWizard.ts`): "Myself" is a `.simple-tile` whose selected state is the
 * `active` class, and "Add to cart" is an `<a>` link inside each role tile.
 */
const wizard: WizardAdapter = {
  async selectMyself(page) {
    const myself = page.locator(".simple-tile.selectable", { hasText: "Myself" }).first();
    await myself.waitFor();
    if (!((await myself.getAttribute("class")) ?? "").includes("active")) await clickAjax(page, myself);
  },
  addToCart: (tile: Locator) => tile.getByRole("link", { name: "Add to cart" }),
  async openItemEditor(page, access) {
    // 4.8's cart-row Edit is a generic `a[title="Edit"]` (its name doesn't carry
    // the access), so scope to the cart row carrying the access.
    const row = page.locator("tr").filter({ hasText: access });
    await clickAjax(page, row.locator('a[title="Edit"]').first());
  },
};

/** The login screen. */
class LoginPage48 implements LoginPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  async login(user: string, password: string): Promise<void> {
    await this.page.goto(`${this.baseUrl}/login`);
    // 4.8 login is name-based (unchanged from 4.4; 4.10 later adds #username/#password ids).
    await this.page.fill('input[name="username"]', user);
    await this.page.fill('input[name="password"]', password);
    await this.page.click("button[type=submit]");
    await this.page.waitForURL(/\/self\/dashboard/);
  }
}

/** The self-service "Request access" wizard (Person of interest → [Relation] → Role catalog → Shopping cart). */
class RequestAccessPage48 implements RequestAccessPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /** Open the wizard and add every requested item to the cart (no submit). */
  private async fillCart(submission: RequestSubmission): Promise<void> {
    const p = this.page;
    await openRoleCatalog(p, this.baseUrl, wizard);
    let lastCatalog: string | null = null;
    for (const item of submission.items) {
      // The catalog root shows every requestable role as a tile, so a flat item
      // (no `catalog`) is found there directly; a `catalog` path drills first.
      // Re-drilling the SAME path is skipped: consecutive items in one leaf org are
      // already listed, and re-drilling a settled catalog races a Wicket re-render.
      if (item.catalog?.length) {
        const key = item.catalog.join(" ");
        if (key !== lastCatalog) await drillCatalog(p, item.catalog);
        lastCatalog = key;
      } else {
        // A flat item: switch the left-nav to its logical view (role-catalog is the
        // default root, so it's a no-op). All-roles/orgs/services pick the flat list.
        if (item.view) await selectCatalogView(p, item.view);
        lastCatalog = null;
      }
      const tile = p.locator(".catalog-tile-panel", { hasText: item.access }).first();
      const addToCart = wizard.addToCart(tile);
      await addToCart.waitFor();
      await clickAjax(p, addToCart);
    }
  }

  /** Submit a self-service access request via the new wizard. */
  async request(submission: RequestSubmission): Promise<void> {
    await this.fillCart(submission);
    await submitRequest(this.page, submission, wizard);
  }

  /** Submit the request expecting a policy rejection; return the GUI error text. */
  async requestExpectingError(submission: RequestSubmission): Promise<string> {
    await this.fillCart(submission);
    return submitExpectingError(this.page);
  }

  /** Read the display names of the accesses currently requestable at a position. */
  async listRequestable(opts: BrowseOptions): Promise<string[]> {
    const p = this.page;
    await openRoleCatalog(p, this.baseUrl, wizard);
    if (opts.view) await selectCatalogView(p, opts.view);
    if (opts.catalog?.length) await drillCatalog(p, opts.catalog);
    return readTileNames(p);
  }
}

/** The approver's "My work items" inbox. */
class WorkItemsPage48 implements WorkItemsPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /** Approve/reject the work item whose name contains `requestMatch`, optionally with a comment. */
  async decide(requestMatch: string, decision: WorkItemDecision): Promise<void> {
    const p = this.page;
    await p.goto(`${this.baseUrl}/admin/myWorkItems`);
    await disableAnimations(p);
    // Approve/Reject are inline <button title="Approve|Reject"> on each row.
    const label = decision.outcome === "approve" ? "Approve" : "Reject";
    if (decision.comment) {
      // The inline row buttons have no comment box, so open the work item's
      // detail page (its name is a link) where the approver comment + the
      // Approve/Reject controls live.
      await clickAjax(p, p.locator("tr").filter({ hasText: requestMatch }).getByRole("link", { name: requestMatch }).first());
      const comment = p.locator('textarea[name$="approverComment"]').first();
      await comment.waitFor();
      await comment.fill(decision.comment);
      await clickAjax(p, p.getByRole("link", { name: label, exact: true }).or(p.getByRole("button", { name: label })).first());
    } else {
      // No comment: the inline row button is fastest.
      const btn = p.locator("tr").filter({ hasText: requestMatch }).locator(`button[title="${label}"]`).first();
      await btn.waitFor();
      await btn.click();
    }
    // Either path can pop a "Do you really want to …?" confirm — its "Yes" is the
    // AJAX that completes the work item. (The case finishes asynchronously; the
    // REST check asserts the end-state, so we don't wait on the UI here.)
    const yes = p.getByRole("link", { name: "Yes" }).first();
    if (await yes.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
      await clickAjax(p, yes);
    }
  }

  /** Bulk approve/reject many work items at once from the inbox (shared across versions). */
  async decideBulk(matches: string[], decision: WorkItemDecision): Promise<void> {
    await bulkDecide(this.page, this.baseUrl, matches, decision.outcome);
  }
}

/** The 4.8 reference module: a factory per screen the harness drives. */
const pageObjects: PageObjectModule = {
  version: "4.8",
  login: (ctx: PageContext) => new LoginPage48(ctx.page, ctx.baseUrl),
  requestAccess: (ctx: PageContext) => new RequestAccessPage48(ctx.page, ctx.baseUrl),
  workItems: (ctx: PageContext) => new WorkItemsPage48(ctx.page, ctx.baseUrl),
  // Same new-UI Assignments flow as 4.10 (shared NewUiAdminAssign).
  adminAssign: (ctx: PageContext) => new NewUiAdminAssign(ctx.page, ctx.baseUrl),
};

export default pageObjects;
