/**
 * REFERENCE page objects for stock midPoint 4.0.x.
 *
 * 4.0 is the OLDEST major this harness targets, so this file is the BASELINE for
 * the self-service journey: it describes 4.0's screens as they are, with forward
 * "(later: …)" notes pointing at how newer majors evolved them (4.0 → see
 * pages/4.4.ts → pages/4.8.ts → pages/4.10.ts). Version-DEPENDENT layer; project
 * deviations override only the changed screen (project > reference).
 *
 * ── 4.0 baseline screens ─────────────────────────────────────────────────────
 * • LOGIN: inputs carry `name=` only, submit is an `<input type=submit>`.
 *   (later: 4.10 adds `#username`/`#password` ids and a `<button>`.)
 * • REQUEST ACCESS is the "shopping cart" — two pages, no wizard:
 *     - catalog + add-to-cart at  /self/assignmentShoppingCart  (titled "Assignment
 *       request"; "Requesting for: me" / "Relation: Member" are preset)
 *     - cart review + submit at    /self/requestAssignments  ("Request" button)
 *   (later: 4.8 replaced this with the /self/requestAccess bs-stepper wizard.)
 *   The role tiles are `.shopping-cart-item-box`; add-to-cart is a
 *   `<span class="shopping-cart-item-button-add">`. (4.4 is identical.)
 * • ROLE CATALOG (when a deployment publishes one via roleManagement/
 *   roleCatalogRef): the cart page gains an org TREE on the left, browsed by
 *   EXPANDING nodes — a collapsed node's junction is `a.tree-junction-collapsed`
 *   (click the `[+]` to expand; the root is pre-expanded), then a leaf org's
 *   `.tree-label` is clicked to list ITS member roles as `.shopping-cart-item-box`
 *   on the right (`navigateCatalog`/`listRequestable` below). A `view`/tab
 *   selector switches between "Role catalog view" (the tree) and "All roles view"
 *   (the flat list); with a catalog configured the DEFAULT view is the tree, so
 *   requesting a NON-catalog role needs an explicit `view: "All roles view"`.
 *   (later: 4.8's wizard turns the catalog into a DRILL-DOWN — you click an
 *   `a.item-link` to navigate INTO an org rather than expand a tree node, and
 *   roles show as `.catalog-tile-panel`; see pages/4.8.ts + newWizard.ts.)
 * • WORK ITEMS inbox is /admin/myWorkItems (titled "Cases allocated to me"; the
 *   /self/* variants 403). Approve is a per-row button, then a "Yes" confirm.
 *
 * Two things to know when driving 4.0:
 * • SELF-SERVICE ACCESS comes from the Employee archetype (induces End user); 4.0
 *   has no standard Person archetype (…702), so the archetype carries no
 *   <superArchetypeRef> and is assigned via an HR `login` inbound — see
 *   examples/midpoint-4.0/midpoint-config/.
 * • SEARCH-PANEL NPE: like 4.4, a Wicket list's search panel can intermittently
 *   500 (SearchItemDefinition.def is `transient` → null after a page is
 *   serialized/restored). 4.8/4.10 rewrote the search framework; 4.4 fixes it with
 *   wicket.no-serialization.enabled, but 4.0 has NO such property. So here the two
 *   list actions retry until a positive signal confirms success (`retryUntil`),
 *   which also absorbs ordinary Wicket-Ajax raciness.
 */
import type { Page, Locator } from "playwright";
import type {
  AdminAssignPage,
  AssignTargetKind,
  LoginPage,
  BrowseOptions,
  NavMenuPage,
  OrgTreePage,
  PageContext,
  PageObjectModule,
  ProfileField,
  ProfilePage,
  RequestAccessPage,
  RequestSubmission,
  WorkItemDecision,
  WorkItemsPage,
} from "../contract.ts";
import { VIEW_LABELS, type CatalogView } from "../contract.ts";
import { bulkDecide } from "../workItems.ts";
import { clickAjax, escapeRegExp, fillCartValidity } from "../wicket.ts";

/**
 * Apply the modal's faceted "Name" search to `value` and tick the matching row.
 * The facet is a client-side Bootstrap popover, so retry the toggle until its input
 * shows; and it APPLIES ON ITS "Update" button — pressing Enter does NOT submit the
 * facet, so a target whose name sorts past the first page of results would never
 * surface. Shared by the on-behalf person picker and the assignment object picker below.
 */
async function facetNameSearchAndCheck(page: Page, modal: Locator, value: string): Promise<void> {
  const facet = modal.locator("a[about='searchItemButton']").filter({ hasText: /Name:/ }).first();
  const input = page.locator(".popover:visible input[type=text]").first();
  for (let i = 0; i < 3 && !(await input.isVisible().catch(() => false)); i++) {
    await facet.click();
    await input.waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
  }
  await input.fill(value);
  const popover = page.locator(".popover:visible").first();
  await clickAjax(
    page,
    popover
      .getByRole("link", { name: "Update", exact: true })
      .or(popover.getByRole("button", { name: "Update", exact: true }))
      .first(),
  );
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await modal.locator("table tbody tr", { hasText: value }).first().locator('input[type="checkbox"]').first().check();
}

/**
 * Run `attempt` (which always starts by navigating, so a retry is a clean reload)
 * until it resolves truthy, up to `tries` times. Absorbs the 4.0 SearchPanel NPE
 * (a transient 500) and occasional Wicket-Ajax no-ops. Throws if never confirmed.
 */
async function retryUntil(attempt: () => Promise<boolean>, what: string, tries = 6): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      if (await attempt()) return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`4.0 GUI: ${what} did not confirm after ${tries} tries`);
}

/** The login screen. */
class LoginPage40 implements LoginPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  async login(user: string, password: string): Promise<void> {
    await this.page.goto(`${this.baseUrl}/login`);
    await this.page.fill('input[name="username"]', user);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('input[type="submit"]');
    // End users land on /self/dashboard; an admin (the assign-ui operator) lands on
    // its /admin/dashboard home — accept either as "logged in".
    await this.page.waitForURL(/\/(self|admin)\/dashboard/);
  }
}

/** The self-service role request — 4.0's two-page "shopping cart" flow. */
class RequestAccessPage40 implements RequestAccessPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /**
   * Select a person of interest for an ON-BEHALF request ("Requesting for").
   * A project manager/approver requests FOR another user — e.g. granting a
   * role the target user cannot self-request. Picking the person re-scopes the
   * catalog to THAT person's eligible roles (so the catalog reflects their
   * eligibility) and targets the submitted request at them, not the operator.
   * So it MUST run before navigating the catalog. A fresh shopping-cart load
   * resets the toggle back to "me", so this is re-applied inside the add retry.
   */
  private async selectPersonOfInterest(login: string): Promise<void> {
    const p = this.page;
    // The "Requesting for" toggle reads "me" until a person is picked, then the
    // login. Target the first link AFTER that label (text-agnostic). If it already
    // names this login (selection survived), there's nothing to do.
    const toggle = p.locator("xpath=//*[normalize-space(text())='Requesting for']/following::a[1]").first();
    await toggle.waitFor({ timeout: 10_000 });
    if ((await toggle.innerText().catch(() => "")).includes(login)) return;
    await toggle.click();
    const modal = p.locator(".wicket-modal").first();
    await modal.waitFor({ state: "visible", timeout: 10_000 });
    // Faceted name search: open the "Name" facet, type the login, apply, tick the row.
    await facetNameSearchAndCheck(p, modal, login);
    // Then confirm with the popup's "Add".
    await modal
      .getByRole("link", { name: "Add", exact: true })
      .or(modal.getByRole("button", { name: "Add", exact: true }))
      .last()
      .click();
    await p.waitForLoadState("networkidle").catch(() => undefined);
    // The popup closes and the toggle now names the person.
    await toggle.filter({ hasText: login }).waitFor({ timeout: 8_000 });
  }

  /**
   * Add each item to the cart, landing on the cart review (/self/requestAssignments).
   * Retry the whole add (the click occasionally no-ops and the search panel can
   * 500 — see header). Idempotent: skip if a prior attempt already added it.
   *
   * For an on-behalf request (`submission.for`), the person of interest is
   * (re)selected at the top of each attempt BEFORE the catalog drill — the
   * catalog only lists that person's eligible roles once they're selected.
   */
  private async addItemsToCart(submission: RequestSubmission): Promise<void> {
    const p = this.page;
    const forLogins = submission.for ?? [];
    for (const item of submission.items) {
      await retryUntil(async () => {
        // Self request: quick early-skip if already in the cart. For an on-behalf
        // request the person-of-interest (and cart) reset on a fresh load, so skip
        // the early check and (re)select the person each attempt before adding.
        if (!forLogins.length) {
          await p.goto(`${this.baseUrl}/self/requestAssignments`);
          await p.waitForLoadState("networkidle").catch(() => undefined);
          if (await p.getByText(item.access, { exact: false }).first().isVisible().catch(() => false)) return true;
        }

        await p.goto(`${this.baseUrl}/self/assignmentShoppingCart`);
        await p.waitForLoadState("networkidle").catch(() => undefined);
        for (const login of forLogins) await this.selectPersonOfInterest(login);
        if (item.view) await this.selectView(item.view);
        if (item.catalog?.length) await this.navigateCatalog(item.catalog);
        const tile = p.locator(".shopping-cart-item-box", { hasText: item.access });
        await tile.first().waitFor({ timeout: 10000 });
        await clickAjax(p, tile.locator(".shopping-cart-item-button-add").first());
        await p.goto(`${this.baseUrl}/self/requestAssignments`);
        await p.waitForLoadState("networkidle").catch(() => undefined);
        return p
          .getByText(item.access, { exact: false })
          .first()
          .waitFor({ timeout: 8000 })
          .then(() => true)
          .catch(() => false);
      }, `add "${item.access}"${forLogins.length ? ` for ${forLogins.join(", ")}` : ""} to cart`);
    }
  }

  /** On the cart review ("New assignments list"), a single "Request" submits. */
  private async submitCart(submission: RequestSubmission): Promise<void> {
    const p = this.page;
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

  /** Submit a self-service access request (one or more items). 4.0's UI matches 4.4. */
  async request(submission: RequestSubmission): Promise<void> {
    await this.addItemsToCart(submission);
    await this.submitCart(submission);
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
   * Switch the catalog to a logical view. 4.0's cart UI has a tab per view, labelled
   * "<base> view" (e.g. "All roles view"); map the logical key to that tab.
   */
  private async selectView(view: CatalogView): Promise<void> {
    const p = this.page;
    const label = `${VIEW_LABELS[view]} view`;
    await p.getByRole("link", { name: label }).or(p.getByText(label, { exact: true })).first().click().catch(() => undefined);
    await p.waitForLoadState("networkidle").catch(() => undefined);
  }

  /** Drill the role-catalog org tree to a leaf org and select it (see pages/4.4.ts). */
  private async navigateCatalog(path: string[]): Promise<void> {
    const p = this.page;
    for (const org of path.slice(0, -1)) {
      const node = p.locator(".tree-node", { hasText: org }).first();
      await node.waitFor({ timeout: 8000 });
      const junction = node.locator("a[class*=tree-junction]").first();
      if (((await junction.getAttribute("class")) ?? "").includes("collapsed")) await clickAjax(p, junction);
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
    return p
      .locator(".shopping-cart-item-box")
      .evaluateAll((els: any[]) => els.map((e) => (e.innerText || "").split("\n")[0].trim()).filter(Boolean));
  }
}

/** The approver's work-item inbox. */
class WorkItemsPage40 implements WorkItemsPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /**
   * Approve/reject the work item whose name contains `requestMatch` (/admin/myWorkItems;
   * the /self/* variants 403), optionally with an approver comment. Without a comment
   * the inbox inline Approve/Reject button is fastest. WITH a comment, drive the
   * work-item DETAIL page, which carries the approver-comment field AND the decision
   * controls — the latter rendered as `<div class="btn btn-success|btn-danger">` (NOT
   * a <button>, which is why they're easy to miss). Both paths end on a "Yes" confirm.
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
    // A confirm dialog ("Yes") completes the work item; wait for it then click.
    const yes = p.getByRole("link", { name: "Yes" }).or(p.getByRole("button", { name: "Yes" }));
    await yes.first().waitFor({ timeout: 5000 }).then(() => clickAjax(p, yes.first())).catch(() => undefined);
  }

  /** Bulk approve/reject many work items at once from the inbox (shared across versions). */
  async decideBulk(matches: string[], decision: WorkItemDecision): Promise<void> {
    await bulkDecide(this.page, this.baseUrl, matches, decision.outcome);
  }

  /**
   * FORWARD (転送) the work item matching `requestMatch` to `toUser`: click the
   * item's Forward action, pick the target user in the dialog, and confirm — the
   * forwarder is replaced as the approver. Selectors verified against the 4.0 UI.
   */
  async forward(requestMatch: string, toUser: string): Promise<void> {
    const p = this.page;
    const visible = (l: Locator, timeout: number) =>
      l.waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
    // The WHOLE forward is retried as one unit (each try re-navigates, so it's a
    // clean reload): open the work item → Forward → pick the user → confirm. The
    // Forward button and the user picker are Wicket AjaxLinks, and an Ajax click
    // occasionally no-ops (the dialog never opens / the pick doesn't register) —
    // a single-shot wait there would dead-time out. Re-driving the whole flow
    // absorbs that race; the commit is confirmed by the picker dialog CLOSING
    // (the item leaves this inbox), so a half-applied click fails the attempt.
    await retryUntil(async () => {
      await p.goto(`${this.baseUrl}/admin/myWorkItems`);
      // The inbox row has several links — open the DETAIL page via the one carrying
      // the work-item name (no auto-refresh, so the reload above is what surfaces it).
      const link = p.locator("tr", { hasText: requestMatch }).locator("a").filter({ hasText: requestMatch }).first();
      if (!(await link.waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) return false;
      await link.click();
      // Detail button bar: Approve/Reject/Forward as AjaxLinks (`div.btn`, not <button>).
      const forwardBtn = p.locator(".main-button-bar .btn", { hasText: "Forward" }).first();
      if (!(await visible(forwardBtn, 15000))) return false;
      await clickAjax(p, forwardBtn);
      // "Choose object" dialog: a user table; clicking the target's link forwards.
      const dialog = p.locator(".modal.in, .modal.show, .wicket-modal, .modal-content").first();
      if (!(await visible(dialog, 10000))) return false;
      const userLink = dialog.locator("a").filter({ hasText: toUser }).first();
      if (!(await visible(userLink, 10000))) return false;
      await clickAjax(p, userLink);
      // Forward committed once the picker closes (the item moves to `toUser`).
      return await dialog.waitFor({ state: "hidden", timeout: 10000 }).then(() => true).catch(() => false);
    }, `forward work item "${requestMatch}" to ${toUser}`);
  }
}

/**
 * The left-nav menu, as shown to the logged-in principal. 4.0/4.4 use the
 * AdminLTE sidebar `aside.main-sidebar ul.sidebar-menu`; a top-level item is a
 * `> li > a`, its submenu items are `> ul.treeview-menu > li > a`. The submenu
 * markup is in the DOM even while collapsed, so the whole tree reads from
 * `textContent` in ONE pass — no expand clicks (robust, no Wicket-Ajax races).
 * Section headers (`li.header`) are separators, excluded.
 * (later: 4.8/4.10's new UI use a different left-menu DOM — add their own reader.)
 */
class NavMenuPage40 implements NavMenuPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  async items(): Promise<string[][]> {
    const p = this.page;
    // The sidebar is on every admin page; land on the dashboard for a stable read.
    await p.goto(`${this.baseUrl}/self/dashboard`);
    await p.locator("aside.main-sidebar ul.sidebar-menu").first().waitFor({ timeout: 10000 });
    // NOTE: no named inner functions in this browser callback — tsx/esbuild's
    // keep-names would wrap them with `__name(...)`, undefined in the page context.
    return p.locator("aside.main-sidebar ul.sidebar-menu > li").evaluateAll((lis: any[]) => {
      const paths: string[][] = [];
      for (const li of lis) {
        if (li.classList.contains("header")) continue; // section separator, not an item
        const anchor = li.querySelector(":scope > a");
        // The top-level label: the anchor's own text, sans the submenu it wraps.
        const labelEl = anchor ? anchor.querySelector("span") ?? anchor : null;
        const label = (labelEl?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!label) continue;
        const subs: string[] = [];
        for (const a of li.querySelectorAll(":scope > ul.treeview-menu > li > a")) {
          const t = (a.textContent ?? "").replace(/\s+/g, " ").trim();
          if (t) subs.push(t);
        }
        if (subs.length) for (const s of subs) paths.push([label, s]);
        else paths.push([label]);
      }
      return paths;
    });
  }
}

/**
 * The self-service profile page (`/self/profile`). 4.0/4.4 render each focus
 * property as `.prism-property` with a `.prism-property-label` and a
 * `.prism-property-value` holding the input(s). A field is EDITABLE when any of its
 * value inputs is not disabled and not read-only — the signal a scenario asserts
 * (the editable set varies by subtype). Read in ONE DOM pass, no Wicket-Ajax races.
 * (later: 4.8/4.10's new UI render the profile differently — add their own reader.)
 */
class ProfilePage40 implements ProfilePage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  async fields(): Promise<ProfileField[]> {
    const p = this.page;
    await p.goto(`${this.baseUrl}/self/profile`);
    await p.locator(".prism-property").first().waitFor({ timeout: 10000 });
    // NOTE: no named inner functions in this browser callback — tsx/esbuild's
    // keep-names would wrap them with `__name(...)`, undefined in the page context.
    return p.locator(".prism-property").evaluateAll((props: any[]) => {
      const out: { label: string; editable: boolean }[] = [];
      for (const prop of props) {
        const labelEl = prop.querySelector(".prism-property-label");
        const label = (labelEl?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!label) continue;
        const inputs = [
          ...prop.querySelectorAll(
            ".prism-property-value input:not([type=hidden]), .prism-property-value select, .prism-property-value textarea",
          ),
        ].filter((i: any) => i.type !== "submit" && i.type !== "button");
        if (!inputs.length) continue;
        out.push({ label, editable: inputs.some((i: any) => !i.disabled && !i.readOnly) });
      }
      return out;
    });
  }
}

/**
 * The org tree (`/admin/org/tree`). A node is a `span.tree-content` holding the
 * org's name link + a `button.dropdown-toggle` whose menu has "Create child"; the
 * child opens the SAME new-org form but with the parent pre-set as an assignment
 * (so a bare parentOrgRef, which midPoint rejects, is avoided). Collapsed branches
 * expand via `a.tree-junction-collapsed` (see the catalog notes above), so a parent
 * nested below the visible roots (e.g. a freshly-created project-root) can be reached.
 *
 * The Basic tab is a list of `.prism-property` rows; we fill each by its visible
 * label. A lookup-backed field (the subtype, label "組織タイプ" here) is an
 * AUTOCOMPLETE: typing pops `.wicket-aa` suggestions whose KEY the field stores,
 * so we select the suggestion whose displayed label equals the given value. A plain
 * field is just typed. The created end-state is asserted by the REST `expect`
 * check — this only drives the input.
 */
class OrgTreePage40 implements OrgTreePage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  async createChild(parent: string, attributes: Record<string, string>): Promise<void> {
    const p = this.page;
    await this.openCreateChildForm(parent);

    await p.locator(".prism-property").first().waitFor({ timeout: 15000 });
    for (const [label, value] of Object.entries(attributes)) {
      await this.fillField(label, value);
    }

    // The main form's primary Save — a Wicket AjaxLink rendered as `<a class="btn
    // btn-primary">` (NOT a <button>, and no clean accessible name), and the only
    // visible primary control on the org form (Back/Preview/Edit-raw are non-primary).
    await clickAjax(p, p.locator(".btn-primary:visible").first());
    await p.waitForURL(/\/admin\/org\/(tree|unit)/, { timeout: 30000 }).catch(() => {});
  }

  /**
   * Open the parent node's "Create child" form. Wrapped in a RETRY because the org
   * tree re-renders on each AJAX expand, so a freshly-revealed row (a nested parent
   * like a just-created project-root) can detach mid-click; on failure we reload the tree
   * and try again from scratch.
   */
  private async openCreateChildForm(parent: string): Promise<void> {
    const p = this.page;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await p.goto(`${this.baseUrl}/admin/org/tree`, { waitUntil: "domcontentloaded" });
        const node = await this.revealNode(parent);
        // Let the tree settle after the last expand before touching the node.
        await p.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const toggle = node.locator("button.dropdown-toggle").first();
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click({ timeout: 10000 }); // node menu is a client-side bootstrap dropdown
        const createChild = node.getByRole("link", { name: "Create child" });
        await createChild.waitFor({ state: "visible", timeout: 5000 });
        await clickAjax(p, createChild);
        // Confirm the new-org form started to open before returning.
        await p.locator(".prism-property, .btn-primary").first().waitFor({ timeout: 10000 });
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  /**
   * Locate the parent node, expanding collapsed branches (depth-first) until visible.
   * The org tree splits ROOT orgs across tabs (`a.tab-label`, one per root) and only
   * the active tab's tree is rendered — so the default tab may not hold the target
   * (the root that owns the target org need not be the default-selected tab).
   * Try each root tab in turn, expanding within it, until the node appears.
   */
  private async revealNode(name: string): Promise<Locator> {
    const p = this.page;
    const node = () =>
      p.locator("span.tree-content").filter({ has: p.getByRole("link", { name, exact: true }) }).first();
    const expandToNode = async (): Promise<boolean> => {
      for (let i = 0; i < 40; i++) {
        if ((await node().count()) > 0 && (await node().isVisible().catch(() => false))) return true;
        const collapsed = p.locator("a.tree-junction-collapsed").first();
        if ((await collapsed.count()) === 0) return false;
        await clickAjax(p, collapsed);
      }
      return false;
    };
    const tabs = p.locator("a.tab-label");
    const tabCount = await tabs.count();
    if (tabCount === 0) {
      await expandToNode();
      return node();
    }
    for (let t = 0; t < tabCount; t++) {
      await clickAjax(p, tabs.nth(t));
      await p.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      if (await expandToNode()) return node();
    }
    return node();
  }

  /** Fill one Basic-tab property by visible label; select the match if it's a lookup autocomplete. */
  private async fillField(label: string, value: string): Promise<void> {
    const p = this.page;
    const labelRe = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`);
    const prop = p
      .locator(".prism-property")
      .filter({ has: p.locator(".prism-property-label, .control-label, label").filter({ hasText: labelRe }) })
      .first();
    const input = prop.locator("input:not([type=hidden]), textarea").first();
    await input.click();
    await input.fill("");
    await input.pressSequentially(value, { delay: 20 });

    // Lookup field → `.wicket-aa` suggestions appear; pick the one whose label == value.
    const suggestion = p
      .locator(".wicket-aa li")
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`) })
      .first();
    try {
      await suggestion.waitFor({ state: "visible", timeout: 1500 });
      await clickAjax(p, suggestion);
    } catch {
      await input.press("Tab"); // plain field: blur to sync the Wicket model
    }
  }
}

/** The 4.0 reference module: a factory per screen the harness drives. */
/**
 * Admin-driven assignment via the OLD UI (4.0/4.4 "shopping-cart era"): the
 * edit-user page has top tabs; Assignments is a tab, "New assignment" opens a
 * `.wicket-modal` "Select object(s)" picker with per-type tabs and a FACETED Name
 * search (same modal/facet pattern as the on-behalf person picker above). Verified
 * on 4.0 against the role flow.
 */
class AdminAssignPage40 implements AdminAssignPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /** The picker tab label per target kind (4.0 abbreviates Org/Service). */
  private static readonly TAB: Record<AssignTargetKind, string> = { role: "Role", org: "Org", service: "Service" };

  async assign(user: string, kind: AssignTargetKind, name: string): Promise<void> {
    if (kind !== "role") {
      throw new Error(`assign-ui: the 4.0 page object currently implements only 'role' (got '${kind}').`);
    }
    const p = this.page;
    const tab = AdminAssignPage40.TAB[kind];

    // 1. Users list → open the user's edit page (retry absorbs the 4.0 list raciness).
    await retryUntil(async () => {
      await p.goto(`${this.baseUrl}/admin/users`);
      await p.waitForLoadState("networkidle").catch(() => undefined);
      const link = p.getByRole("link", { name: user, exact: true }).first();
      if (!(await link.isVisible().catch(() => false))) return false;
      await link.click();
      return p.waitForURL(/\/admin\/user\//, { timeout: 8_000 }).then(() => true).catch(() => false);
    }, `open user ${user}`);

    // 2. Assignments tab.
    await clickAjax(p, p.getByRole("link", { name: /^Assignments/ }).first());

    // 3. "New assignment" → the "Select object(s)" modal. Its title's odd whitespace
    //    isn't a reliable accessible name, so target the button by its icon.
    await clickAjax(p, p.locator("button:has(i.fe-assignment)").first());
    const modal = p.locator(".wicket-modal").first();
    await modal.waitFor({ state: "visible", timeout: 10_000 });

    // 4. Faceted Name search → check the row → Add (Member relation, the default).
    //    Same modal/facet pattern as selectPersonOfInterest. The picker opens on the
    //    Role tab (the default), so a role needs no tab switch; org/service (a
    //    follow-up) would select their `tab` here first.
    void tab;
    await facetNameSearchAndCheck(p, modal, name);
    await modal
      .getByRole("link", { name: "Add", exact: true })
      .or(modal.getByRole("button", { name: "Add", exact: true }))
      .last()
      .click();
    await p.waitForLoadState("networkidle").catch(() => undefined);

    // 5. Save (an `<a>` in the old UI).
    await p.getByRole("link", { name: "Save", exact: true }).or(p.getByRole("button", { name: "Save", exact: true })).first().click();
    await p.waitForURL((u) => !/\/admin\/user\//.test(u.toString()), { timeout: 30_000 }).catch(() => undefined);
  }

  async unassign(user: string, kind: AssignTargetKind, name: string): Promise<void> {
    if (kind !== "role") {
      throw new Error(`unassign-ui: the 4.0 page object currently implements only 'role' (got '${kind}').`);
    }
    const p = this.page;

    // 1. Users list → open the user's edit page (same racy-list retry as assign).
    await retryUntil(async () => {
      await p.goto(`${this.baseUrl}/admin/users`);
      await p.waitForLoadState("networkidle").catch(() => undefined);
      const link = p.getByRole("link", { name: user, exact: true }).first();
      if (!(await link.isVisible().catch(() => false))) return false;
      await link.click();
      return p.waitForURL(/\/admin\/user\//, { timeout: 8_000 }).then(() => true).catch(() => false);
    }, `open user ${user}`);

    // 2. Assignments tab.
    await clickAjax(p, p.getByRole("link", { name: /^Assignments/ }).first());

    // 3. Mark the role's assignment for removal: its row carries an inline "Unassign"
    //    button (a "−" action). Clicking it flags the row (danger state) rather than
    //    deleting immediately; Save commits it. Scope by the unique target name.
    const row = p.locator("table tbody tr").filter({ hasText: name }).first();
    await row.waitFor();
    await clickAjax(p, row.locator('button[title="Unassign"], a[title="Unassign"]').first());

    // 4. Save (an `<a>` in the old UI).
    await p.getByRole("link", { name: "Save", exact: true }).or(p.getByRole("button", { name: "Save", exact: true })).first().click();
    await p.waitForURL((u) => !/\/admin\/user\//.test(u.toString()), { timeout: 30_000 }).catch(() => undefined);
  }
}

const pageObjects: PageObjectModule = {
  version: "4.0",
  login: (ctx: PageContext) => new LoginPage40(ctx.page, ctx.baseUrl),
  requestAccess: (ctx: PageContext) => new RequestAccessPage40(ctx.page, ctx.baseUrl),
  workItems: (ctx: PageContext) => new WorkItemsPage40(ctx.page, ctx.baseUrl),
  navMenu: (ctx: PageContext) => new NavMenuPage40(ctx.page, ctx.baseUrl),
  profile: (ctx: PageContext) => new ProfilePage40(ctx.page, ctx.baseUrl),
  orgTree: (ctx: PageContext) => new OrgTreePage40(ctx.page, ctx.baseUrl),
  adminAssign: (ctx: PageContext) => new AdminAssignPage40(ctx.page, ctx.baseUrl),
};

export default pageObjects;
