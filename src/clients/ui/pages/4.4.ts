/**
 * REFERENCE page objects for stock midPoint 4.4.x.
 *
 * Implements the version-agnostic contract (`../contract.ts`) for the 4.4 GUI.
 * Version-DEPENDENT layer; project deviations override only the changed screen
 * (project > reference).
 *
 * ── What changed in 4.4 from 4.0 (the previous major we support) ─────────────
 * The self-service SCREENS are unchanged from 4.0 — same name-based login, same
 * two-page "shopping cart" (/self/assignmentShoppingCart → /self/requestAssignments
 * with `.shopping-cart-item-box` tiles and a `.shopping-cart-item-button-add`
 * span), same /admin/myWorkItems inbox with a per-row Approve + "Yes" confirm, and
 * the same role-catalog ORG TREE (expand `tree-junction-collapsed` `[+]`, click a
 * leaf `.tree-label`, with a "Role catalog view"/"All roles view" tab selector).
 * See pages/4.0.ts for the full baseline description. (later: 4.8 replaced the
 * shopping cart with the /self/requestAccess bs-stepper wizard, and the catalog
 * tree with a drill-down — see pages/4.8.ts.) What's actually 4.4-specific is
 * below — it's the infra fix for the SearchPanel NPE.
 *
 * ── Two PREREQUISITES that live in config/infra, NOT this file ───────────────
 * • SELF-SERVICE ACCESS: a requester needs it via the Employee archetype, but
 *   4.4 has NO standard Person archetype (oid …702) — a <superArchetypeRef> to
 *   it makes every Employee evaluation NPE (a 500 rendering the cart). See
 *   examples/midpoint-4.4/midpoint-config/archetype-employee.xml.
 * • SEARCH-PANEL NPE: 4.4 (incl. the 4.4-support / 4.4.12-SNAPSHOT build)
 *   intermittently 500s rendering a list's search panel
 *   (PropertySearchItem.getSearchItemType → null def). Root cause:
 *   SearchItemDefinition.def is `transient`, so when Wicket serializes then
 *   restores a page (its page store), def becomes null and is never re-resolved
 *   from the (kept) path → NPE on the next render — hence the RANDOMNESS (it only
 *   bites a deserialized page). It's fixed at the infra layer by disabling Wicket
 *   page serialization (wicket.no-serialization.enabled=true in
 *   examples/midpoint-4.4/infra/application.properties).
 *
 * Separately from that NPE: 4.4's Wicket-Ajax actions are a touch racy to drive
 * (an add-to-cart click occasionally no-ops; a work item appears a beat after the
 * request). That's ordinary UI-automation flakiness, so the two list actions
 * retry a bounded number of times until a POSITIVE signal confirms success —
 * `retryUntil` below. (This is NOT the NPE workaround; that's infra.)
 */
import type { Page } from "playwright";
import type {
  BrowseOptions,
  LoginPage,
  PageContext,
  PageObjectModule,
  RequestAccessPage,
  RequestSubmission,
  WorkItemDecision,
  WorkItemsPage,
} from "../contract.ts";
import { VIEW_LABELS, type CatalogView } from "../contract.ts";
import { bulkDecide } from "../workItems.ts";
import { clickAjax, fillCartValidity } from "../wicket.ts";
import { NewUiAdminAssign } from "../adminAssign.ts";

/**
 * Run `attempt` (which always starts by navigating, so a retry is a clean reload)
 * until it resolves truthy, up to `tries` times. Used to absorb occasional
 * Wicket-Ajax no-ops / not-yet-rendered async items. Throws if never confirmed.
 */
async function retryUntil(attempt: () => Promise<boolean>, what: string, tries = 4): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await attempt().catch(() => false)) return;
  }
  throw new Error(`4.4 GUI: ${what} did not confirm after ${tries} tries`);
}

/** The login screen. */
class LoginPage44 implements LoginPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  async login(user: string, password: string): Promise<void> {
    await this.page.goto(`${this.baseUrl}/login`);
    // 4.4 login inputs carry only name= (no id), and submit is <input type=submit>.
    await this.page.fill('input[name="username"]', user);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('input[type="submit"]');
    await this.page.waitForURL(/\/self\/dashboard/);
  }
}

/** The self-service role request — 4.4's two-page "shopping cart" flow. */
class RequestAccessPage44 implements RequestAccessPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /**
   * Add each item to the cart. The add click occasionally no-ops, so retry the
   * whole add (each try reloads the catalog → safe, no duplicate: an un-added
   * access leaves the cart unchanged). Confirmed via the "Go to shopping cart"
   * affordance, which appears only once the cart holds an item.
   */
  private async addItemsToCart(submission: RequestSubmission): Promise<void> {
    const p = this.page;
    for (const item of submission.items) {
      await retryUntil(async () => {
        await p.goto(`${this.baseUrl}/self/assignmentShoppingCart`);
        await p.waitForLoadState("networkidle").catch(() => undefined);
        if (item.view) await this.selectView(item.view);
        if (item.catalog?.length) await this.navigateCatalog(item.catalog);
        const tile = p.locator(".shopping-cart-item-box", { hasText: item.access });
        await tile.first().waitFor({ timeout: 10000 });
        await clickAjax(p, tile.locator(".shopping-cart-item-button-add").first());
        return p
          .getByText("Go to shopping cart", { exact: false })
          .first()
          .waitFor({ timeout: 6000 })
          .then(() => true)
          .catch(() => false);
      }, `add "${item.access}" to cart`);
    }
  }

  /** Go to the cart review ("New assignments list") and click "Request". */
  private async submitCart(submission: RequestSubmission): Promise<void> {
    const p = this.page;
    // Navigate DIRECTLY (not via the catalog's "Go to shopping cart" link) to
    // avoid a second catalog render; the adds already committed.
    await p.goto(`${this.baseUrl}/self/requestAssignments`);
    await p.getByText(submission.items[0]!.access, { exact: false }).first().waitFor();
    await fillCartValidity(p, submission);
    if (submission.comment) {
      // The cart-level request comment (placeholder "Comment here…", name=description) —
      // request/case-level and DRIVE-ONLY (not the focus end-state), like the new UI.
      // Target it EXACTLY: `.first()` would, after a validity panel is expanded, land on
      // the assignment editor's own `…:descriptionContainer:description` and pollute the
      // granted assignment's description (flaky), so match the exact cart field name.
      const comment = p.locator('textarea[name="description"]').first();
      if (await comment.isVisible().catch(() => false)) await comment.fill(submission.comment);
    }
    const request = p.getByRole("button", { name: "Request" }).or(p.getByText("Request", { exact: true }));
    await request.first().click();
  }

  /** Submit a self-service access request (one or more items). */
  async request(submission: RequestSubmission): Promise<void> {
    await this.addItemsToCart(submission);
    await this.submitCart(submission);
    // Submission navigates away; the REST check (verify) asserts the end-state.
    await this.page.waitForURL(/\/self\/(dashboard|assignmentShoppingCart|requestAssignments)/).catch(() => undefined);
  }

  /**
   * Submit the request EXPECTING a policy rejection; return the GUI error text.
   * On a policy violation midPoint keeps the cart-review page and renders the
   * reason in a `.feedback-message` (box-danger) panel — same panel/text as the
   * new UI. Throws if no error appears (the request likely succeeded).
   */
  async requestExpectingError(submission: RequestSubmission): Promise<string> {
    const p = this.page;
    await this.addItemsToCart(submission);
    await this.submitCart(submission);
    const feedback = p.locator(".feedback-message");
    await feedback.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    const texts = await feedback.evaluateAll((els: any[]) => els.map((e) => (e.innerText || "").trim()).filter(Boolean));
    if (!texts.length) throw new Error("Expected a policy rejection error in the GUI, but no feedback message was shown.");
    return texts.join("\n");
  }

  /**
   * Switch the catalog to a logical view. 4.4's cart UI has a tab per view, labelled
   * "<base> view" (e.g. "All roles view"); map the logical key to that tab.
   */
  private async selectView(view: CatalogView): Promise<void> {
    const p = this.page;
    const label = `${VIEW_LABELS[view]} view`;
    const tab = p.getByRole("link", { name: label }).or(p.getByText(label, { exact: true }));
    await tab.first().click().catch(() => undefined);
    await p.waitForLoadState("networkidle").catch(() => undefined);
  }

  /**
   * Drill the role-catalog org tree to a leaf org, then select it so its member
   * accesses render. The catalog auto-expands the root, and each node's junction
   * carries `tree-junction-collapsed`/`-expanded`, so we only click (expand) the
   * still-collapsed ancestors, then click the LEAF org's label (which lists its
   * roles on the right — clicking a label selects, it doesn't expand).
   */
  private async navigateCatalog(path: string[]): Promise<void> {
    const p = this.page;
    for (const org of path.slice(0, -1)) {
      const node = p.locator(".tree-node", { hasText: org }).first();
      await node.waitFor({ timeout: 8000 });
      const junction = node.locator("a[class*=tree-junction]").first();
      if (((await junction.getAttribute("class")) ?? "").includes("collapsed")) {
        await clickAjax(p, junction);
      }
    }
    await clickAjax(p, p.locator(".tree-label", { hasText: path[path.length - 1]! }).first());
    await p.waitForLoadState("networkidle").catch(() => undefined);
  }

  /** Read the display names of the accesses currently requestable at a position. */
  async listRequestable(opts: BrowseOptions): Promise<string[]> {
    const p = this.page;
    // (`for`/person-of-interest is not yet driven on the old UI — self only.)
    await p.goto(`${this.baseUrl}/self/assignmentShoppingCart`);
    await p.waitForLoadState("networkidle").catch(() => undefined);
    if (opts.view) await this.selectView(opts.view);
    if (opts.catalog?.length) await this.navigateCatalog(opts.catalog);
    // Each tile's first text line is the access display name.
    return p
      .locator(".shopping-cart-item-box")
      .evaluateAll((els: any[]) => els.map((e) => (e.innerText || "").split("\n")[0].trim()).filter(Boolean));
  }
}

/** The approver's work-item inbox. */
class WorkItemsPage44 implements WorkItemsPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /**
   * Approve/reject the work item whose name contains `requestMatch` (/admin/myWorkItems;
   * the /self/* variants 403), optionally with an approver comment. Without a comment
   * the inbox inline button is fastest; WITH one, drive the work-item DETAIL page,
   * which carries the approver-comment field AND the decision controls (rendered as
   * `<div class="btn btn-success|btn-danger">`, not a <button>). Same as 4.0.
   */
  async decide(requestMatch: string, decision: WorkItemDecision): Promise<void> {
    const p = this.page;
    const label = decision.outcome === "approve" ? "Approve" : "Reject";
    // The work item appears a beat after the request and the list doesn't
    // auto-refresh, so each path retry-reloads until its control is present.
    if (decision.comment) {
      await retryUntil(async () => {
        await p.goto(`${this.baseUrl}/admin/myWorkItems`);
        const link = p.locator("tr", { hasText: requestMatch }).locator("a").filter({ hasText: requestMatch }).first();
        if (!(await link.waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) return false;
        await clickAjax(p, link);
        const comment = p.locator('textarea[name$="approverComment"]').first();
        if (!(await comment.waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) return false;
        await comment.fill(decision.comment!);
        await clickAjax(p, p.getByText(label, { exact: true }).first());
        return true;
      }, `decide work item "${requestMatch}" (with comment)`);
    } else {
      await retryUntil(async () => {
        await p.goto(`${this.baseUrl}/admin/myWorkItems`);
        const row = p.locator("tr", { hasText: requestMatch });
        const btn = row.getByRole("button", { name: label }).or(row.locator(`button[title="${label}"]`));
        if (!(await btn.first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) return false;
        await clickAjax(p, btn.first());
        return true;
      }, `decide work item "${requestMatch}"`);
    }
    // Confirm dialog "Yes" (the AJAX that completes the item); absence = already done.
    const yes = p.getByRole("link", { name: "Yes" }).or(p.getByRole("button", { name: "Yes" }));
    await yes
      .first()
      .waitFor({ timeout: 5000 })
      .then(() => clickAjax(p, yes.first()))
      .catch(() => undefined);
    // The case completes asynchronously; the REST check asserts the end-state.
  }

  /** Bulk approve/reject many work items at once from the inbox (shared across versions). */
  async decideBulk(matches: string[], decision: WorkItemDecision): Promise<void> {
    await bulkDecide(this.page, this.baseUrl, matches, decision.outcome);
  }
}

/** The 4.4 reference module: a factory per screen the harness drives. */
const pageObjects: PageObjectModule = {
  version: "4.4",
  login: (ctx: PageContext) => new LoginPage44(ctx.page, ctx.baseUrl),
  requestAccess: (ctx: PageContext) => new RequestAccessPage44(ctx.page, ctx.baseUrl),
  workItems: (ctx: PageContext) => new WorkItemsPage44(ctx.page, ctx.baseUrl),
  // 4.4's admin Assignments flow matches 4.8/4.10's new UI (shared NewUiAdminAssign).
  adminAssign: (ctx: PageContext) => new NewUiAdminAssign(ctx.page, ctx.baseUrl),
};

export default pageObjects;
