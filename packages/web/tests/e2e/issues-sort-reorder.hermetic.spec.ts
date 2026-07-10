import { type Page, type Request, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

/**
 * REEF-325: editing a non-membership field (title / labels / due date / …) must
 * refetch the `updated_at`-sorted list variants — the ones every edit reorders,
 * because the server restamps `updated_at` on every PATCH. The old
 * `useUpdateIssue` non-membership branch only refetched free-text (`q`) variants,
 * so those "Recently updated" caches drifted out of true server order until the
 * 60s stale window (a low-severity, self-healing staleness).
 *
 * The refetch is the isolable, guarded behavior. The list *view* also re-sorts
 * client-side (`IssueListTable` → `sortIssues`) over the in-place-patched cache,
 * so the visible row order corrects itself even without the refetch — which is
 * why this spec asserts the network refetch fires (the thing REEF-325 changes),
 * not just the final order. Without the fix the `updated_at`-sorted variant is
 * never re-requested and the count below never advances. The final-order check is
 * a secondary sanity assertion (server order and client sort agree).
 */
function countUpdatedAtListFetches(page: Page): () => number {
  let count = 0;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.get("sort_field") === "updated_at"
    ) {
      count += 1;
    }
  });
  return () => count;
}

test.describe("Hermetic issue-list sort re-order on edit (REEF-325)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("a non-membership edit refetches the updated_at-sorted list and re-sorts it", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const updatedAtFetches = countUpdatedAtListFetches(page);

    // Sort by "Recently updated" (updated_at desc). The configured fixture seeds
    // every row with the same updated_at, so the initial order falls to the
    // reef_id tiebreak (desc) — REEF-002 sits above REEF-001.
    await page.goto("/workspace/reef-e2e/issues?view=list&sort=updated_at");

    const rows = page.locator('[data-testid="issue-list-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    // The list loaded through an updated_at-sorted `/api/issues` request.
    await expect.poll(updatedAtFetches).toBeGreaterThan(0);

    // The row order as reef ids, read from the row's stable semantic id. The
    // leading cell is reserved for multi-selection and intentionally has no
    // display text.
    const orderedIds = (): Promise<string[]> =>
      rows.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-issue-id") ?? ""),
      );
    const indexOf = async (id: string): Promise<number> =>
      (await orderedIds()).indexOf(id);

    // Before the edit: REEF-001 sits below REEF-002 (updated_at tie → id desc).
    // The list can first paint from the default cache, then settle after the
    // updated_at request returns; poll the row order instead of sampling once.
    await expect
      .poll(async () => {
        const alpha = await indexOf("REEF-001");
        const beta = await indexOf("REEF-002");
        return alpha >= 0 && beta >= 0 && alpha > beta;
      })
      .toBe(true);

    // Open REEF-001 in the detail modal and rename it. The server restamps its
    // updated_at on the PATCH, and REEF-325 makes the edit refetch the
    // updated_at-sorted list that would otherwise drift stale.
    await rows.filter({ hasText: "REEF-001" }).first().click();
    const titleInput = page.locator('[data-testid="issue-title-input"]');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    await titleInput.fill("Initial issue Alpha (edited)");

    // Isolate the edit-driven refetch from the initial load / navigation.
    const beforeEdit = updatedAtFetches();
    await titleInput.press("Enter");

    // The REEF-325 fix: a non-membership edit refetches the updated_at-sorted
    // variant. This is the assertion the fix is required for.
    await expect
      .poll(updatedAtFetches, { timeout: 15_000 })
      .toBeGreaterThan(beforeEdit);

    // Sanity: the row is now first — the refreshed server order and the view's
    // client-side sort agree that the just-edited issue is most recent.
    await expect.poll(() => indexOf("REEF-001")).toBe(0);
  });
});
