import {
  type APIRequestContext,
  type Page,
  type Request,
  expect,
  test,
} from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

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
    await expect(input).toBeEditable();
    await expect(input).toBeFocused();

    const settled = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return (
        req.method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("q") === "Alpha"
      );
    });
    // Send individual key events without an artificial pause. The complete
    // sequence stays inside the 150ms warm window even while sibling shards
    // are competing for browser/Next.js CPU, so every prefix but the final
    // settled value is debounced away.
    await input.pressSequentially("Alpha");
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
    await page.goto("/workspace/reef-e2e/issues?view=board&sort=priority");
    const searches = collectIssueSearch(page);

    // The route skeleton and the hydrated SearchBar intentionally share the
    // `search-input` test id. Wait for the live board and editable input so a
    // full-shard run cannot focus the readOnly skeleton just before it is
    // replaced by the real control.
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    const input = page.locator('[data-testid="search-input"]');
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
    await input.focus();
    await expect(input).toBeFocused();

    const settled = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return (
        req.method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("q") === "Beta"
      );
    });
    await input.pressSequentially("Beta");
    await settled;

    expect(searches).toEqual(["Beta"]);
    await expect(
      page.getByRole("button", { name: /REEF-002.*Initial issue Beta/ }),
    ).toBeVisible();
  });

  test("List exposes updating state before a debounced search replaces populated results", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "large_vault");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list&sort=priority");

    const input = page.getByTestId("search-input");
    const visibleSearchProgress = page.locator(
      '[data-testid="search-progress-bar"]:visible',
    );
    const existingRow = page.getByTestId("issue-list-row").first();
    await expect(existingRow).toBeVisible();

    const query = "zzzz-no-such-issue-xyz123";
    let requestSeen = false;
    let releaseResponse: (() => void) | undefined;
    const responseHeld = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    // This is the documented UI-only timing exception: the real Route Handler
    // and fixture payload run; the route is held only to keep the in-flight
    // transition observable while the existing rows remain on screen.
    await page.route(
      (url) =>
        url.pathname === "/api/issues" && url.searchParams.get("q") === query,
      async (route) => {
        requestSeen = true;
        const response = await route.fetch();
        await responseHeld;
        await route.fulfill({ response });
      },
    );

    await input.fill(query);

    // The existing rows remain visible during the warm debounce window. The
    // user must still get a visual and assistive-technology signal immediately,
    // before the debounced query key reaches TanStack Query.
    await expect(existingRow).toBeVisible();
    await expect
      .poll(() => page.getByTestId("search-progress-bar").count(), {
        timeout: 100,
        intervals: [10, 20],
      })
      .toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page
            .getByRole("status")
            .filter({ hasText: "Updating results…" })
            .count(),
        { timeout: 100, intervals: [10, 20] },
      )
      .toBeGreaterThan(0);
    await expect(existingRow).toBeVisible();

    await expect.poll(() => requestSeen, { timeout: 5_000 }).toBe(true);
    await expect(visibleSearchProgress.first()).toBeVisible();
    expect(releaseResponse).toBeDefined();
    releaseResponse?.();

    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("search-progress-bar")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Updating results…" }),
    ).toHaveCount(0);
  });

  async function expectRetainedSearchHandoff(
    page: Page,
    request: APIRequestContext,
    surface: "list" | "board",
  ): Promise<void> {
    await resetFixture(request, "large_vault");
    await openExistingWorkspace(page);
    await page.goto(`/workspace/reef-e2e/issues?view=${surface}&sort=priority`);

    const input = page.getByTestId("search-input");
    await input.fill("Alpha");
    await expect(page).toHaveURL(/q=Alpha/);
    const previous = page
      .getByTestId(surface === "list" ? "issue-list-row" : "kanban-card")
      .filter({ hasText: "Alpha" })
      .first();
    await expect(previous).toBeVisible();
    await expect(page.getByTestId("search-progress-bar")).toHaveCount(0);
    const previousIssueId = await previous.getAttribute("data-issue-id");
    expect(previousIssueId).toBeTruthy();

    const nextQuery = "zzzz-no-such-issue-xyz123";
    let requestSeen = false;
    let releaseNextResponse: (() => void) | undefined;
    const nextResponseHeld = new Promise<void>((resolve) => {
      releaseNextResponse = resolve;
    });
    // This is the documented UI-only timing exception: route.fetch runs the
    // real Route Handler and fixture response; only delivery is held so the
    // retained previous result is observable during the handoff.
    await page.route(
      (url) =>
        url.pathname === "/api/issues" &&
        url.searchParams.get("q") === nextQuery,
      async (route) => {
        requestSeen = true;
        const response = await route.fetch();
        await nextResponseHeld;
        await route.fulfill({ response });
      },
    );

    await input.fill(nextQuery);
    await expect(input).toHaveValue(nextQuery);
    await expect(page).toHaveURL(/q=zzzz-no-such-issue-xyz123/);
    await expect.poll(() => requestSeen, { timeout: 5_000 }).toBe(true);
    await expect(previous).toBeVisible();
    await expect(page.getByTestId("search-progress-bar").first()).toBeVisible();
    await expect
      .poll(
        () =>
          page
            .getByRole("status")
            .filter({ hasText: "Updating results…" })
            .count(),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    expect(releaseNextResponse).toBeDefined();
    releaseNextResponse?.();
    if (surface === "list") {
      await expect(
        page.getByText("No issues match your filters.", { exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByTestId("kanban-no-matches")).toBeVisible();
    }
    await expect(page.getByTestId("search-progress-bar")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Updating results…" }),
    ).toHaveCount(0);
  }

  test("List keeps updating state through the URL and retained-row handoff", async ({
    page,
    request,
  }) => {
    await expectRetainedSearchHandoff(page, request, "list");
  });

  test("Board keeps updating state through the URL and retained-card handoff", async ({
    page,
    request,
  }) => {
    await expectRetainedSearchHandoff(page, request, "board");
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
    await page.goto("/workspace/reef-e2e/issues?view=list&sort=priority");
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

  test("SearchBar preserves an IME draft on composing Escape, then clears normally", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    const input = page.getByTestId("search-input");
    await expect(input).toBeEditable();
    await input.fill("한");

    await input.dispatchEvent("compositionstart", { data: "ㅎ" });
    await input.dispatchEvent("compositionupdate", { data: "한" });
    await page.evaluate(() => {
      const element = document.querySelector<HTMLInputElement>(
        '[data-testid="search-input"]',
      );
      if (!element) throw new Error("missing search input");
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "isComposing", { value: true });
      element.dispatchEvent(event);
    });
    await expect(input).toHaveValue("한");

    await input.dispatchEvent("compositionend", { data: "한" });
    await input.press("Escape");
    await expect(input).toHaveValue("");
  });

  test("covers completed IME input, Backspace, paste, and clear", async ({
    page,
    context,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    const input = page.getByTestId("search-input");
    await expect(input).toBeEditable();
    await input.fill("한");

    await input.dispatchEvent("compositionstart", { data: "ㅎ" });
    await input.dispatchEvent("compositionupdate", { data: "한" });
    await input.dispatchEvent("compositionend", { data: "한" });
    await input.press("x");
    await expect(input).toHaveValue("한x");

    await input.press("Backspace");
    await expect(input).toHaveValue("한");

    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    await page.evaluate(() => navigator.clipboard.writeText("붙여넣기"));
    await input.focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+V" : "Control+V",
    );
    await expect(input).toHaveValue("한붙여넣기");

    await page.getByTestId("search-clear-button").click();
    await expect(input).toHaveValue("");
  });

  test("keeps the latest result after delayed q responses are released in reverse order", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board&sort=priority");
    const input = page.getByTestId("search-input");
    const heldResponses: Array<{
      query: string;
      release: () => Promise<void>;
    }> = [];
    let latestResponseReleased = false;

    // This is the documented UI-only timing exception: the real Route Handler
    // and fixture payloads run, while q responses are held and released in reverse
    // order to prove stale responses cannot replace the latest result.
    await page.route(
      (url) => url.pathname === "/api/issues" && url.searchParams.has("q"),
      async (route) => {
        const response = await route.fetch();
        const query = new URL(route.request().url()).searchParams.get("q");

        if (query === "Alpha") {
          await route.fulfill({ response });
          latestResponseReleased = true;
          return;
        }

        if (query !== "A" && query !== "Al") {
          await route.fulfill({ response });
          return;
        }

        await new Promise<void>((resolve) => {
          heldResponses.push({
            query: query ?? "",
            release: async () => {
              await route.fulfill({ response });
              resolve();
            },
          });
        });
      },
    );

    await input.fill("A");
    await page.waitForTimeout(220);
    await input.fill("Al");
    await page.waitForTimeout(220);
    await input.fill("Alpha");
    await page.waitForTimeout(220);
    await expect
      .poll(() => latestResponseReleased, { timeout: 10_000 })
      .toBe(true);
    await expect.poll(() => heldResponses.length, { timeout: 10_000 }).toBe(2);

    await expect(page).toHaveURL(/q=Alpha/);
    await expect(
      page.getByRole("button", { name: /Initial issue Alpha/ }).first(),
    ).toBeVisible();

    for (const query of ["Al", "A"]) {
      const response = heldResponses.find((item) => item.query === query);
      if (!response) throw new Error(`missing held response for ${query}`);
      await response.release();
    }
    await expect(input).toHaveValue("Alpha");
    await expect(page).toHaveURL(/q=Alpha/);
    await expect(
      page.getByRole("button", { name: /Initial issue Alpha/ }).first(),
    ).toBeVisible();
  });
});
