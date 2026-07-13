import { type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  readIndexedDbConfig,
  resetFixture,
  setIssueListFailure,
  signInAndSelectExistingWorkspace,
} from "./harness/fixture";

function collectIssueListRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/issues") {
      urls.push(url.toString());
    }
  });
  return urls;
}

async function applyTodoFilter(page: Page): Promise<void> {
  await page.locator('[data-testid="status-dropdown-trigger"]').click();
  await page.locator('[data-testid="status-option-todo"]').click();
  await page.keyboard.press("Escape");
  await page.waitForURL(/status=todo/, { timeout: 10_000 });
}

async function expectPersistedStatus(
  page: Page,
  vault: string,
  status: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await readIndexedDbConfig(page, `filter:${vault}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as {
        filter?: { status?: string[] };
      };
      return parsed.filter?.status ?? [];
    })
    .toContain(status);
}

function hasStatusRequest(urls: readonly string[], status: string): boolean {
  return urls.some((raw) => {
    const url = new URL(raw);
    return url.searchParams.getAll("status").includes(status);
  });
}

test.describe("Hermetic issue list flow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("selects an existing reef vault and renders issues through /api/issues", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    const rows = page.locator('[data-testid="issue-list-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Initial issue Alpha")).toBeVisible();

    const state = await readFixtureState(request);
    expect(
      state.calls.some(
        (call) =>
          call.method === "POST" &&
          call.path === "/akb/api/v1/tables/reef-e2e/sql",
      ),
    ).toBe(true);
  });

  test("restores the saved status filter on a bare /issues entry", async ({
    page,
    context,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    await applyTodoFilter(page);
    await expectPersistedStatus(page, REEF_E2E_VAULT, "todo");

    // The bare entry must hit the server with the restored filter. The original
    // page's async query-cache persister (throttled ~1s flush) is a live writer:
    // it can re-write the localStorage snapshot after any reader-side clear, and
    // on slower CI that re-write lands in the window between the clear and the
    // restored page's QueryProvider rehydration — the restored page then serves
    // the todo list from cache and sends no /api/issues?status=todo, so the filter
    // still restores but the request assertion below times out (the flake REEF-280
    // tracked). Close the original page first to remove the writer entirely; with
    // no concurrent writer, clearing the snapshot at the restored page's
    // document-start is sufficient and deterministic. The saved filter lives in
    // IndexedDB (context-scoped, survives the page close), so it still restores.
    await page.close();

    const restored = await context.newPage();
    await clearPersistedQueryCacheOnLoad(restored);
    const todoIssueRequest = restored.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.getAll("status").includes("todo")
      );
    });
    await restored.goto("/workspace/reef-e2e/issues?view=list");

    // The browser-local filter must survive closing the original page. Keep
    // this assertion separate from the URL mirror below so a persistence wipe
    // and a restore/writeback regression produce different failures.
    await expectPersistedStatus(restored, REEF_E2E_VAULT, "todo");
    await restored.waitForURL(/status=todo/, { timeout: 10_000 });
    await expect(restored.getByText("Initial issue Alpha")).toBeVisible();
    await expect(restored.getByText("Initial issue Beta")).toBeHidden();
    await todoIssueRequest;
  });

  test("honors an explicit URL filter over the saved status filter", async ({
    page,
    context,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    await applyTodoFilter(page);
    await expectPersistedStatus(page, REEF_E2E_VAULT, "todo");

    // Same writer race as the sibling test above (REEF-280): close the original
    // page so its throttled query-cache persister cannot re-write the snapshot
    // mid-swap, then clear at the new page's document-start. The saved filter
    // lives in IndexedDB and survives the close, so the "explicit URL filter wins"
    // assertion still exercises a real restore-vs-override.
    await page.close();

    const urlFiltered = await context.newPage();
    await clearPersistedQueryCacheOnLoad(urlFiltered);
    const issueRequests = collectIssueListRequests(urlFiltered);
    await urlFiltered.goto(
      "/workspace/reef-e2e/issues?view=list&status=in_progress",
    );

    await expect(urlFiltered.getByText("Initial issue Beta")).toBeVisible();
    await expect(urlFiltered.getByText("Initial issue Alpha")).toBeHidden();
    await expect
      .poll(() => hasStatusRequest(issueRequests, "in_progress"))
      .toBe(true);
    expect(hasStatusRequest(issueRequests, "todo")).toBe(false);
  });

  test("Retry fires a fresh Route Handler request after akb list failure", async ({
    page,
    request,
  }) => {
    await signInAndSelectExistingWorkspace(page);
    await setIssueListFailure(request, true);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(page.getByText("Failed to load issues.")).toBeVisible({
      timeout: 20_000,
    });

    await setIssueListFailure(request, false);
    await page.getByRole("button", { name: "Retry" }).click();

    const rows = page.locator('[data-testid="issue-list-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Initial issue Alpha")).toBeVisible();
  });
});
