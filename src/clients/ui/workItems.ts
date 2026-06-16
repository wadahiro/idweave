/**
 * clients — the approver's work-item INBOX bulk action, shared by every midPoint major.
 * Unlike the request screen (old cart vs new wizard), the work-item list at
 * /admin/myWorkItems is the SAME component across versions: per-row checkboxes plus
 * a table-HEADER Approve/Reject button that acts on the SELECTED rows, finished with
 * a "Yes" confirm. So bulk-deciding many work items at once lives here ONCE.
 */
import type { Locator, Page } from "playwright";
import { clickAjax } from "./wicket.ts";

/**
 * Select the work items whose names contain each of `matches`, then Approve/Reject
 * them ALL at once from the inbox header (NOT the per-row buttons or the detail
 * page). The list doesn't auto-refresh and items land a beat after the request, so
 * reload until every matching row is present before selecting. A bulk decision
 * carries no per-item comment (the header action has no comment box).
 */
export async function bulkDecide(
  page: Page,
  baseUrl: string,
  matches: string[],
  outcome: "approve" | "reject",
): Promise<void> {
  const title = outcome === "approve" ? "Approve" : "Reject";
  const inbox = `${baseUrl}/admin/myWorkItems`;
  let rows: Locator[] = [];
  for (let attempt = 0; ; attempt++) {
    await page.goto(inbox);
    rows = matches.map((m) => page.locator("tr").filter({ hasText: m }).first());
    const present = await Promise.all(
      rows.map((r) => r.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)),
    );
    if (present.every(Boolean)) break;
    if (attempt >= 11) throw new Error(`bulk decide: not all of [${matches.join(", ")}] appeared in the inbox`);
  }
  // Tick each matching row's checkbox, then the table-HEADER bulk button (it acts on
  // the selection; the per-row buttons in <tbody> would decide a single item).
  for (const r of rows) await r.locator('input[type="checkbox"]').first().check();
  await clickAjax(page, page.locator(`thead button[title="${title}"]`).first());
  // A "Yes" confirm completes the selected work items.
  const yes = page.getByRole("link", { name: "Yes" }).or(page.getByRole("button", { name: "Yes" }));
  await yes.first().waitFor({ timeout: 5000 }).then(() => clickAjax(page, yes.first())).catch(() => undefined);
}
