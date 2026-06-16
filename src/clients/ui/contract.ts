/**
 * clients — version-agnostic page-object CONTRACT.
 *
 * The engine drives the midPoint GUI only for journeys REST can't do faithfully
 * (a self-service request as the requester, an approval as the approver — both
 * End users without REST access). Those journeys are version-dependent (selectors,
 * wizard steps change between midPoint majors), so the engine depends only on
 * these interfaces; the concrete screens live in a per-major-version REFERENCE
 * module (see `pages/<version>.ts`) and may be partially overridden per project.
 *
 * The line this file draws: steps, the driver's browser lifecycle, `clickAjax`
 * (Wicket-Ajax wait — common to every Wicket-based version) and these contracts
 * are version-AGNOSTIC; everything behind a factory below is version-DEPENDENT.
 */
import type { Page } from "playwright";

/**
 * Logical name of a request-screen view/tab — version- and locale-INDEPENDENT.
 * A scenario names the view by INTENT; each version's page object maps it to that
 * UI's actual control (the old "shopping cart" tabs vs the new wizard left-nav),
 * so the scenario never carries a fragile UI label.
 */
export type CatalogView = "role-catalog" | "all-roles" | "all-organizations" | "all-services";

/**
 * Default base label per logical view. The OLD cart UI suffixes " view" on its
 * tabs ("All roles view"); the NEW wizard uses the base as a left-nav item
 * ("All roles"). A project override can replace these for a non-English UI.
 */
export const VIEW_LABELS: Record<CatalogView, string> = {
  "role-catalog": "Role catalog",
  "all-roles": "All roles",
  "all-organizations": "All organizations",
  "all-services": "All services",
};

/** The login screen. */
export interface LoginPage {
  /**
   * Log `user` in with `password`. If the current page is already the IdP login
   * (an app redirected here), complete it in place; otherwise trigger login.
   * Returns once authenticated — landing-agnostic (an OIDC redirect off the IdP
   * onto an app, OR a same-origin Keycloak console); throws if credentials are
   * rejected.
   */
  login(user: string, password: string): Promise<void>;
  /** Is the current page this provider's login form? Lets `ui-flow`/openUrl log in via an app's own redirect. */
  isAtLoginPage?(): Promise<boolean>;
}

/** One access item to put in the request cart. */
export interface RequestItem {
  /**
   * Display name of the requestable ACCESS — a role, org or service (all
   * AbstractRoleType in midPoint).
   */
  access: string;
  /**
   * Which catalog view/tab to find it under, by LOGICAL name ({@link CatalogView}).
   * Omitted → the version's default (the role catalog). The page object maps the
   * logical name to its UI's actual control.
   */
  view?: CatalogView;
  /**
   * For a role-catalog (org-tree) view: the org names to drill through, root →
   * leaf, before the access is listed (it's a member of the leaf org).
   */
  catalog?: string[];
  /**
   * Optional PER-ROLE assignment validity start (ISO date) — this item's OWN
   * window. New UI: the role's Edit (pencil) dialog; old UI: that role's expand
   * panel. Mutually exclusive with the request-level bulk validity
   * ({@link RequestSubmission.validFrom}/`validTo`): a request sets validity at
   * one scope, not both (see RequestSubmission).
   */
  validFrom?: string;
  /** Optional per-role assignment validity end (ISO date). See `validFrom`. */
  validTo?: string;
  /** Optional relation for the assignment (e.g. "Default"/"Manager"/"Approver"/"Owner"). */
  relation?: string;
}

/** A whole self-service request: what, for whom, with an optional comment. */
export interface RequestSubmission {
  /** One or more access items requested together. */
  items: RequestItem[];
  /**
   * Persons of interest the access is requested FOR (logins). Omitted/empty →
   * the requester themselves.
   */
  for?: string[];
  /** Optional request-level comment. */
  comment?: string;
  /**
   * Optional request-level (BULK) assignment validity start (ISO date) — ONE
   * window applied to ALL items at once. New UI: the cart's "Custom length"
   * panel; old UI: the same window looped onto every assignment's expand panel.
   * Mutually exclusive with per-item validity ({@link RequestItem.validFrom}/
   * `validTo`): a request expresses validity at the bulk scope OR the per-role
   * scope, never both (combining is rejected upstream — on both new-UI versions
   * the bulk silently wins, so it isn't portably assertable).
   */
  validFrom?: string;
  /** Optional request-level (bulk) assignment validity end (ISO date). See `validFrom`. */
  validTo?: string;
}

/** Where to look on the request screen when browsing what's requestable. */
export interface BrowseOptions {
  /** Catalog view/tab to look under, by LOGICAL name ({@link CatalogView}). */
  view?: CatalogView;
  /** Role-catalog org path to drill through (root → leaf) before reading the list. */
  catalog?: string[];
  /** Persons of interest to request FOR (logins). Omitted → the requester themselves. */
  for?: string[];
}

/** The self-service "Request access" journey. */
export interface RequestAccessPage {
  /** Submit a self-service access request (one or more items, for one or more people). */
  request(submission: RequestSubmission): Promise<void>;
  /**
   * Drive the same request flow but EXPECT it to be REJECTED: fill the cart and
   * submit, then return the error/feedback text the GUI shows (e.g. a policy
   * violation). Throws if the request unexpectedly SUCCEEDS (reaches the
   * post-submit dashboard). Lets a scenario assert that a requestable-but-policy-
   * blocked access shows an error instead of provisioning — a GUI-only signal
   * that isn't in the REST end-state. Same submission shape as `request`.
   */
  requestExpectingError(submission: RequestSubmission): Promise<string>;
  /**
   * Read-only: the display names of accesses currently shown as requestable at the
   * given view/catalog position (for the given persons of interest). Lets a
   * scenario assert what IS / ISN'T available — which depends on the operator's and
   * the POI's authorizations, so it isn't visible in the REST end-state.
   */
  listRequestable(opts: BrowseOptions): Promise<string[]>;
}

/** An approver's decision on a work item. */
export interface WorkItemDecision {
  /** Approve the request (let it proceed) or reject it (deny). */
  outcome: "approve" | "reject";
  /** Optional approver comment recorded on the decision. */
  comment?: string;
}

/** The approver's work-item inbox. */
export interface WorkItemsPage {
  /**
   * Decide (approve or reject) the work item whose name matches `requestMatch`
   * (e.g. the role name), optionally leaving an approver comment.
   */
  decide(requestMatch: string, decision: WorkItemDecision): Promise<void>;
  /**
   * BULK-decide: approve or reject MANY work items at once from the inbox — select
   * every item whose name contains one of `matches`, then apply the single header
   * Approve/Reject to the whole selection (not the per-row buttons or the detail
   * page). A bulk decision carries no per-item comment.
   */
  decideBulk(matches: string[], decision: WorkItemDecision): Promise<void>;
  /**
   * FORWARD (転送) the work item matching `requestMatch` to another user — REPLACE
   * the current approver with `toUser`, so the forwarder drops off the actors and
   * `toUser` becomes the new approver; the item then appears in `toUser`'s inbox to
   * decide. Optional — only the versions whose work-item UI supports forwarding
   * implement it (the `forward-ui` step errors clearly otherwise).
   */
  forward?(requestMatch: string, toUser: string): Promise<void>;
}

/** The left navigation menu — what the logged-in principal is shown. */
export interface NavMenuPage {
  /**
   * The visible menu entries as PATHS (root → leaf): a top-level leaf is a
   * one-element path (`["Home"]`), a submenu item carries its parent
   * (`["Users", "All users"]`). Section headers are excluded. The set varies with
   * the principal's authorizations — the signal a scenario asserts, which the REST
   * end-state can't reveal.
   */
  items(): Promise<string[][]>;
}

/** A field on the self-service profile page, with whether the principal may EDIT it. */
export interface ProfileField {
  /** The field's visible label (e.g. "Family Name"). */
  label: string;
  /** True when the principal can edit it (an editable input); false when read-only. */
  editable: boolean;
}

/**
 * The self-service profile page — which fields the logged-in principal may edit.
 * The editable SET varies with the principal's subtype/authorizations (the GUI
 * derives it from config), which the REST end-state can't reveal — hence a GUI
 * assertion, as a principal, read-only. Sibling of {@link NavMenuPage}.
 */
export interface ProfilePage {
  /** Each profile field's label + whether it is editable (read order, deduped by the reader). */
  fields(): Promise<ProfileField[]>;
}

/**
 * The organization tree screen — create a child org under a parent node, the way
 * an operator stands up a project-root or project. `createChild` opens the parent node's
 * "Create child" action (so the parent is pre-set as an assignment), fills the
 * new-org form fields BY THEIR VISIBLE LABEL, and saves. A field bound to a lookup
 * (e.g. the subtype) renders as an autocomplete — the impl detects suggestions and
 * selects the matching one; a plain field is typed. The created end-state
 * (auto-assigned metarole, generated child roles) is asserted by the REST `expect`
 * check, not here.
 */
export interface OrgTreePage {
  createChild(parent: string, attributes: Record<string, string>): Promise<void>;
}

/** A target kind an admin can assign through the user-edit GUI. */
export type AssignTargetKind = "role" | "org" | "service";

/**
 * The admin-driven assignment screen — an OPERATOR (not the end user) grants a
 * target to a user through the full edit-user GUI: find the user in the list,
 * open it, the Assignments panel, the "New" picker, select the target, save (with
 * the Default relation). This is what REST `assign` does, but exercised as the
 * real multi-step Wicket flow (the screen IS the thing under test). The induced
 * end-state is asserted by the REST `expect` check, not here.
 */
export interface AdminAssignPage {
  /** Assign `name` (a `kind` object, by name) to `user` (by name), Default relation. */
  assign(user: string, kind: AssignTargetKind, name: string): Promise<void>;
  /** Remove `user`'s existing assignment of `name` (a `kind` object) via the same edit-user GUI, then save. */
  unassign(user: string, kind: AssignTargetKind, name: string): Promise<void>;
}

/** What a page-object factory is handed: a logged-in browser page + the GUI base URL. */
export interface PageContext {
  page: Page;
  baseUrl: string;
  /**
   * Timeout (ms) for the login's first contact with the IdP (cold-start gate).
   * The login provider uses it for the initial navigation + login-form wait;
   * everything else keeps the page's 30s default. Omitted → provider default.
   */
  loginTimeoutMs?: number;
  /**
   * Authenticated route the login provider navigates to in order to TRIGGER login
   * (an app/console behind the IdP). Absolute, or a path joined to `baseUrl`.
   * Default `/self/dashboard` (the midPoint GUI). Set it to e.g. a Keycloak
   * Account Console (`/realms/<realm>/account`) or Admin Console (`/admin/`) to
   * smoke-test those same-origin logins.
   */
  loginTarget?: string;
}

/** Read a received mail's body inside a flow — e.g. to extract an emailed code the user types. */
export interface MailReader {
  /** The plain-text body of the latest message to `to` (optionally filtered by subject), polled until it arrives. */
  text(opts: { to: string; subject?: string }): Promise<string>;
}

/** What a {@link CustomFlow} is handed: the live page, the GUI base URL, and a mail reader. */
export type FlowContext = PageContext & { mail: MailReader };

/**
 * A project-defined custom journey over a DEPLOYMENT-SPECIFIC page — not a stock
 * midPoint screen, so it has no reference implementation. Examples: a self-service
 * app's invitation form, or a Keycloak custom-required-action registration
 * (profile + password), or a self-activation that reads an emailed code via
 * `ctx.mail`. Driven by the `ui-flow` step on whichever page is open at that point
 * (a freshly opened URL, or the page an email link landed on). The params are the
 * step's `with:` data; the flow owns the selectors (kept in the project's override
 * module, never in idweave or the scenario YAML).
 */
export type CustomFlow = (ctx: FlowContext, params: Record<string, string>) => Promise<void>;

/**
 * A page-object module: one factory per screen the harness drives. A REFERENCE
 * module (per major version) implements them all; a project OVERRIDE module
 * supplies only the screens it deviates on (the rest fall through to reference).
 * That is why every factory is optional here — the loader validates that, after
 * merging override over reference, the required ones are present.
 */
export interface PageObjectModule {
  /** Major midPoint version a reference module targets (informational/diagnostic). */
  version?: string;
  login?: (ctx: PageContext) => LoginPage;
  requestAccess?: (ctx: PageContext) => RequestAccessPage;
  workItems?: (ctx: PageContext) => WorkItemsPage;
  /** Optional: the left-nav menu reader (a version may not implement it yet). */
  navMenu?: (ctx: PageContext) => NavMenuPage;
  /** Optional: the self-service profile field reader (a version may not implement it yet). */
  profile?: (ctx: PageContext) => ProfilePage;
  /** Optional: the org tree (create project-root/project orgs); a version may not implement it yet. */
  orgTree?: (ctx: PageContext) => OrgTreePage;
  /** Optional: the admin-driven assignment screen (assign-ui); a version may not implement it yet. */
  adminAssign?: (ctx: PageContext) => AdminAssignPage;
  /** Project custom journeys over deployment-specific pages, driven by `ui-flow`. */
  flows?: Record<string, CustomFlow>;
}

/**
 * A page-object module with every REQUIRED factory present (post-merge,
 * validated). `navMenu` stays optional — only the `expect-menu` step needs it, so
 * a version without it still resolves; the step errors clearly if used.
 */
export interface ResolvedPageObjects {
  login: (ctx: PageContext) => LoginPage;
  /**
   * Resolve a login factory by auth TYPE — for a suite with named logins
   * (`gui.logins`) that drives more than one provider (e.g. midPoint's native
   * form AND Keycloak consoles). Omitted/`midpoint` → the version's own
   * login; a registered provider name (e.g. `keycloak`) → that provider. `login`
   * above stays the suite-default (from `gui.auth`).
   */
  loginFor: (type: string | undefined) => (ctx: PageContext) => LoginPage;
  requestAccess: (ctx: PageContext) => RequestAccessPage;
  workItems: (ctx: PageContext) => WorkItemsPage;
  navMenu?: (ctx: PageContext) => NavMenuPage;
  profile?: (ctx: PageContext) => ProfilePage;
  orgTree?: (ctx: PageContext) => OrgTreePage;
  adminAssign?: (ctx: PageContext) => AdminAssignPage;
  /** Project custom journeys (empty when no override supplies any). */
  flows: Record<string, CustomFlow>;
}
