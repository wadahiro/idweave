/**
 * Shared NEW-UI (4.4+) admin-driven assignment via the edit-user GUI: find the
 * user in the list, open it, the Assignments panel's per-type sub-tab, then either
 * the "New" picker (assign) or a row's inline "Unassign" mark (unassign), and save.
 * 4.4, 4.8 and 4.10 render this flow identically, so all three version modules reuse
 * this class (the old 4.0 UI is a separate impl). Verified end-to-end against the
 * running 4.10/4.8 stacks (role flow); unassign verified against 4.10.
 */
import type { Page } from "playwright";
import type { AdminAssignPage, AssignTargetKind } from "./contract.ts";
import { clickAjax } from "./wicket.ts";

/** The edit-user URL: /admin/user/<oid> (4.8/4.10) or /admin/userNew/<oid> (4.4) — not /admin/users. */
const EDIT_USER_URL = /\/admin\/user(?:New)?\//;

export class NewUiAdminAssign implements AdminAssignPage {
  constructor(private readonly page: Page, private readonly baseUrl: string) {}

  /** Assignments sub-tab + the picker share this label per target kind. */
  private static readonly TAB: Record<AssignTargetKind, string> = { role: "Role", org: "Organization", service: "Service" };

  /** Only `role` is implemented; org/service share the shape but are a deliberate follow-up. */
  private static assertRole(kind: AssignTargetKind, op: string): void {
    if (kind !== "role") {
      throw new Error(`${op}: the new-UI page object currently implements only 'role' (got '${kind}').`);
    }
  }

  /**
   * Open the user's edit page and scope to the Assignments panel's kind sub-tab —
   * shared by assign and unassign.
   *
   * 1. Users list → open the user's edit page (a real navigation). The user's name
   *    is a link in the list; the harness drives a known test user on the first page,
   *    so we click it directly (the list search box is unlabeled on 4.8, so a
   *    cross-version "Name" filter isn't reliable — the link match is). The edit-user
   *    URL is /admin/user/<oid> (4.8/4.10) or /admin/userNew/<oid> (4.4) — match both.
   * 2. Assignments panel → the kind's sub-tab. The sub-item's accessible name differs
   *    by version (4.8 = "Role"; 4.10 = "Role menu item. Child item of the Assignments
   *    menu item"), so match the kind word with \b on both sides (tolerate a leading
   *    icon space, and don't match the main-nav "Roles"/"Services").
   */
  private async openAssignments(user: string, kind: AssignTargetKind): Promise<void> {
    const p = this.page;
    const tab = NewUiAdminAssign.TAB[kind];
    await p.goto(`${this.baseUrl}/admin/users`);
    const userLink = p.getByRole("link", { name: user, exact: true }).first();
    await userLink.waitFor();
    await Promise.all([p.waitForURL(EDIT_USER_URL), userLink.click()]);
    await clickAjax(p, p.getByRole("link", { name: /Assignments/ }).first());
    await clickAjax(p, p.getByRole("link", { name: new RegExp(`\\b${tab}\\b`) }).first());
  }

  /**
   * Save the user (a full submit; the edit page closes back to the list). The Save
   * control's element varies by version — a <button> (4.10), an <a> (4.8), or a
   * <span class="btn"> (4.4) — so none of button/link role matches all; they all SHOW
   * the visible label "Save", so match that (a click bubbles to the clickable ancestor).
   */
  private async save(): Promise<void> {
    const p = this.page;
    const save = p.getByText("Save", { exact: true }).first();
    await save.waitFor();
    await Promise.all([
      p.waitForURL((u) => !EDIT_USER_URL.test(u.toString()), { timeout: 30_000 }).catch(() => undefined),
      save.click(),
    ]);
  }

  async assign(user: string, kind: AssignTargetKind, name: string): Promise<void> {
    NewUiAdminAssign.assertRole(kind, "assign-ui");
    const p = this.page;
    await this.openAssignments(user, kind);

    // "New" — the assignment-add icon link (title "New") below the panel's table.
    await clickAjax(p, p.locator('a[title="New"]').filter({ has: p.locator("i.fe-assignment") }).first());

    // "Select object(s)" picker: check the target's row, confirm with Add (the relation
    // select defaults to "Default"). The picker's search box is unlabeled on 4.8, so match
    // the row by its (unique) full name instead — the harness's target sits on the first page.
    const dialog = p.locator(".modal-dialog:visible").filter({ hasText: "Select object(s)" }).last();
    const row = dialog.locator("table tbody tr").filter({ hasText: name });
    await row.first().waitFor();
    await clickAjax(p, row.getByRole("checkbox").first());
    await clickAjax(p, dialog.getByRole("link", { name: "Add", exact: true }).first());

    await this.save();
  }

  async unassign(user: string, kind: AssignTargetKind, name: string): Promise<void> {
    NewUiAdminAssign.assertRole(kind, "unassign-ui");
    const p = this.page;
    await this.openAssignments(user, kind);

    // Mark the assignment for removal: each row carries an inline "Unassign" button
    // (title "Unassign", a "−" icon). Clicking it doesn't delete the row immediately —
    // it flags it (the row turns to the danger/strikethrough state); the save below
    // commits the removal. Scope to the row by the target's name (the harness's target
    // is unique in the panel).
    const row = p.locator("table tbody tr").filter({ hasText: name }).first();
    await row.waitFor();
    await clickAjax(p, row.locator('button[title="Unassign"]').first());

    await this.save();
  }
}
