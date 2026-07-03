import { type Page, type Request, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

/**
 * REEF-370 — search debounce cadence.
 *
 * Every async search surface now routes through the single `useDebouncedQuery`
 * primitive with a named tier (`SEARCH_DEBOUNCE_WARM` = 150,
 * `SEARCH_DEBOUNCE_COLD` = 300). The exact millisecond values are asserted in the
 * unit test (`src/lib/useDebouncedQuery.test.ts`); measuring a precise ms window
 * in a browser is inherently flaky, so this spec instead proves the *runtime
 * contract* the tier drives: fast keystrokes coalesce into a single settled
 * request per surface (warm and cold alike), and an immediate enum-select surface
 * never routes through the debounced search path at all.
 */

/** Collect the debounced `/api/issues?q=` search requests (warm tier). The
 *  empty-query recent/list requests carry no `q` and are excluded. */
function collectIssueSearch(page: Page): string[] {
  const queries: string[] = [];
  page.on("request", (req: Request) => {
    const url = new URL(req.url());
    if (
      req.method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.has("q")
    ) {
      queries.push(url.searchParams.get("q") ?? "");
    }
  });
  return queries;
}

/** Collect the cold `/api/vault-members?q=` typeahead requests. The empty-open
 *  member list request carries no `q` and is excluded. */
function collectMemberSearch(page: Page): string[] {
  const queries: string[] = [];
  page.on("request", (req: Request) => {
    const url = new URL(req.url());
    if (
      req.method() === "GET" &&
      url.pathname === "/api/vault-members" &&
      url.searchParams.has("q")
    ) {
      queries.push(url.searchParams.get("q") ?? "");
    }
  });
  return queries;
}

test.describe("search debounce cadence (REEF-370)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("warm ⌘K palette coalesces fast keystrokes into one /api/issues?q request", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const searches = collectIssueSearch(page);

    await page.keyboard.press("Control+K");
    const input = page.locator('[data-testid="global-search-input"]');
    await expect(input).toBeVisible();

    const settled = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        res.ok() &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("q") === "Alpha"
      );
    });
    // Five characters ~30ms apart — far under the 150ms warm window, so every
    // prefix but the final settled value is debounced away.
    await input.pressSequentially("Alpha", { delay: 30 });
    await settled;

    // Only the coalesced final query reached the server (no per-keystroke prefixes).
    expect(searches).toEqual(["Alpha"]);
    // AC5: the warm-cache client re-filter still renders the matching issue.
    await expect(
      page.locator(
        '[data-testid="global-search-item"][data-issue-id="REEF-001"]',
      ),
    ).toBeVisible();
  });

  test("warm issues-list SearchBar coalesces keystrokes into one /api/issues?q request", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const searches = collectIssueSearch(page);

    const input = page.locator('[data-testid="search-input"]');
    await expect(input).toBeVisible();

    const settled = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        res.ok() &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("q") === "Beta"
      );
    });
    await input.pressSequentially("Beta", { delay: 30 });
    await settled;

    expect(searches).toEqual(["Beta"]);
  });

  test("cold assignee typeahead coalesces keystrokes into one /api/vault-members?q request", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const searches = collectMemberSearch(page);

    await page.locator('[data-testid="assignee-dropdown-trigger"]').click();
    const panel = page.locator('[data-testid="assignee-dropdown-content"]');
    await expect(panel).toBeVisible();
    const search = panel.getByRole("combobox");

    const settled = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        res.ok() &&
        url.pathname === "/api/vault-members" &&
        url.searchParams.get("q") === "ali"
      );
    });
    // Three characters ~30ms apart — far under the 300ms cold window.
    await search.pressSequentially("ali", { delay: 30 });
    await settled;

    // Only the coalesced final query reached the server (the empty-open member
    // request carries no q and is excluded by the collector).
    expect(searches).toEqual(["ali"]);
  });

  test("immediate enum facet applies without a debounced search request", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const searches = collectIssueSearch(page);

    // The Status facet is a static, in-memory enum select — no search input and
    // no debounce. Selecting an option applies immediately as ?status=, and must
    // never route through the ?q= search-debounce path.
    await page.locator('[data-testid="status-dropdown-trigger"]').click();
    await expect(
      page.locator('[data-testid="status-dropdown-content"]'),
    ).toBeVisible();

    const applied = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        res.ok() &&
        url.pathname === "/api/issues" &&
        url.search.includes("status=todo")
      );
    });
    await page.locator('[data-testid="status-option-todo"]').click();
    await applied;

    // The enum select fired its immediate filter apply but zero debounced ?q=
    // searches — the immediate-filter surface is not on the debounce path.
    expect(searches).toEqual([]);
  });
});
