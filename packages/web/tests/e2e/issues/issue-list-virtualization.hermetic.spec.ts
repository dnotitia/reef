import { type Page, type Response, expect, test } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueListFailure,
  signInAsAlice,
} from "../harness/fixture";

const LARGE_VAULT = "reef-e2e";
const TAIL_ISSUE_ID = "REEF-1124";

function issueListRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/issues") {
      urls.push(url.toString());
    }
  });
  return urls;
}

function issueListResponses(page: Page) {
  const responses: Array<{ url: string; ids: string[] }> = [];
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      response.request().method() !== "GET" ||
      url.pathname !== "/api/issues" ||
      !response.ok()
    ) {
      return;
    }
    try {
      const body = (await response.json()) as {
        issues?: Array<{ id?: unknown }>;
      };
      responses.push({
        url: response.url(),
        ids: (body.issues ?? [])
          .map((issue) => issue.id)
          .filter((id): id is string => typeof id === "string"),
      });
    } catch {
      // Other API responses are not part of this evidence lane.
    }
  });
  return responses;
}

function waitForIssueListPage(
  page: Page,
  hasCursor: boolean,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.get("limit") === "100" &&
      url.searchParams.has("cursor") === hasCursor &&
      response.ok()
    );
  });
}

async function readIssueListPage(response: Response) {
  const body = (await response.json()) as {
    issues?: Array<{ id?: unknown }>;
  };
  return {
    url: response.url(),
    ids: (body.issues ?? [])
      .map((issue) => issue.id)
      .filter((id): id is string => typeof id === "string"),
  };
}

async function openLargeList(page: Page, query = ""): Promise<void> {
  await clearPersistedQueryCacheOnLoad(page);
  await openExistingWorkspace(page, LARGE_VAULT);
  await page.goto(
    `/workspace/${LARGE_VAULT}/issues?view=list${query ? `&${query}` : ""}`,
  );
  await expect(
    page.locator('[data-testid="issue-list-row"]').first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-interaction-ready="true"]')).toHaveCount(1);
}

async function scrollToListEnd(page: Page): Promise<void> {
  const scroll = page.getByTestId("issue-list-scroll-container");
  await expect(scroll).toBeVisible();
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}

test.describe("large issue list virtualization", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "large_vault");
  });

  test("loads 100 rows first, keeps the DOM bounded, and follows one cursor page", async ({
    page,
  }) => {
    const requests = issueListRequests(page);
    const initialResponse = waitForIssueListPage(page, false);
    await openLargeList(page);
    const initialPage = await readIssueListPage(await initialResponse);

    const scroll = page.getByTestId("issue-list-scroll-container");
    const initialRequest = requests.find((raw) => {
      const url = new URL(raw);
      return (
        !url.searchParams.has("cursor") &&
        url.searchParams.get("limit") === "100"
      );
    });
    expect(initialRequest).toBeTruthy();
    expect(new URL(initialRequest ?? "").searchParams.get("limit")).toBe("100");

    await expect
      .poll(() => page.locator('[data-testid="issue-list-row"]').count())
      .toBeLessThanOrEqual(50);
    const range = await scroll.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(range.scrollHeight).toBeGreaterThan(range.clientHeight);

    const cursorResponse = waitForIssueListPage(page, true);
    await scrollToListEnd(page);
    const cursorPage = await readIssueListPage(await cursorResponse);

    const cursorRequests = requests.filter((raw) =>
      new URL(raw).searchParams.has("cursor"),
    );
    expect(cursorRequests).toHaveLength(1);
    expect(cursorPage.ids.every((id) => !initialPage.ids.includes(id))).toBe(
      true,
    );
    const mountedIds = await page
      .locator('[data-testid="issue-list-row"]')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-issue-id")),
      );
    expect(new Set(mountedIds).size).toBe(mountedIds.length);
    expect(mountedIds.length).toBeLessThanOrEqual(50);
  });

  test("keeps loaded rows on next-page failure, retries, and continues sparse residual filters", async ({
    page,
    request,
  }) => {
    await setIssueListFailure(request, false, 1);
    const requests = issueListRequests(page);
    await openLargeList(page);
    await scrollToListEnd(page);
    await expect(
      page.getByText("More issues could not be loaded."),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    await setIssueListFailure(request, false);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect
      .poll(
        () =>
          requests.filter((raw) => new URL(raw).searchParams.has("cursor"))
            .length,
      )
      .toBe(2);

    await resetFixture(request, "large_vault");
    const sparsePage = await page.context().newPage();
    await clearPersistedQueryCacheOnLoad(sparsePage);
    await openExistingWorkspace(sparsePage, LARGE_VAULT);
    const initialSparseResponse = waitForIssueListPage(sparsePage, false);
    const responses = issueListResponses(sparsePage);
    await sparsePage.goto(`/workspace/${LARGE_VAULT}/issues?view=list`);
    await sparsePage.getByTestId("labels-input").fill("tail-marker");
    await sparsePage.getByTestId("labels-input").press("Enter");
    await expect(sparsePage.getByText("Sparse residual match")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(
        () =>
          responses.filter(({ url }) => new URL(url).searchParams.has("cursor"))
            .length,
      )
      .toBeGreaterThan(0);
    const initialSparsePage = await readIssueListPage(
      await initialSparseResponse,
    );
    expect(initialSparsePage.ids).not.toContain(TAIL_ISSUE_ID);
    await sparsePage.close();
  });

  test("moves keyboard focus to an unmounted logical row and opens it", async ({
    page,
  }) => {
    await openLargeList(page);
    const target = page.locator(`[data-issue-id="REEF-0101"]`);
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 99; index += 1) {
      await page.keyboard.press("j");
    }
    await expect(target).toBeVisible({ timeout: 15_000 });
    await expect(target).toHaveAttribute("data-keyboard-focused", "true");
    await expect(target).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/issues\/REEF-0101\?view=list/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("issue-detail")).toBeVisible();
  });

  test("keeps selection and a deep quick edit anchored to loaded logical rows", async ({
    page,
    request,
  }) => {
    await openLargeList(page, "labels=large-fixture");
    const first = page.locator('[data-issue-id="REEF-0101"]');
    const second = page.locator('[data-issue-id="REEF-0102"]');
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 99; index += 1) {
      await page.keyboard.press("j");
    }
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(second).toBeVisible({ timeout: 15_000 });

    const scroll = page.getByTestId("issue-list-scroll-container");
    await first.getByTestId("issue-row-checkbox").click();
    await second
      .getByTestId("issue-row-checkbox")
      .click({ modifiers: ["Shift"] });
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(second).toHaveAttribute("aria-selected", "true");

    await page
      .getByTestId("issue-bulk-action-bar")
      .getByRole("button", { name: "Clear" })
      .click();
    await first.focus();
    const before = await scroll.evaluate((element) => element.scrollTop);
    await page.keyboard.press("l");
    await page
      .getByTestId("issue-quick-edit-anchor")
      .getByRole("button", { name: "Remove label large-fixture" })
      .click();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === LARGE_VAULT)
          ?.issues.find((issue) => issue.id === "REEF-0101")?.labels;
      })
      .toEqual([]);
    await expect(first).toHaveCount(0);
    const after = await scroll.evaluate((element) => element.scrollTop);
    expect(Math.abs(after - before)).toBeLessThan(240);
  });

  test("keeps a grouped deep list bounded while loading cursor pages and preserving focus/selection", async ({
    page,
  }) => {
    const requests = issueListRequests(page);
    await openLargeList(page, "group=priority&labels=large-fixture");

    await expect
      .poll(() => page.locator('[data-testid="issue-list-row"]').count())
      .toBeLessThanOrEqual(50);
    await expect(
      page.locator('[data-testid="issue-group-header"]').first(),
    ).toBeVisible();

    const first = page.locator('[data-issue-id="REEF-0101"]').first();
    const second = page.locator('[data-issue-id="REEF-0102"]').first();
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 99; index += 1) {
      await page.keyboard.press("j");
    }
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(first).toHaveAttribute("data-keyboard-focused", "true");
    await first.getByTestId("issue-row-checkbox").click();
    await second
      .getByTestId("issue-row-checkbox")
      .click({ modifiers: ["Shift"] });
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(second).toHaveAttribute("aria-selected", "true");

    const cursorResponse = waitForIssueListPage(page, true);
    await scrollToListEnd(page);
    await cursorResponse;
    expect(
      requests.filter((raw) => new URL(raw).searchParams.has("cursor")).length,
    ).toBeGreaterThan(0);
    await expect
      .poll(() => page.locator('[data-testid="issue-list-row"]').count())
      .toBeLessThanOrEqual(50);
  });

  test("keeps hard-load CLS below budget and still renders a finite sibling view", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, LARGE_VAULT);
    await page.goto(`/workspace/${LARGE_VAULT}/issues?view=list`);
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let value = 0;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & {
                value: number;
                hadRecentInput: boolean;
              };
              if (!shift.hadRecentInput) value += shift.value;
            }
          });
          observer.observe({ type: "layout-shift", buffered: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(value);
          }, 300);
        }),
    );
    expect(cls).toBeLessThan(0.1);

    await resetFixture(request, "configured");
    await signInAsAlice(page);
    await page.goto(`/workspace/${LARGE_VAULT}/issues?view=board`);
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 20_000,
    });
  });
});
