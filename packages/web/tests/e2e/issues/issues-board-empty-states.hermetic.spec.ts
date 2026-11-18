import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { PERSISTED_QUERY_CACHE_KEY } from "../../../src/lib/storage/clientCache";
import {
  openExistingWorkspace,
  resetFixture,
  readIndexedDbConfig,
  openWorkspaceThroughLogin,
  setIssueListFailure,
  setResponseHold,
  waitForResponseHoldPending,
} from "../harness/fixture";

async function captureBoardState(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

const columns = ["Todo", "In Progress", "In Review", "Done", "Closed"];

async function expectEmptyColumns(page: Page) {
  for (const name of columns) {
    const heading = page.getByRole("heading", { name });
    await expect(heading).toBeVisible();
    await expect(
      heading.locator("..").getByText("0", { exact: true }),
    ).toBeVisible();
  }
}

async function readColumnHeaderRects(page: Page) {
  return page
    .getByRole("heading", { name: new RegExp(`^(${columns.join("|")})$`) })
    .evaluateAll((headings) =>
      headings.map((heading) => {
        const rect = heading.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
}

function expectHeaderTopsWithinPixel(
  reference: Array<{ top: number }>,
  actual: Array<{ top: number }>,
) {
  expect(actual).toHaveLength(reference.length);
  for (const [index, rect] of actual.entries()) {
    expect(
      Math.abs(rect.top - (reference[index]?.top ?? rect.top)),
    ).toBeLessThanOrEqual(1);
  }
}

test.describe("Hermetic board empty states", () => {
  test("distinguishes no-match from true empty and recovers with keyboard clear", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await openExistingWorkspace(page);
    // Start with a URL-applied facet and explicit sort so the reset proves it
    // clears the URL projection and the remembered per-vault filter as well as
    // the one-off search query.
    await page.goto(
      "/workspace/reef-e2e/issues?view=board&priority=critical&sort=title&order=asc",
    );

    await page.getByTestId("search-input").fill("nothing matches");
    await expect(page).toHaveURL(/q=nothing\+matches/);

    const frame = page.getByTestId("kanban-no-matches");
    await expect(frame).toBeVisible({ timeout: 15_000 });
    await expect(frame).toHaveAccessibleName("No matching issues");
    await expect(frame).toHaveAccessibleDescription(
      "Try widening your filters or search to see more issues.",
    );
    await expect(frame).toHaveAttribute("aria-labelledby", /.+/);
    await expect(frame).toHaveAttribute("aria-describedby", /.+/);
    expect(await frame.evaluate((element) => element.tagName)).toBe("SECTION");
    await expect(
      frame.getByRole("heading", { name: "No matching issues" }),
    ).toBeVisible();
    await expect(
      frame.getByText(
        "Try widening your filters or search to see more issues.",
      ),
    ).toBeVisible();
    await expect(
      frame.getByRole("button", { name: "Clear filters", exact: true }),
    ).toHaveCount(0);
    await expectEmptyColumns(page);

    const clear = page.getByRole("button", {
      name: "Clear filters",
      exact: true,
    });
    await expect(clear).toHaveCount(1);
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("search-input")).toHaveValue("");
    await expect
      .poll(() => new URL(page.url()).searchParams.has("q"))
      .toBe(false);
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return ["priority", "sort", "order"].some((key) => params.has(key));
      })
      .toBe(false);
    await expect(page.getByText("Initial issue Alpha")).toBeVisible({
      timeout: 15_000,
    });
    await expect(frame).toHaveCount(0);

    // The persisted filter settles after the recovery; a reload must stay
    // populated instead of restoring the pre-recovery facet or sort.
    await expect
      .poll(async () => {
        const raw = await readIndexedDbConfig(page, "filter:reef-e2e");
        if (!raw) return null;
        const saved = JSON.parse(raw) as {
          filter: {
            priority?: unknown;
            sortField?: unknown;
            sortOrder?: unknown;
          };
        };
        return [
          saved.filter.priority,
          saved.filter.sortField,
          saved.filter.sortOrder,
        ];
      })
      .toEqual([undefined, undefined, undefined]);
    await page.reload();
    await expect(page.getByText("Initial issue Alpha")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("kanban-no-matches")).toHaveCount(0);
  });

  test("keeps column headers aligned while the no-match overlay stays in the board body", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    await expect(page.getByText("Initial issue Alpha")).toBeVisible({
      timeout: 15_000,
    });

    const populatedHeaders = await readColumnHeaderRects(page);

    await page.getByTestId("search-input").fill("nothing matches");
    await expect(page).toHaveURL(/q=nothing\+matches/);
    const frame = page.getByTestId("kanban-no-matches");
    await expect(frame).toBeVisible({ timeout: 15_000 });

    const noMatchHeaders = await readColumnHeaderRects(page);
    expectHeaderTopsWithinPixel(populatedHeaders, noMatchHeaders);
    await expect(page.getByTestId("search-input")).toBeFocused();
    expect(
      await frame.evaluate((element) =>
        Boolean(element.closest('[data-testid="kanban-board-body"]')),
      ),
    ).toBe(true);
    const boardBody = page.getByTestId("kanban-board-body");
    expect(
      await boardBody.evaluate(
        (element) => getComputedStyle(element).overflowX,
      ),
    ).toBe("auto");
    expect(
      await frame.evaluate(
        (element) => getComputedStyle(element).pointerEvents,
      ),
    ).toBe("none");
    expect(
      await page
        .getByRole("button", { name: "Clear filters", exact: true })
        .evaluate((element) => getComputedStyle(element).pointerEvents),
    ).toBe("auto");
    const frameBox = await frame.boundingBox();
    expect(frameBox).not.toBeNull();
    expect(frameBox?.y ?? 0).toBeGreaterThanOrEqual(
      Math.max(...noMatchHeaders.map((rect) => rect.bottom)),
    );
    await expect(frame).not.toHaveAttribute("role", "dialog");
    await expect(frame).not.toHaveAttribute("aria-modal");
  });

  test("keeps the five columns and zero counts for a configured empty board", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");

    await expectEmptyColumns(page);
    const trueEmptyHeaders = await readColumnHeaderRects(page);
    expect(trueEmptyHeaders).toHaveLength(columns.length);
    for (const rect of trueEmptyHeaders) {
      expect(
        Math.abs(rect.top - (trueEmptyHeaders[0]?.top ?? rect.top)),
      ).toBeLessThanOrEqual(1);
      expect(rect.bottom).toBeGreaterThan(rect.top);
    }
    await expect(page.getByTestId("kanban-no-matches")).toHaveCount(0);
    const empty = page.getByTestId("kanban-empty-active");
    await expect(empty).toHaveAccessibleName("No active issues");
    await expect(empty).toHaveAccessibleDescription(
      "Create an issue using New issue, or check the backlog for planned work.",
    );
    await expect(
      page.getByRole("button", { name: "Clear filters", exact: true }),
    ).toHaveCount(0);
    const backlog = page.getByRole("link", {
      name: "View backlog",
      exact: true,
    });
    await backlog.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/scope=backlog/);
  });
});

async function agePersistedIssueQueries(page: Page) {
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw?.includes('"issues"') ?? false;
      }, PERSISTED_QUERY_CACHE_KEY),
    )
    .toBe(true);
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("Missing persisted Query cache");
    const cache = JSON.parse(raw) as {
      clientState: {
        queries: Array<{
          queryKey: unknown[];
          state: { dataUpdatedAt: number };
        }>;
      };
    };
    let aged = 0;
    for (const query of cache.clientState.queries) {
      if (query.queryKey[0] === "issues" && query.queryKey[1] === "list") {
        query.state.dataUpdatedAt = Date.now() - 120_000;
        aged += 1;
      }
    }
    if (!aged) throw new Error("Missing persisted issue list");
    localStorage.setItem(key, JSON.stringify(cache));
  }, PERSISTED_QUERY_CACHE_KEY);
}

test.describe("Hermetic board query feedback", () => {
  test("keeps an accessible loading explanation while initial data is held", async ({
    page,
    request,
  }, testInfo) => {
    await resetFixture(request, "configured");
    await setResponseHold(request, "issue-list", true);
    try {
      await openWorkspaceThroughLogin(page);
      await waitForResponseHoldPending(request, "issue-list");
      const status = page
        .getByRole("status")
        .filter({ hasText: "Loading board" });
      await expect(status).toBeVisible();
      await expect(status).toContainText(
        "Fetching issues. This may take a moment.",
      );
      await expect(page.getByTestId("board-columns-skeleton")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(
        await status.evaluate((element) =>
          Boolean(element.closest('[aria-busy="true"]')),
        ),
      ).toBe(false);
      await expect(page.getByTestId("kanban-empty-active")).toHaveCount(0);
      await captureBoardState(page, testInfo, "initial-data-wait");
    } finally {
      await setResponseHold(request, "issue-list", false);
    }
    await expect(page.getByText("Initial issue Alpha")).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Loading board" }),
    ).toHaveCount(0);
  });

  test("shows unavailable counts after initial 503 and retries into confirmed empty", async ({
    page,
    request,
  }, testInfo) => {
    await resetFixture(request, "configured_empty");
    await setIssueListFailure(request, true, 0, false, 503);
    await openExistingWorkspace(page);
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Could not load the board" });
    await expect(alert).toContainText("Issue counts are unavailable.");
    const failedHeaders = await readColumnHeaderRects(page);
    for (const name of columns) {
      const column = page.getByRole("heading", { name }).locator("../..");
      await expect(column).toHaveAccessibleName(
        `${name}, issue count unavailable`,
      );
      await expect(column.getByText("Unknown", { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("kanban-empty-active")).toHaveCount(0);
    await expect(page.getByTestId("kanban-no-matches")).toHaveCount(0);
    await captureBoardState(page, testInfo, "initial-query-error");
    await setIssueListFailure(request, false);
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("kanban-empty-active")).toBeVisible();
    await expectEmptyColumns(page);
    expectHeaderTopsWithinPixel(
      failedHeaders,
      await readColumnHeaderRects(page),
    );
  });

  test("preserves cached cards, focus and column positions during refresh and failure", async ({
    page,
    request,
  }, testInfo) => {
    await resetFixture(request, "configured");
    await openExistingWorkspace(page);
    await expect(page.getByText("Initial issue Alpha")).toBeVisible();
    await agePersistedIssueQueries(page);
    await setResponseHold(request, "issue-list", true);
    try {
      await page.reload();
      await waitForResponseHoldPending(request, "issue-list");
      const card = page
        .getByTestId("kanban-card")
        .filter({ hasText: "Initial issue Alpha" });
      await expect(card).toBeVisible();
      await card.focus();
      const feedback = page.getByTestId("kanban-query-feedback");
      await expect(feedback).toContainText("Updating board");
      await expect(feedback).toContainText(
        "Manual ordering is paused until the board finishes updating.",
      );
      await expect(card).not.toHaveAttribute("aria-roledescription");
      await expect(card).toBeFocused();
      const headers = await readColumnHeaderRects(page);
      const boardBody = page.getByTestId("kanban-board-body");
      await boardBody.evaluate((element) => {
        element.scrollLeft = 100;
      });
      const scrollLeft = await boardBody.evaluate(
        (element) => element.scrollLeft,
      );
      await setIssueListFailure(request, true, 0, false, 503);
      await setResponseHold(request, "issue-list", false);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Could not update the board" }),
      ).toBeVisible();
      await expect(card).toBeFocused();
      const feedbackBox = await feedback.boundingBox();
      const aiBox = await page.getByTestId("ask-ai-fab").boundingBox();
      if (!feedbackBox || !aiBox)
        throw new Error("Missing feedback or Ask AI geometry");
      expect(
        feedbackBox.x + feedbackBox.width <= aiBox.x ||
          feedbackBox.y + feedbackBox.height <= aiBox.y ||
          feedbackBox.x >= aiBox.x + aiBox.width ||
          feedbackBox.y >= aiBox.y + aiBox.height,
      ).toBe(true);
      expect(
        await feedback.evaluate(
          (element) => getComputedStyle(element).pointerEvents,
        ),
      ).toBe("none");
      expect(
        await feedback
          .getByRole("button", { name: "Retry" })
          .evaluate((element) => getComputedStyle(element).pointerEvents),
      ).toBe("auto");
      expectHeaderTopsWithinPixel(headers, await readColumnHeaderRects(page));
      expect(await boardBody.evaluate((element) => element.scrollLeft)).toBe(
        scrollLeft,
      );
      await expect(page.getByTestId("kanban-empty-active")).toHaveCount(0);
      await captureBoardState(page, testInfo, "cached-refresh-error");
      await setIssueListFailure(request, false);
      await setResponseHold(request, "issue-list", true);
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      await retry.focus();
      await page.keyboard.press("Enter");
      await waitForResponseHoldPending(request, "issue-list");
      await expect(retry).toBeFocused();
      await expect(retry).toHaveAttribute("aria-busy", "true");
      await expect(card).not.toHaveAttribute("aria-roledescription");
      await setResponseHold(request, "issue-list", false);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Could not update the board" }),
      ).toHaveCount(0);
      await expect(feedback).toHaveCount(0);
      await expect(card).toHaveAttribute("aria-roledescription", "sortable");
      await expect(card).toBeVisible();
    } finally {
      await setResponseHold(request, "issue-list", false);
      await setIssueListFailure(request, false);
    }
  });

  test("does not treat cached empty rows as confirmed empty while refreshing", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);
    await expect(page.getByTestId("kanban-empty-active")).toBeVisible();
    await agePersistedIssueQueries(page);
    await setResponseHold(request, "issue-list", true);
    try {
      await page.reload();
      await waitForResponseHoldPending(request, "issue-list");
      await expect(page.getByTestId("kanban-query-feedback")).toContainText(
        "Updating board",
      );
      await expect(page.getByTestId("kanban-empty-active")).toHaveCount(0);
      await expect(page.getByTestId("kanban-no-matches")).toHaveCount(0);
    } finally {
      await setResponseHold(request, "issue-list", false);
    }
    await expect(page.getByTestId("kanban-empty-active")).toBeVisible();
    await expectEmptyColumns(page);
  });

  test("offers Korean active-empty recovery without replacing columns", async ({
    page,
    context,
    request,
  }, testInfo) => {
    await resetFixture(request, "configured_empty");
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await page.setViewportSize({ width: 1024, height: 768 });
    await openWorkspaceThroughLogin(page);
    const empty = page.getByTestId("kanban-empty-active");
    await expect(empty).toHaveAccessibleName("활성 이슈가 없습니다");
    await expect(empty).toHaveAccessibleDescription(
      "새 이슈 버튼으로 이슈를 만들거나 백로그에서 예정된 작업을 확인하세요.",
    );
    await expect(page.getByTestId("kanban-group-header")).toHaveCount(5);
    await expect(page.getByTestId("kanban-board-body")).not.toHaveAttribute(
      "aria-modal",
    );
    await captureBoardState(page, testInfo, "korean-active-empty");
    const backlog = page.getByRole("link", {
      name: "백로그 보기",
      exact: true,
    });
    await backlog.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/scope=backlog/);
  });
});
