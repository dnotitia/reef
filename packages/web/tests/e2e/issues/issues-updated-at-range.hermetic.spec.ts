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
  { name: "768", width: 768, height: 844 },
  { name: "414", width: 414, height: 844 },
  { name: "375", width: 375, height: 844 },
  { name: "320", width: 320, height: 844 },
] as const;

async function openRangeEditor(page: Page): Promise<void> {
  const editor = page.getByTestId("updated-at-range-editor");
  if (!(await editor.isVisible())) {
    await page.getByTestId("updated-at-filter-trigger").click();
  }
  await expect(editor).toBeVisible();
}

async function chooseDate(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await openRangeEditor(page);
  const fieldId = label.endsWith(" from")
    ? "updated-at-range-start"
    : "updated-at-range-end";
  await page.locator(`#${fieldId}`).click();
  await page
    .getByRole("textbox", { name: `${label} (YYYY-MM-DD)`, exact: true })
    .fill(value);
  await page.keyboard.press("Enter");
}

async function chooseDateField(
  page: Page,
  field: "created_at" | "start_date" | "due_date",
): Promise<void> {
  await openRangeEditor(page);
  const labels = {
    created_at: "Created date",
    start_date: "Start date",
    due_date: "Due date",
  } as const;
  await page.getByTestId("issue-date-range-field").click();
  await page.getByRole("option", { name: labels[field], exact: true }).click();
  await expect(page.getByTestId("updated-at-range-editor")).toBeVisible();
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

async function assertCompoundTriggerVisual(
  page: Page,
  viewport: (typeof VISUAL_VIEWPORTS)[number],
): Promise<void> {
  const group = page.getByTestId("updated-at-filter");
  const trigger = group.getByTestId("updated-at-filter-trigger");
  const summary = group.getByTestId("updated-at-filter-summary");
  const clear = group.getByTestId("updated-at-range-clear");

  await expect(group).toBeVisible();
  await expect(trigger).toBeVisible();
  await expect(summary).toHaveText(/수정일 · .+ → .+/);
  await expect(group).toHaveAttribute("data-active", "true");
  await expect(trigger).toHaveAttribute("data-active", "true");
  await expect(clear).toBeVisible();
  await expect(
    group.locator('[data-testid="date-picker-trigger"]'),
  ).toHaveCount(0);
  await expect(group.locator('[data-testid="date-picker-clear"]')).toHaveCount(
    0,
  );

  const geometry = await page.evaluate(() => {
    const triggerElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-filter-trigger"]',
    );
    const summaryElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-filter-summary"]',
    );
    const clearElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-range-clear"]',
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
        right: rect.right,
        top: rect.top,
        width: rect.width,
        borderRadius: styles.borderRadius,
        borderTopWidth: styles.borderTopWidth,
        fontSize: styles.fontSize,
        lineHeight: styles.lineHeight,
      };
    };
    const summaryStyles = summaryElement
      ? (() => {
          const styles = getComputedStyle(summaryElement);
          return {
            lineCount: summaryElement.getClientRects().length,
            lineHeight: styles.lineHeight,
            whiteSpace: styles.whiteSpace,
          };
        })()
      : null;
    const clearStyles = clearElement
      ? (() => {
          const styles = getComputedStyle(clearElement);
          return {
            opacity: styles.opacity,
            pointerEvents: styles.pointerEvents,
          };
        })()
      : null;
    return {
      clearStyles,
      documentWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      summaryStyles,
      status: measure(statusElement),
      trigger: measure(triggerElement),
    };
  });

  expect(geometry.trigger).not.toBeNull();
  expect(geometry.status).not.toBeNull();
  expect(geometry.summaryStyles).not.toBeNull();
  expect(geometry.trigger?.height).toBe(32);
  expect(geometry.trigger?.height).toBe(geometry.status?.height);
  expect(geometry.trigger?.borderTopWidth).toBe(
    geometry.status?.borderTopWidth,
  );
  expect(geometry.trigger?.fontSize).toBe(geometry.status?.fontSize);
  expect(geometry.trigger?.lineHeight).toBe(geometry.status?.lineHeight);
  expect(geometry.summaryStyles?.lineCount).toBe(1);
  expect(geometry.summaryStyles?.whiteSpace).toBe("nowrap");
  expect(geometry.clearStyles?.opacity).toBe("1");
  expect(geometry.clearStyles?.pointerEvents).not.toBe("none");
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
  await expect(trigger).toHaveClass(/border-brand-focus/);
  await expect(trigger).toHaveClass(/ring-1/);
  await expect(clear).toHaveClass(/border-brand-focus/);
  await expect(clear).toHaveClass(/ring-1/);

  const editor = page.getByTestId("updated-at-range-editor");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await expect(
    page.getByTestId("updated-at-range-editor-criterion"),
  ).toHaveText("수정일");
  await expect(page.getByTestId("updated-at-range-start-label")).toHaveText(
    "시작일",
  );
  await expect(page.getByTestId("updated-at-range-end-label")).toHaveText(
    "종료일",
  );
  await expect(
    page.getByTestId("updated-at-range-editor-criterion").locator("button"),
  ).toHaveCount(0);
  await expect(editor.locator('[data-testid="date-picker-clear"]')).toHaveCount(
    0,
  );
  await expect(
    editor.getByTestId("updated-at-range-editor-clear"),
  ).toBeVisible();

  const editorGeometry = await page.evaluate(() => {
    const editorElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-range-editor"]',
    );
    const sidebarElement = document.querySelector<HTMLElement>("aside");
    const startElement = document.querySelector<HTMLElement>(
      "#updated-at-range-start",
    );
    const endElement = document.querySelector<HTMLElement>(
      "#updated-at-range-end",
    );
    const fieldsElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-range-editor-fields"]',
    );
    const rect = editorElement?.getBoundingClientRect();
    const sidebarRect = sidebarElement?.getBoundingClientRect();
    const startRect = startElement?.getBoundingClientRect();
    const endRect = endElement?.getBoundingClientRect();
    const fieldsStyles = fieldsElement
      ? getComputedStyle(fieldsElement)
      : undefined;
    return {
      bottom: rect?.bottom ?? null,
      fieldsColumns: fieldsStyles?.gridTemplateColumns.split(" ").length ?? 0,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      left: rect?.left ?? null,
      right: rect?.right ?? null,
      sidebarRight: sidebarRect?.right ?? 0,
      startLeft: startRect?.left ?? null,
      endRight: endRect?.right ?? null,
    };
  });
  expect(editorGeometry.left).toBeGreaterThanOrEqual(0);
  expect(editorGeometry.right).toBeLessThanOrEqual(editorGeometry.innerWidth);
  expect(editorGeometry.bottom).toBeLessThanOrEqual(editorGeometry.innerHeight);
  expect(editorGeometry.left).toBeGreaterThanOrEqual(
    editorGeometry.sidebarRight,
  );
  expect(editorGeometry.startLeft).toBeGreaterThanOrEqual(
    editorGeometry.sidebarRight,
  );
  expect(editorGeometry.endRight).toBeLessThanOrEqual(
    editorGeometry.innerWidth,
  );
  expect(editorGeometry.fieldsColumns).toBe(viewport.width <= 480 ? 1 : 2);
  const openScreenshotPath = test
    .info()
    .outputPath(`updated-at-range-${viewport.name}-open.png`);
  await page.screenshot({ animations: "disabled", path: openScreenshotPath });
  await test.info().attach(`updated-at-range-${viewport.name}-open`, {
    path: openScreenshotPath,
  });

  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(trigger).toBeFocused();
  const closedScreenshotPath = test
    .info()
    .outputPath(`updated-at-range-${viewport.name}.png`);
  await page.screenshot({ animations: "disabled", path: closedScreenshotPath });
  await test.info().attach(`updated-at-range-${viewport.name}`, {
    path: closedScreenshotPath,
  });
}

async function assertUpdatedAtInlineError(
  page: Page,
  viewport: (typeof VISUAL_VIEWPORTS)[number],
): Promise<void> {
  await openRangeEditor(page);
  const editor = page.getByTestId("updated-at-range-editor");
  await expect(page.getByTestId("updated-at-range-end-error")).toHaveText(
    "종료일을 선택하세요.",
  );
  const placement = await page.evaluate(() => {
    const error = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-range-end-error"]',
    );
    const endTrigger = document.querySelector<HTMLElement>(
      "#updated-at-range-end",
    );
    const editorElement = document.querySelector<HTMLElement>(
      '[data-testid="updated-at-range-editor"]',
    );
    const errorRect = error?.getBoundingClientRect();
    const endRect = endTrigger?.getBoundingClientRect();
    const editorRect = editorElement?.getBoundingClientRect();
    return {
      bottom: errorRect?.bottom ?? null,
      editorBottom: editorRect?.bottom ?? null,
      editorLeft: editorRect?.left ?? null,
      editorRight: editorRect?.right ?? null,
      endBottom: endRect?.bottom ?? null,
      errorLeft: errorRect?.left ?? null,
      errorTop: errorRect?.top ?? null,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    };
  });
  expect(placement.errorTop).toBeGreaterThan(placement.endBottom ?? 0);
  expect(placement.errorLeft).toBeGreaterThanOrEqual(placement.editorLeft ?? 0);
  expect(placement.errorLeft).toBeLessThanOrEqual(placement.editorRight ?? 0);
  expect(placement.bottom).toBeLessThanOrEqual(placement.innerHeight);
  expect(placement.editorRight).toBeLessThanOrEqual(placement.innerWidth);
  expect(placement.editorBottom).toBeLessThanOrEqual(placement.innerHeight);
  const screenshotPath = test
    .info()
    .outputPath(`updated-at-range-${viewport.name}-error.png`);
  await page.screenshot({ animations: "disabled", path: screenshotPath });
  await test.info().attach(`updated-at-range-${viewport.name}-error`, {
    path: screenshotPath,
  });
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
}

test.describe("Hermetic updated-at date range filter", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "updated_at_range");
  });

  test("renders updated_at as one compound filter trigger", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await openExistingWorkspace(page);
    await page.goto(LIST_URL);
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const group = page.getByTestId("updated-at-filter");
    const trigger = group.getByTestId("updated-at-filter-trigger");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText("수정일");
    await expect(
      group.locator('[data-testid="date-picker-trigger"]'),
    ).toHaveCount(0);
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
    await expect(page.getByTestId("updated-at-filter-trigger")).toBeVisible();
    await expect(page.getByTestId("updated-at-filter-summary")).toHaveText(
      "Updated date",
    );
    await expect(
      page.locator(
        '[data-testid="updated-at-filter"] [data-testid="date-picker-trigger"]',
      ),
    ).toHaveCount(0);

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
    await expect(page.getByTestId("display-options-trigger")).toBeVisible();

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

  test("filters each registered date field with its own storage semantics", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(LIST_URL);
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    const cases = [
      {
        field: "created_at" as const,
        fromLabel: "Created from",
        throughLabel: "Created through",
        day: "2026-06-10",
        summary: "Created date",
      },
      {
        field: "start_date" as const,
        fromLabel: "Start from",
        throughLabel: "Start through",
        day: "2026-06-10",
        summary: "Start date",
      },
      {
        field: "due_date" as const,
        fromLabel: "Due from",
        throughLabel: "Due through",
        day: "2026-06-24",
        summary: "Due date",
      },
    ];

    for (const dateCase of cases) {
      const clear = page.getByTestId("updated-at-range-clear");
      if ((await clear.count()) > 0) await clear.click();
      await chooseDateField(page, dateCase.field);
      await expect(page.getByTestId("updated-at-filter-summary")).toHaveText(
        dateCase.summary,
      );
      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/issues" &&
          url.searchParams.get("date_field") === dateCase.field
        );
      });
      await chooseDate(page, dateCase.fromLabel, dateCase.day);
      await chooseDate(page, dateCase.throughLabel, dateCase.day);
      await responsePromise;

      await expect(page.getByTestId("updated-at-filter-summary")).toContainText(
        `${dateCase.summary} ·`,
      );
      await expect(
        page.getByText("Initial issue Alpha", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Initial issue Beta", { exact: true }),
      ).toBeHidden();
    }
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

  test("proves the compound trigger and editor at exact desktop and narrow widths", async ({
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
      await assertCompoundTriggerVisual(page, viewport);
    }

    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByTestId("updated-at-range-clear").click();
    await expect(page.getByTestId("updated-at-filter-summary")).toHaveText(
      "수정일",
    );
    await expect(page.getByTestId("updated-at-range-clear")).toHaveCount(0);

    await page.goto(`${LIST_URL}&date_field=updated_at&date_from=2026-06-15`);
    for (const viewport of VISUAL_VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await assertUpdatedAtInlineError(page, viewport);
    }
  });

  test("flips the editor into view in a short 320px viewport", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(dateRangeUrl("2026-06-15", "2026-06-15"));
    await expect(
      page.getByText("Initial issue Alpha", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 320, height: 600 });
    await openRangeEditor(page);

    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        sidebar: box("aside"),
        popover: box('[data-testid="updated-at-range-editor"]'),
        start: box("#updated-at-range-start"),
        end: box("#updated-at-range-end"),
        documentWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.popover?.left).toBeGreaterThanOrEqual(
      geometry.sidebar?.right ?? 0,
    );
    expect(geometry.popover?.right).toBeLessThanOrEqual(
      geometry.viewport.width,
    );
    expect(geometry.popover?.top).toBeGreaterThanOrEqual(0);
    expect(geometry.popover?.bottom).toBeLessThanOrEqual(
      geometry.viewport.height,
    );
    expect(geometry.start?.top).toBeGreaterThanOrEqual(
      geometry.popover?.top ?? 0,
    );
    expect(geometry.end?.bottom).toBeLessThanOrEqual(
      geometry.popover?.bottom ?? geometry.viewport.height,
    );
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width);
    await page.keyboard.press("Escape");
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

  test.describe("touch clear affordance", () => {
    test.use({ hasTouch: true, viewport: { width: 320, height: 844 } });

    test("clears the compound range with a touch tap", async ({
      context,
      page,
    }) => {
      await context.addCookies([
        { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
      ]);
      await openExistingWorkspace(page);
      await page.goto(dateRangeUrl("2026-06-15", "2026-06-15"));
      await expect(
        page.getByText("Initial issue Alpha", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      const clear = page.getByTestId("updated-at-range-clear");
      await expect(clear).toBeVisible();
      await expect(clear).toHaveCSS("opacity", "1");
      await clear.tap();
      await expect(page.getByTestId("updated-at-filter-summary")).toHaveText(
        "수정일",
      );
    });
  });
});
