import { type Page, expect, test } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  clearPersistedQueryCache,
  openExistingWorkspace,
  resetFixture,
  readIndexedDbConfig,
  setIssueListFailure,
} from "../harness/fixture";

const LIST_URL =
  "/workspace/reef-e2e/issues?view=list&group=none&columns=start&sort=updated_at&order=asc";

const VISUAL_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "320", width: 320, height: 844 },
  { name: "375", width: 375, height: 844 },
  { name: "414", width: 414, height: 844 },
  { name: "768", width: 768, height: 844 },
] as const;

async function chooseDate(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("textbox", { name: `${label} (YYYY-MM-DD)`, exact: true })
    .fill(value);
  await page.keyboard.press("Enter");
}

async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts
        .filter(({ type }) => type !== "literal")
        .map(({ type, value }) => [type, value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  });
}

function dateRangeUrl(from: string, to: string): string {
  return `/workspace/reef-e2e/issues?view=list&group=none&columns=start&sort=updated_at&order=asc&date_field=updated_at&date_from=${from}&date_to=${to}`;
}

async function assertUpdatedAtVisualContract(
  page: Page,
  viewport: (typeof VISUAL_VIEWPORTS)[number],
): Promise<void> {
  const group = page.getByTestId("updated-at-filter");
  const label = page.getByTestId("updated-at-filter-label");
  const dateTriggers = group.locator('[data-testid="date-picker-trigger"]');
  const statusTrigger = page.getByTestId("status-dropdown-trigger");

  await expect(group).toBeVisible();
  await expect(label).toBeVisible();
  await expect(label).toHaveText("수정일");
  await expect(group).toHaveAttribute("data-active", "true");
  await expect(dateTriggers).toHaveCount(2);
  await expect(dateTriggers.nth(0)).toHaveAttribute("data-active", "true");
  await expect(dateTriggers.nth(1)).toHaveAttribute("data-active", "true");

  const geometry = await page.evaluate(() => {
    const groupElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-filter"]',
    );
    const triggerElements = groupElement
      ? Array.from(
          groupElement.querySelectorAll<HTMLButtonElement>(
            '[data-testid="date-picker-trigger"]',
          ),
        )
      : [];
    const separatorElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-range-separator"]',
    );
    const statusElement = document.querySelector<HTMLElement>(
      '[data-testid="status-dropdown-trigger"]',
    );
    const measure = (element: HTMLElement | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        marginTop: styles.marginTop,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
    };
    const triggerStyles = triggerElements.map((element) => {
      const styles = getComputedStyle(element);
      return {
        borderRadius: styles.borderRadius,
        borderTopWidth: styles.borderTopWidth,
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
        rect: measure(element),
      };
    });
    const statusStyles = statusElement
      ? (() => {
          const styles = getComputedStyle(statusElement);
          return {
            borderRadius: styles.borderRadius,
            borderTopWidth: styles.borderTopWidth,
            fontSize: styles.fontSize,
            lineHeight: styles.lineHeight,
            rect: measure(statusElement),
          };
        })()
      : null;
    const clearElement = groupElement?.querySelector<HTMLElement>(
      '[data-testid="date-picker-clear"]',
    );
    const clearStyles = clearElement
      ? (() => {
          const styles = getComputedStyle(clearElement);
          return {
            opacity: styles.opacity,
            pointerEvents: styles.pointerEvents,
          };
        })()
      : null;
    const groupStyles = groupElement
      ? (() => {
          const styles = getComputedStyle(groupElement);
          return {
            active: groupElement.dataset.active,
            className: groupElement.className,
            display: styles.display,
          };
        })()
      : null;
    const controlsElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-range-controls"]',
    );
    return {
      clearStyles,
      controlsClassName: controlsElement?.className ?? null,
      documentWidth: document.documentElement.scrollWidth,
      groupStyles,
      innerWidth: window.innerWidth,
      separator: measure(separatorElement),
      statusStyles,
      triggerStyles,
    };
  });

  expect(geometry.triggerStyles).toHaveLength(2);
  expect(geometry.statusStyles).not.toBeNull();
  expect(geometry.separator).not.toBeNull();
  expect(geometry.groupStyles?.active).toBe("true");
  expect(geometry.groupStyles?.display).toBe("block");
  expect(geometry.controlsClassName).toContain("max-[769px]:grid-cols-1");
  expect(geometry.clearStyles?.opacity).toBe("1");
  expect(geometry.clearStyles?.pointerEvents).not.toBe("none");
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);

  const [from, to] = geometry.triggerStyles;
  const status = geometry.statusStyles;
  const separator = geometry.separator;
  expect(from.rect).not.toBeNull();
  expect(to.rect).not.toBeNull();
  expect(status?.rect).not.toBeNull();
  expect(from.rect?.height).toBe(32);
  expect(to.rect?.height).toBe(32);
  expect(from.rect?.height).toBe(status?.rect?.height);
  expect(to.rect?.height).toBe(status?.rect?.height);
  expect(from.borderRadius).toBe(status?.borderRadius);
  expect(from.borderTopWidth).toBe(status?.borderTopWidth);
  expect(from.fontSize).toBe(status?.fontSize);
  expect(from.lineHeight).toBe(status?.lineHeight);
  expect(separator?.marginTop).toBe("0px");

  if (viewport.width <= 768) {
    expect(separator?.top).toBeGreaterThanOrEqual((from.rect?.bottom ?? 0) - 1);
    expect(to.rect?.top).toBeGreaterThanOrEqual((separator?.bottom ?? 0) - 1);
    expect(separator?.left).toBeGreaterThanOrEqual(from.rect?.left ?? 0);
    expect(separator?.right).toBeLessThanOrEqual(to.rect?.right ?? 0);
  } else {
    const fromCenter = ((from.rect?.top ?? 0) + (from.rect?.bottom ?? 0)) / 2;
    const separatorCenter =
      ((separator?.top ?? 0) + (separator?.bottom ?? 0)) / 2;
    expect(Math.abs(fromCenter - separatorCenter)).toBeLessThanOrEqual(1);
    expect(
      Math.abs((from.rect?.top ?? 0) - (to.rect?.top ?? 0)),
    ).toBeLessThanOrEqual(1);
  }

  const screenshotPath = test
    .info()
    .outputPath(`updated-at-range-${viewport.name}.png`);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: screenshotPath,
  });
  await test.info().attach(`updated-at-range-${viewport.name}`, {
    path: screenshotPath,
  });
}

async function assertUpdatedAtInlineError(page: Page): Promise<void> {
  const endTrigger = page
    .getByTestId("updated-at-filter")
    .locator('[data-testid="date-picker-trigger"]')
    .nth(1);
  const error = page.getByTestId("updated-at-range-end-error");
  await expect(error).toHaveText("종료일을 선택하세요.");
  const triggerBox = await endTrigger.boundingBox();
  expect(triggerBox).not.toBeNull();
  const placement = await error.evaluate((element) => {
    const errorRect = element.getBoundingClientRect();
    return {
      errorBottom: errorRect.bottom,
      errorLeft: errorRect.left,
      errorTop: errorRect.top,
      errorWidth: errorRect.width,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
  expect(placement.errorTop).toBeGreaterThan(
    (triggerBox?.y ?? 0) + (triggerBox?.height ?? 0),
  );
  expect(placement.errorLeft).toBeGreaterThanOrEqual(0);
  expect(placement.errorBottom).toBeLessThanOrEqual(placement.innerHeight);
  expect(placement.errorLeft + placement.errorWidth).toBeLessThanOrEqual(
    placement.innerWidth,
  );
}

test.describe("Hermetic updated-at date range filter", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "updated_at_range");
  });

  test("filters List, Board, and Backlog by the current updated_at day", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(LIST_URL);

    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Initial issue Beta", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Updated from", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Updated through", exact: true }),
    ).toBeVisible();

    await chooseDate(page, "Updated from", "2026-06-15");
    await expect(page.getByTestId("updated-at-range-end-error")).toHaveText(
      "Choose an end date.",
    );
    const rangeResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("date_field") === "updated_at"
      );
    });
    await chooseDate(page, "Updated through", "2026-06-15");

    const rangeResponse = await rangeResponsePromise;
    expect(
      (await rangeResponse.json()).issues.map(
        (issue: { id: string }) => issue.id,
      ),
    ).toEqual(["REEF-001"]);

    await expect(page).toHaveURL(/date_field=updated_at/);
    await expect(page).toHaveURL(/date_from=2026-06-15/);
    await expect(page).toHaveURL(/date_to=2026-06-15/);
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Initial issue Beta", { exact: true }),
    ).toBeHidden();
    await expect(page.getByTestId("issue-list-columns-control")).toBeVisible();

    await page.goto(
      "/workspace/reef-e2e/issues?view=board&group=none&sort=updated_at&order=asc&date_field=updated_at&date_from=2026-06-15&date_to=2026-06-15",
    );
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Initial issue Beta", { exact: true }),
    ).toBeHidden();
    await expect(page.getByTestId("updated-at-filter")).toBeVisible();

    await page.goto(
      "/workspace/reef-e2e/issues?scope=backlog&view=list&sort=updated_at&order=asc&date_field=updated_at&date_from=2026-06-15&date_to=2026-06-15",
    );
    await expect(
      page.getByText("Backlog issue Gamma", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeHidden();
    await expect(page.getByTestId("updated-at-filter")).toBeVisible();
  });

  test("does not narrow the list until both bounds form a valid range", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(LIST_URL);
    await expect(
      page.getByText("Initial issue Beta", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });

    const issueRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/issues"
      ) {
        issueRequests.push(request.url());
      }
    });

    await chooseDate(page, "Updated from", "2026-06-15");
    await expect(page.getByTestId("updated-at-range-end-error")).toHaveText(
      "Choose an end date.",
    );
    await expect(
      page.getByText("Initial issue Beta", { exact: true }),
    ).toBeVisible();
    await chooseDate(page, "Updated through", "2026-06-14");
    await expect(page.getByTestId("updated-at-range-end-error")).toHaveText(
      "End date must be on or after the start date.",
    );
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Initial issue Beta", { exact: true }),
    ).toBeVisible();
    expect(
      issueRequests.some((raw) => new URL(raw).searchParams.has("date_field")),
    ).toBe(false);
  });

  test("restores a valid range from the vault-scoped browser filter slot", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(LIST_URL);
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });

    await chooseDate(page, "Updated from", "2026-06-15");
    await chooseDate(page, "Updated through", "2026-06-15");
    await expect
      .poll(async () => {
        const raw = await readIndexedDbConfig(page, "filter:reef-e2e");
        if (!raw) return null;
        return (JSON.parse(raw) as { filter?: { dateRange?: unknown } }).filter
          ?.dateRange;
      })
      .toEqual({
        field: "updated_at",
        from: "2026-06-15",
        to: "2026-06-15",
      });

    await page.close();
    const restored = await context.newPage();
    await clearPersistedQueryCacheOnLoad(restored);
    await restored.goto("/workspace/reef-e2e/issues?view=list");
    await expect(restored).toHaveURL(/date_field=updated_at/);
    await expect(
      restored.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      restored.getByText("Initial issue Beta", { exact: true }),
    ).toBeHidden();
  });

  test("renders the updated-at filter as an identified, responsive active group", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await openExistingWorkspace(page);
    await page.goto(dateRangeUrl("2026-06-15", "2026-06-15"));
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    for (const viewport of VISUAL_VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await assertUpdatedAtVisualContract(page, viewport);
    }

    await page.goto(`${LIST_URL}&date_field=updated_at&date_from=2026-06-15`);
    await expect(page.getByTestId("updated-at-range-end-error")).toBeVisible({
      timeout: 15_000,
    });
    for (const viewport of VISUAL_VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await assertUpdatedAtInlineError(page);
    }
  });

  test("refreshes current updated_at membership after an ordinary issue save", async ({
    page,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    const today = await browserToday(page);
    const currentRange = dateRangeUrl(today, today);

    await page.goto(currentRange);
    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible();

    await page.getByText("Initial issue Alpha", { exact: true }).click();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const title = page.getByTestId("issue-title-input");
    await title.fill("Initial issue Alpha (updated)");
    await title.press("Enter");
    await expect(page.getByTestId("issue-save-status")).toContainText("Saved", {
      timeout: 15_000,
    });
    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);

    await page.goto(currentRange);
    await expect(
      page.getByText("Initial issue Alpha (updated)", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto(dateRangeUrl("2026-06-15", "2026-06-15"));
    await expect(
      page.getByText("Initial issue Alpha (updated)", { exact: true }),
    ).toBeHidden();
    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeVisible();
  });

  test("surfaces a retryable error when a cached no-match list refetch fails", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await clearPersistedQueryCache(page);
    const today = await browserToday(page);
    const currentRange = dateRangeUrl(today, today);

    await page.goto(currentRange);
    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible();

    await page.getByText("Initial issue Alpha", { exact: true }).click();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const title = page.getByTestId("issue-title-input");
    await title.fill("Initial issue Alpha (updated for failure)");
    await title.press("Enter");
    await expect(page.getByTestId("issue-save-status")).toContainText("Saved", {
      timeout: 15_000,
    });
    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);

    const noMatchRange = dateRangeUrl("2026-06-15", "2026-06-15");
    await page.goto(noMatchRange);
    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage
            .getItem("REACT_QUERY_OFFLINE_CACHE")
            ?.includes("2026-06-15"),
        ),
      )
      .toBe(true);

    const issueListResponses: Array<{ status: number; url: string }> = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        response.request().method() === "GET" &&
        url.pathname === "/api/issues"
      ) {
        issueListResponses.push({
          status: response.status(),
          url: response.url(),
        });
      }
    });
    const responsesBeforeFailure = issueListResponses.length;
    await setIssueListFailure(request, true, 0);
    await page.reload();
    await expect(page).toHaveURL(/date_field=updated_at/);
    await expect(page).toHaveURL(/date_from=2026-06-15/);
    await expect(page).toHaveURL(/date_to=2026-06-15/);
    await expect
      .poll(() =>
        issueListResponses
          .slice(responsesBeforeFailure)
          .some(
            ({ status, url }) =>
              status >= 400 &&
              new URL(url).searchParams.get("date_field") === "updated_at",
          ),
      )
      .toBe(true);

    await expect(page.getByText("Failed to load issues.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeHidden();

    await setIssueListFailure(request, false, 0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Failed to load issues.")).toBeHidden();

    await page.goto(noMatchRange);
    await expect(
      page.getByText("No issues match your filters.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
