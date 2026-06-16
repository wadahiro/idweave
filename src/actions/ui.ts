/**
 * actions — GUI domain actions.
 *
 * Thin verbs over the page objects, one per user journey. Used only where REST
 * is not faithful: a self-service request performed AS the requester, and an
 * approval performed AS the approver (both End users without REST access). The
 * resulting end-state is still asserted over REST in verify.
 */
import type { UiDriver } from "../clients/ui/driver.ts";
import type { AssignTargetKind, BrowseOptions, ProfileField, RequestSubmission, WorkItemDecision } from "../clients/ui/contract.ts";

/**
 * Log `login` in via the GUI and reach the authenticated dashboard. The login
 * itself is the assertion: the configured auth provider (native or SSO) throws
 * if it never lands on the post-login dashboard. A smoke for the auth wiring.
 */
export async function loginViaUi(ui: UiDriver, login: string, password: string): Promise<void> {
  await ui.sessionFor(login, password);
}

/**
 * As `login` (an operator/admin), assign a target to `user` via the edit-user GUI
 * (the admin-driven Assignments flow). Errors clearly when the suite's GUI version
 * has no admin-assign page object.
 */
export async function assignViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  user: string,
  kind: AssignTargetKind,
  name: string,
): Promise<void> {
  const session = await ui.sessionFor(login, password);
  if (!session.adminAssign) {
    throw new Error(
      "assign-ui needs an admin-assign page object, which this suite's GUI version doesn't implement yet.",
    );
  }
  await session.adminAssign.assign(user, kind, name);
}

/**
 * As `login` (an operator/admin), remove `user`'s existing assignment of a target via
 * the edit-user GUI (the admin-driven Assignments flow — the GUI counterpart of REST
 * `unassign`). Errors clearly when the suite's GUI version has no admin-assign page object.
 */
export async function unassignViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  user: string,
  kind: AssignTargetKind,
  name: string,
): Promise<void> {
  const session = await ui.sessionFor(login, password);
  if (!session.adminAssign) {
    throw new Error(
      "unassign-ui needs an admin-assign page object, which this suite's GUI version doesn't implement yet.",
    );
  }
  await session.adminAssign.unassign(user, kind, name);
}

/** As `login`, submit a self-service access request via the GUI. */
export async function requestAccessViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  submission: RequestSubmission,
): Promise<void> {
  const session = await ui.sessionFor(login, password);
  await session.requestAccess.request(submission);
}

/**
 * As `login`, submit a request EXPECTING it to be rejected; returns the GUI
 * error/feedback text (e.g. a policy violation). Throws if it unexpectedly
 * succeeds. For asserting a requestable-but-policy-blocked access shows an error.
 */
export async function requestExpectingErrorViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  submission: RequestSubmission,
): Promise<string> {
  const session = await ui.sessionFor(login, password);
  return session.requestAccess.requestExpectingError(submission);
}

/** As `login`, read what's requestable at the given view/catalog position (read-only). */
export async function listRequestableViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  opts: BrowseOptions,
): Promise<string[]> {
  const session = await ui.sessionFor(login, password);
  return session.requestAccess.listRequestable(opts);
}

/**
 * As `login`, read the visible left-nav menu entries (paths root → leaf). Throws
 * a clear error if the resolved GUI version has no menu reader (navMenu).
 */
export async function readMenuViaUi(ui: UiDriver, login: string, password: string): Promise<string[][]> {
  const session = await ui.sessionFor(login, password);
  if (!session.navMenu) {
    throw new Error(
      "expect-menu needs a navMenu page object, but the resolved GUI version doesn't implement one yet. " +
        "Add a navMenu factory to its pages/<version>.ts module.",
    );
  }
  return session.navMenu.items();
}

/**
 * As `login`, read the self-service profile fields (label + editable). Throws a
 * clear error if the resolved GUI version has no profile reader (profile).
 */
export async function readProfileFieldsViaUi(ui: UiDriver, login: string, password: string): Promise<ProfileField[]> {
  const session = await ui.sessionFor(login, password);
  if (!session.profile) {
    throw new Error(
      "expect-fields needs a profile page object, but the resolved GUI version doesn't implement one yet. " +
        "Add a profile factory to its pages/<version>.ts module.",
    );
  }
  return session.profile.fields();
}

/**
 * As `login` (an operator), create a child org under the `parent` tree node,
 * filling the new-org form fields by label (incl. the subtype). Drives INPUT only —
 * the auto-generated end-state is asserted over REST by `expect`. Throws clearly if
 * the resolved GUI version has no org-tree page object.
 */
export async function createOrgViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  parent: string,
  attributes: Record<string, string>,
): Promise<void> {
  const session = await ui.sessionFor(login, password);
  if (!session.orgTree) {
    throw new Error(
      "create-org-ui needs an orgTree page object, but the resolved GUI version doesn't implement one yet. " +
        "Add an orgTree factory to its pages/<version>.ts module.",
    );
  }
  await session.orgTree.createChild(parent, attributes);
}

/** As `login` (an approver), decide (approve/reject) the work item matching `requestMatch` via the GUI. */
export async function decideRequestViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  requestMatch: string,
  decision: WorkItemDecision,
): Promise<void> {
  const session = await ui.sessionFor(login, password);
  await session.workItems.decide(requestMatch, decision);
}

/** As `login` (an approver), BULK approve/reject every work item matching one of `matches` via the GUI. */
export async function decideBulkViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  matches: string[],
  decision: WorkItemDecision,
): Promise<void> {
  const session = await ui.sessionFor(login, password);
  await session.workItems.decideBulk(matches, decision);
}

/** As `login` (the current approver), FORWARD the work item matching `requestMatch` to `toUser`. */
export async function forwardWorkItemViaUi(
  ui: UiDriver,
  login: string,
  password: string,
  requestMatch: string,
  toUser: string,
): Promise<void> {
  const session = await ui.sessionFor(login, password);
  if (!session.workItems.forward) {
    throw new Error(
      "forward-ui needs a work-item page object that supports forwarding, but the resolved GUI version doesn't. " +
        "Implement WorkItemsPage.forward in its pages/<version>.ts module.",
    );
  }
  await session.workItems.forward(requestMatch, toUser);
}
