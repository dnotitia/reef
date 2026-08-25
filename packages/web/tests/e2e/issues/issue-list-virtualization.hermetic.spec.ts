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
  const responses: Array<{
    url: string;
    ids: string[];
    titles: string[];
  }> = [];
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
        issues?: Array<{ id?: unknown; title?: unknown }>;
      };
      const rows = (body.issues ?? []).filter(
        (issue): issue is { id: string; title: string } =>
          typeof issue.id === "string" && typeof issue.title === "string",
      );
      responses.push({
        url: response.url(),
        ids: rows.map((issue) => issue.id),
        titles: rows.map((issue) => issue.title),
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

function waitForTitleIssueListPage(
  page: Page,
  order: "asc" | "desc",
  hasCursor: boolean,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.get("limit") === "100" &&
      url.searchParams.get("sort_field") === "title" &&
      url.searchParams.get("sort_order") === order &&
      url.searchParams.has("cursor") === hasCursor &&
      response.ok()
    );
  });
}

function waitForDateIssueListPage(
  page: Page,
  field: "start_date" | "due_date",
  order: "asc" | "desc",
  hasCursor: boolean,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.get("limit") === "100" &&
      url.searchParams.get("sort_field") === field &&
      url.searchParams.get("sort_order") === order &&
      url.searchParams.has("cursor") === hasCursor &&
      response.ok()
    );
  });
}

async function readIssueListPage(response: Response) {
  const body = (await response.json()) as {
    issues?: Array<{ id?: unknown; title?: unknown }>;
  };
  const rows = (body.issues ?? []).filter(
    (issue): issue is { id: string; title: string } =>
      typeof issue.id === "string" && typeof issue.title === "string",
  );
  return {
    url: response.url(),
    ids: rows.map((issue) => issue.id),
    titles: rows.map((issue) => issue.title),
  };
}

async function readDateIssueListPage(
  response: Response,
  field: "start_date" | "due_date",
): Promise<Array<{ id: string; date: string | null }>> {
  const body = (await response.json()) as {
    issues?: Array<Record<string, unknown>>;
  };
  return (body.issues ?? []).flatMap((issue) => {
    const id = issue.id;
    const date = issue[field];
    if (typeof id !== "string" || (date !== null && typeof date !== "string")) {
      return [];
    }
    return [{ id, date: date ?? null }];
  });
}

function assertDatePageOrder(
  rows: Array<{ id: string; date: string | null }>,
  order: "asc" | "desc",
): void {
  let sawNull = false;
  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    if (!current) continue;
    if (current.date === null) {
      sawNull = true;
      continue;
    }
    expect(sawNull).toBe(false);
    const previous = rows[index - 1];
    if (!previous || previous.date === null) continue;
    const dateOrder = previous.date.localeCompare(current.date);
    const directedDateOrder = order === "asc" ? dateOrder : -dateOrder;
    if (directedDateOrder === 0) {
      expect(previous.id.localeCompare(current.id)).toBeGreaterThanOrEqual(0);
    } else {
      expect(directedDateOrder).toBeLessThanOrEqual(0);
    }
  }
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

function assertTitlePageOrder(
  ids: string[],
  titles: string[],
  order: "asc" | "desc",
): void {
  const collator = new Intl.Collator("en-US");
  for (let index = 1; index < ids.length; index += 1) {
    const titleOrder = collator.compare(
      titles[index - 1] ?? "",
      titles[index] ?? "",
    );
    const directedTitleOrder = order === "asc" ? titleOrder : -titleOrder;
    const tieOrder =
      ids[index - 1] === ids[index] ? 0 : ids[index - 1] < ids[index] ? 1 : -1;
    expect(directedTitleOrder || tieOrder).toBeLessThanOrEqual(0);
  }
}

test.describe("large issue list virtualization", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "large_vault");
  });

  test("keeps the selected List viewport positive and virtualized at an effective 200% viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openLargeList(page);

    const scroll = page.getByTestId("issue-list-scroll-container");
    const firstRow = page.locator('[data-testid="issue-list-row"]').first();
    await firstRow.getByTestId("issue-row-checkbox").click();
    await expect(firstRow).toHaveAttribute("aria-selected", "true");

    const metrics = await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      const rect = root.getBoundingClientRect();
      return {
        clientHeight: root.clientHeight,
        scrollHeight: root.scrollHeight,
        mountedRows: root.querySelectorAll('[data-testid="issue-list-row"]')
          .length,
        top: rect.top,
        bottom: rect.bottom,
      };
    });

    expect(metrics.clientHeight).toBeGreaterThan(0);
    expect(metrics.clientHeight).toBeLessThanOrEqual(360);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.mountedRows).toBeLessThanOrEqual(50);
    expect(metrics.bottom - metrics.top).toBe(metrics.clientHeight);
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

  test("keeps mixed title order exact across ASC/DESC cursor pages and the List UI", async ({
    page,
    request,
  }) => {
    for (const order of ["asc", "desc"] as const) {
      await resetFixture(request, "large_vault");
      const titlePage = await page.context().newPage();
      const initialResponse = waitForTitleIssueListPage(
        titlePage,
        order,
        false,
      );
      await openLargeList(titlePage, `sort=title&order=${order}`);
      const initial = await readIssueListPage(await initialResponse);

      const cursorResponse = waitForTitleIssueListPage(titlePage, order, true);
      await scrollToListEnd(titlePage);
      const cursorPage = await readIssueListPage(await cursorResponse);
      const ids = [...initial.ids, ...cursorPage.ids];
      const titles = [...initial.titles, ...cursorPage.titles];

      expect(initial.ids).toHaveLength(100);
      expect(cursorPage.ids).toHaveLength(100);
      expect(new Set(ids).size).toBe(ids.length);
      assertTitlePageOrder(ids, titles, order);

      const duplicateTitle =
        order === "asc" ? "! Symbol duplicate" : "힣 duplicate";
      const duplicateTitleIds = ids.filter(
        (id, index) => titles[index] === duplicateTitle,
      );
      expect(duplicateTitleIds).toEqual(
        order === "asc"
          ? ["REEF-0002", "REEF-0001"]
          : ["REEF-0004", "REEF-0003"],
      );

      const scroll = titlePage.getByTestId("issue-list-scroll-container");
      await scroll.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect
        .poll(() =>
          titlePage
            .locator('[data-testid="issue-list-row"]')
            .first()
            .getAttribute("data-issue-id"),
        )
        .toBe(initial.ids[0]);

      await titlePage.locator('[data-testid="issue-list-row"]').first().focus();
      for (let index = 0; index < 99; index += 1) {
        await titlePage.keyboard.press("j");
      }
      const mountedIds = await titlePage
        .locator('[data-testid="issue-list-row"]')
        .evaluateAll((rows) =>
          rows
            .map((row) => row.getAttribute("data-issue-id"))
            .filter((id): id is string => id !== null),
        );
      const loadedIndex = new Map(ids.map((id, index) => [id, index]));
      await expect(
        titlePage.locator(`[data-issue-id="${cursorPage.ids[0]}"]`),
      ).toBeVisible();
      expect(
        mountedIds.every(
          (id, index) =>
            index === 0 ||
            (loadedIndex.get(mountedIds[index - 1] ?? "") ?? -1) <
              (loadedIndex.get(id) ?? -1),
        ),
      ).toBe(true);
      await titlePage.close();
    }
  });

  test("keeps mixed start/due dates ahead of the NULL tail across cursor pages", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    for (const field of ["start_date", "due_date"] as const) {
      for (const order of ["asc", "desc"] as const) {
        await resetFixture(request, "large_vault");
        const initialResponse = waitForDateIssueListPage(
          page,
          field,
          order,
          false,
        );
        await openLargeList(page, `sort=${field}&order=${order}`);
        const initial = await readDateIssueListPage(
          await initialResponse,
          field,
        );

        const cursorResponse = waitForDateIssueListPage(
          page,
          field,
          order,
          true,
        );
        await scrollToListEnd(page);
        const cursorPage = await readDateIssueListPage(
          await cursorResponse,
          field,
        );
        const rows = [...initial, ...cursorPage];

        expect(initial).toHaveLength(100);
        expect(cursorPage).toHaveLength(100);
        expect(initial.some((row) => row.date === null)).toBe(true);
        expect(cursorPage.every((row) => row.date === null)).toBe(true);
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
        assertDatePageOrder(rows, order);
      }
    }
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
