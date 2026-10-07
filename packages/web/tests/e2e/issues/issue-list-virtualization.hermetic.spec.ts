import {
  type Page,
  type Response,
  type TestInfo,
  expect,
  test,
} from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueListFailure,
  setIssueReorderControl,
  signInAsAlice,
} from "../harness/fixture";

const LARGE_VAULT = "reef-e2e";
const TAIL_ISSUE_ID = "REEF-1124";
const CHECKBOX_FOCUS_ISSUE_ID = "REEF-1197";

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

function waitForSortedIssueListPage(
  page: Page,
  sortField:
    | "created_at"
    | "updated_at"
    | "title"
    | "start_date"
    | "due_date"
    | "reef_id",
  order: "asc" | "desc",
  hasCursor: boolean,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.get("limit") === "100" &&
      url.searchParams.get("sort_field") === sortField &&
      url.searchParams.get("sort_order") === order &&
      url.searchParams.has("cursor") === hasCursor &&
      response.ok()
    );
  });
}

function readTicketNumber(id: string): bigint {
  const match = /^[A-Z][A-Z0-9_]*-(\d+)$/u.exec(id);
  expect(match).not.toBeNull();
  return BigInt(match?.[1] ?? "0");
}

type FixtureIssue = Awaited<
  ReturnType<typeof readFixtureState>
>["vaults"][number]["issues"][number];

function canonicalTodoIds(issues: FixtureIssue[]): string[] {
  return issues
    .filter((issue) => issue.status === "todo")
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        if (left.rank === null) return 1;
        if (right.rank === null) return -1;
        return left.rank - right.rank;
      }
      const leftNumber = readTicketNumber(left.id);
      const rightNumber = readTicketNumber(right.id);
      return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? -1 : 1;
    })
    .map(({ id }) => id);
}

function assertTicketPageOrder(ids: string[], order: "asc" | "desc"): void {
  for (let index = 1; index < ids.length; index += 1) {
    const previous = readTicketNumber(ids[index - 1] ?? "");
    const current = readTicketNumber(ids[index] ?? "");
    expect(order === "asc" ? previous <= current : previous >= current).toBe(
      true,
    );
  }
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
  field: "created_at" | "updated_at" | "start_date" | "due_date",
): Promise<Array<{ id: string; date: string | null }>> {
  const body = (await response.json()) as {
    issues?: Array<Record<string, unknown>>;
  };
  return (body.issues ?? []).flatMap((issue) => {
    const id = issue.id;
    const date = issue[field];
    if (typeof id !== "string" || (date != null && typeof date !== "string")) {
      return [];
    }
    return [{ id, date: date ?? null }];
  });
}

async function readDateIssueListEnvelope(
  response: Response,
  field: "created_at" | "updated_at",
): Promise<{
  rows: Array<{ id: string; date: string | null }>;
  nextCursor: string | null;
}> {
  const body = (await response.json()) as {
    issues?: Array<Record<string, unknown>>;
    next_cursor?: unknown;
  };
  const rows = (body.issues ?? []).flatMap((issue) => {
    const id = issue.id;
    const date = issue[field];
    if (typeof id !== "string" || typeof date !== "string") return [];
    return [{ id, date }];
  });
  return {
    rows,
    nextCursor: typeof body.next_cursor === "string" ? body.next_cursor : null,
  };
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
      expect(readTicketNumber(previous.id)).toBeGreaterThanOrEqual(
        readTicketNumber(current.id),
      );
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

type FocusEdge = "left" | "right" | "top" | "bottom";
type ScreenshotBox = { x: number; y: number; width: number; height: number };
type FocusPixelEvidence = {
  focusColor: string;
  edges: Record<FocusEdge, { hits: number; samples: number }>;
};

async function inspectFocusPixels(
  page: Page,
  screenshot: Buffer,
  box: ScreenshotBox,
): Promise<FocusPixelEvidence> {
  return page.evaluate(
    async ({ png, box: targetBox }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Unable to read screenshot pixels");
      context.drawImage(image, 0, 0);

      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(
        document.documentElement,
      ).getPropertyValue("--brand-focus");
      document.body.append(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();
      const focusChannels = focusColor
        .match(/\d+(?:\.\d+)?/gu)
        ?.slice(0, 3)
        .map(Number);
      if (!focusChannels || focusChannels.length !== 3) {
        throw new Error(`Unable to parse focus color: ${focusColor}`);
      }

      const scaleX = canvas.width / window.innerWidth;
      const scaleY = canvas.height / window.innerHeight;
      const readPixel = (x: number, y: number) => {
        const pixelX = Math.max(
          0,
          Math.min(canvas.width - 1, Math.round(x * scaleX)),
        );
        const pixelY = Math.max(
          0,
          Math.min(canvas.height - 1, Math.round(y * scaleY)),
        );
        return context.getImageData(pixelX, pixelY, 1, 1).data;
      };
      const isFocusPixel = (pixel: Uint8ClampedArray) =>
        pixel[3] >= 220 &&
        Math.max(
          Math.abs(pixel[0] - (focusChannels[0] ?? 0)),
          Math.abs(pixel[1] - (focusChannels[1] ?? 0)),
          Math.abs(pixel[2] - (focusChannels[2] ?? 0)),
        ) <= 45;
      const collect = (points: Array<{ x: number; y: number }>) => ({
        hits: points.reduce(
          (count, point) =>
            count + (isFocusPixel(readPixel(point.x, point.y)) ? 1 : 0),
          0,
        ),
        samples: points.length,
      });
      const along = (start: number, end: number) => {
        const values: number[] = [];
        for (let value = start; value <= end; value += 2) values.push(value);
        return values;
      };
      const vertical = along(
        targetBox.y + 6,
        targetBox.y + targetBox.height - 6,
      );
      const horizontal = along(
        targetBox.x + 6,
        targetBox.x + targetBox.width - 6,
      );
      const left = vertical.flatMap((y) =>
        along(targetBox.x - 1, targetBox.x + 4).map((x) => ({ x, y })),
      );
      const right = vertical.flatMap((y) =>
        along(
          targetBox.x + targetBox.width - 4,
          targetBox.x + targetBox.width + 1,
        ).map((x) => ({ x, y })),
      );
      const top = horizontal.flatMap((x) =>
        along(targetBox.y - 1, targetBox.y + 4).map((y) => ({ x, y })),
      );
      const bottom = horizontal.flatMap((x) =>
        along(
          targetBox.y + targetBox.height - 4,
          targetBox.y + targetBox.height + 1,
        ).map((y) => ({ x, y })),
      );

      return {
        focusColor,
        edges: {
          left: collect(left),
          right: collect(right),
          top: collect(top),
          bottom: collect(bottom),
        },
      };
    },
    { png: screenshot.toString("base64"), box },
  );
}

async function captureFocusEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  hitTarget: { x: number; y: number; width: number; height: number },
): Promise<FocusPixelEvidence> {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  const screenshot = await page.screenshot({
    animations: "disabled",
    path: screenshotPath,
  });
  const evidence = await inspectFocusPixels(page, screenshot, hitTarget);
  await testInfo.attach(`${name}-pixel-evidence`, {
    body: JSON.stringify({ box: hitTarget, ...evidence }, null, 2),
    contentType: "application/json",
  });
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    expect(evidence.edges[edge].hits).toBeGreaterThanOrEqual(2);
  }
  await testInfo.attach(name, { path: screenshotPath });
  return evidence;
}

const CHECKBOX_FOCUS_VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "1024", width: 1024, height: 900 },
] as const;

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

  for (const viewport of CHECKBOX_FOCUS_VIEWPORTS) {
    test(`keeps all four selection-checkbox focus edges visible at ${viewport.name}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await openLargeList(page, "sort=reef_id&order=asc");

      const scroll = page.getByTestId("issue-list-scroll-container");
      await scroll.focus();
      const initialScrollTop = await scroll.evaluate(
        (element) => element.scrollTop,
      );
      await page.keyboard.press("PageDown");
      await expect
        .poll(() => scroll.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(initialScrollTop);

      const row = page.locator(`[data-issue-id="${CHECKBOX_FOCUS_ISSUE_ID}"]`);
      for (let index = 0; index < 20; index += 1) {
        if (await row.isVisible().catch(() => false)) break;
        await scrollToListEnd(page);
        await page.waitForTimeout(100);
      }
      await expect(row).toBeVisible({ timeout: 20_000 });

      const checkbox = row.getByTestId("issue-row-checkbox");
      const hitTarget = row.locator("label.reef-selection-checkbox");
      await row.focus();
      await page.keyboard.press("Tab");
      await expect(checkbox).toBeFocused();
      await page.keyboard.press("Space");
      await expect(row).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(checkbox).toBeFocused();
      await expect
        .poll(() =>
          checkbox.evaluate((element) => element.matches(":focus-visible")),
        )
        .toBe(true);

      const hitBox = await hitTarget.boundingBox();
      expect(hitBox).not.toBeNull();
      if (!hitBox) throw new Error("Missing selection checkbox hit target");

      const selectedEvidence = await captureFocusEvidence(
        page,
        testInfo,
        `list-${viewport.name}-selected-checkbox-focus`,
        hitBox,
      );
      expect(selectedEvidence.edges.left.hits).toBeGreaterThanOrEqual(2);
      expect(selectedEvidence.edges.right.hits).toBeGreaterThanOrEqual(2);

      await page.keyboard.press("Space");
      await expect(row).not.toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(checkbox).toBeFocused();

      const unselectedHitBox = await hitTarget.boundingBox();
      expect(unselectedHitBox).not.toBeNull();
      if (!unselectedHitBox) {
        throw new Error("Missing unselected selection checkbox hit target");
      }
      const unselectedEvidence = await captureFocusEvidence(
        page,
        testInfo,
        `list-${viewport.name}-unselected-checkbox-focus`,
        unselectedHitBox,
      );
      expect(unselectedEvidence.edges.top.hits).toBeGreaterThanOrEqual(2);
      expect(unselectedEvidence.edges.bottom.hits).toBeGreaterThanOrEqual(2);

      const otherRow = page.locator('[data-issue-id="REEF-1198"]');
      await otherRow.focus();
      await expect(otherRow).toBeFocused();
      await expect(row).not.toHaveAttribute("data-keyboard-focused", "true");
      await checkbox.click();
      await expect(row).toHaveAttribute("aria-selected", "true");
      const pointerState = await row.evaluate((element) => {
        const input = element.querySelector<HTMLInputElement>(
          '[data-testid="issue-row-checkbox"]',
        );
        const boundary = element.querySelector<HTMLElement>(
          'td[data-column-key="select"]',
        );
        return {
          inputFocusVisible: input?.matches(":focus-visible") ?? false,
          rowBoundary: boundary
            ? getComputedStyle(boundary, "::after").content
            : "",
        };
      });
      expect(pointerState.inputFocusVisible).toBe(false);
      expect(pointerState.rowBoundary).toBe("none");
    });
  }

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
    test.setTimeout(120_000);
    for (const order of ["asc", "desc"] as const) {
      await resetFixture(request, "large_vault");
      const titlePage = await page.context().newPage();
      const initialResponse = waitForSortedIssueListPage(
        titlePage,
        "title",
        order,
        false,
      );
      await openLargeList(titlePage, `sort=title&order=${order}`);
      const initial = await readIssueListPage(await initialResponse);

      const cursorResponse = waitForSortedIssueListPage(
        titlePage,
        "title",
        order,
        true,
      );
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

  test("loads every created/updated timestamp page in both directions", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    for (const field of ["created_at", "updated_at"] as const) {
      for (const order of ["asc", "desc"] as const) {
        await resetFixture(request, "large_vault");
        const initialResponse = waitForSortedIssueListPage(
          page,
          field,
          order,
          false,
        );
        await openLargeList(page, `sort=${field}&order=${order}`);

        const initial = await readDateIssueListEnvelope(
          await initialResponse,
          field,
        );
        const allRows = [...initial.rows];
        let nextCursor = initial.nextCursor;
        let pageCount = 1;

        while (nextCursor !== null) {
          expect(pageCount).toBeLessThan(20);
          const cursorResponse = waitForSortedIssueListPage(
            page,
            field,
            order,
            true,
          );
          await scrollToListEnd(page);
          const nextPage = await readDateIssueListEnvelope(
            await cursorResponse,
            field,
          );
          expect(nextPage.rows.length).toBeGreaterThan(0);
          allRows.push(...nextPage.rows);
          nextCursor = nextPage.nextCursor;
          pageCount += 1;
        }

        expect(initial.rows).toHaveLength(100);
        expect(allRows).toHaveLength(1_205);
        expect(new Set(allRows.map((row) => row.id)).size).toBe(allRows.length);
        expect(nextCursor).toBeNull();
        assertDatePageOrder(allRows, order);
      }
    }
  });

  test("keeps numeric ticket-number order and the 999/1000 cursor boundary across pages", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    for (const order of ["asc", "desc"] as const) {
      await resetFixture(request, "large_vault");
      const ticketPage = await page.context().newPage();
      const requests = issueListRequests(ticketPage);
      const initialResponse = waitForSortedIssueListPage(
        ticketPage,
        "reef_id",
        order,
        false,
      );
      await openLargeList(ticketPage, `sort=reef_id&order=${order}`);
      const ids = (await readIssueListPage(await initialResponse)).ids;

      for (let pageIndex = 0; pageIndex < 12; pageIndex += 1) {
        if (
          ids.includes("REEF-999") &&
          ids.includes("REEF-1000") &&
          ids.includes("REEF-1002")
        ) {
          break;
        }

        const cursorResponse = waitForSortedIssueListPage(
          ticketPage,
          "reef_id",
          order,
          true,
        );
        await scrollToListEnd(ticketPage);
        ids.push(...(await readIssueListPage(await cursorResponse)).ids);
      }

      expect(ids).toContain("REEF-999");
      expect(ids).toContain("REEF-1000");
      expect(ids).toContain("REEF-1002");
      expect(ids).not.toContain("REEF-1001");
      expect(new Set(ids).size).toBe(ids.length);
      assertTicketPageOrder(ids, order);

      const nineNinetyNine = ids.indexOf("REEF-999");
      const oneThousand = ids.indexOf("REEF-1000");
      expect(
        order === "asc"
          ? nineNinetyNine < oneThousand
          : nineNinetyNine > oneThousand,
      ).toBe(true);

      const ticketRequests = requests.filter((raw) => {
        const url = new URL(raw);
        return (
          url.searchParams.get("sort_field") === "reef_id" &&
          url.searchParams.get("sort_order") === order
        );
      });
      expect(ticketRequests.length).toBeGreaterThan(order === "asc" ? 10 : 1);

      const explicitCursor = Buffer.from(
        JSON.stringify({ k: "1000", id: "REEF-1000" }),
      ).toString("base64url");
      const boundaryPage = await ticketPage.evaluate(
        async ({ order: requestedOrder, cursor }) => {
          const response = await fetch(
            `/api/issues?vault=reef-e2e&limit=100&sort_field=reef_id&sort_order=${requestedOrder}&cursor=${encodeURIComponent(cursor)}`,
          );
          return {
            status: response.status,
            body: (await response.json()) as {
              issues?: Array<{ id?: unknown }>;
            },
          };
        },
        { order, cursor: explicitCursor },
      );
      expect(boundaryPage.status).toBe(200);
      const boundaryIds = (boundaryPage.body.issues ?? []).flatMap((issue) =>
        typeof issue.id === "string" ? [issue.id] : [],
      );
      expect(boundaryIds[0]).toBe(order === "asc" ? "REEF-1002" : "REEF-999");
      expect(boundaryIds).not.toContain("REEF-1001");
      assertTicketPageOrder(boundaryIds, order);
      await ticketPage.close();
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
        const initialResponse = waitForSortedIssueListPage(
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

        const cursorResponse = waitForSortedIssueListPage(
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
    const initialSparseResponse = waitForSortedIssueListPage(
      sparsePage,
      "reef_id",
      "asc",
      false,
    );
    const responses = issueListResponses(sparsePage);
    await openExistingWorkspace(sparsePage, LARGE_VAULT);
    await sparsePage.goto(
      `/workspace/${LARGE_VAULT}/issues?view=list&sort=reef_id&order=asc`,
    );
    const initialSparsePage = await readIssueListPage(
      await initialSparseResponse,
    );
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
    expect(initialSparsePage.ids).not.toContain(TAIL_ISSUE_ID);
    await sparsePage.close();
  });

  test("moves keyboard focus to an unmounted logical row and opens it", async ({
    page,
  }) => {
    await openLargeList(page, "sort=reef_id&order=asc");
    const target = page.locator(`[data-issue-id="REEF-0101"]`);
    const cursorResponse = waitForIssueListPage(page, true);
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 99; index += 1) {
      await page.keyboard.press("j");
    }
    await cursorResponse;
    await expect(target).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("j");
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
    await openLargeList(page, "sort=reef_id&order=asc&labels=large-fixture");
    const first = page.locator('[data-issue-id="REEF-0101"]');
    const second = page.locator('[data-issue-id="REEF-0102"]');
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 100; index += 1) {
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
    await openLargeList(
      page,
      "sort=reef_id&order=asc&group=priority&labels=large-fixture",
    );

    await expect
      .poll(() => page.locator('[data-testid="issue-list-row"]').count())
      .toBeLessThanOrEqual(50);
    await expect(
      page.locator('[data-testid="issue-group-header"]').first(),
    ).toBeVisible();

    const first = page.locator('[data-issue-id="REEF-0101"]').first();
    const second = page.locator('[data-issue-id="REEF-0102"]').first();
    const cursorResponse = waitForIssueListPage(page, true);
    await page.locator('[data-testid="issue-list-row"]').first().focus();
    for (let index = 0; index < 99; index += 1) {
      await page.keyboard.press("j");
    }
    await cursorResponse;
    await expect(first).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("j");
    await expect(first).toHaveAttribute("data-keyboard-focused", "true");
    await first.getByTestId("issue-row-checkbox").click();
    await second
      .getByTestId("issue-row-checkbox")
      .click({ modifiers: ["Shift"] });
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(second).toHaveAttribute("aria-selected", "true");

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

test.describe("large Board column virtualization", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "large_vault");
  });

  test("restores default Rank Board focus and pixel anchor after Reports navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, LARGE_VAULT);
    await page.goto(`/workspace/${LARGE_VAULT}/issues?view=list&scope=active`);
    await expect(page.getByTestId("view-switcher-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("scope-switcher-active")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("view-switcher-board").click();
    await expect(page).toHaveURL(/\/issues\?view=board&scope=active$/);
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const column = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    await expect(column).toHaveAttribute("aria-label", "Todo, 1205", {
      timeout: 20_000,
    });

    let tabbedIntoCard = false;
    for (let index = 0; index < 80; index += 1) {
      if (
        (await page.locator('[data-testid="kanban-card"]:focus').count()) > 0
      ) {
        tabbedIntoCard = true;
        break;
      }
      await page.keyboard.press("Tab");
    }
    expect(tabbedIntoCard).toBe(true);

    const focusIssueWithArrowDown = async (issueId: string) => {
      for (let index = 0; index < 1_210; index += 1) {
        const focusedId = await page
          .locator('[data-testid="kanban-card"][data-keyboard-focused="true"]')
          .getAttribute("data-issue-id")
          .catch(() => null);
        if (focusedId === issueId) return index;
        await page.keyboard.press("ArrowDown");
      }
      throw new Error(`ArrowDown did not focus ${issueId}`);
    };
    await focusIssueWithArrowDown("REEF-1170");
    const firstDetailCard = page.locator(
      '[data-testid="kanban-card"][data-issue-id="REEF-1170"]',
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(firstDetailCard).toBeFocused();

    await focusIssueWithArrowDown("REEF-1168");
    const secondDetailCard = page.locator(
      '[data-testid="kanban-card"][data-issue-id="REEF-1168"]',
    );
    await secondDetailCard.click();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(secondDetailCard).toBeFocused();
    await page.keyboard.press("ArrowDown");

    const anchorCard = column.locator(
      '[data-testid="kanban-card"][data-issue-id="REEF-1167"]',
    );
    await expect(anchorCard).toHaveAttribute("data-keyboard-focused", "true");
    await expect(anchorCard).toBeFocused();
    await expect(anchorCard).toBeVisible();
    const readStableAnchor = async () =>
      anchorCard.evaluate(async (element) => {
        const root = element.closest<HTMLElement>(
          '[data-testid="kanban-column-scroll-container"]',
        );
        if (!root) throw new Error("missing Board column scroll container");
        const read = () => {
          const rect = element.getBoundingClientRect();
          const rootRect = root.getBoundingClientRect();
          return {
            id: element.getAttribute("data-issue-id"),
            occurrenceKey: element.getAttribute("data-occurrence-key"),
            offset: rect.top - rootRect.top,
            scrollTop: root.scrollTop,
            focused: document.activeElement === element,
          };
        };
        const nextFrame = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        let previous = read();
        while (true) {
          await nextFrame();
          const current = read();
          if (
            current.offset === previous.offset &&
            current.scrollTop === previous.scrollTop
          ) {
            return current;
          }
          previous = current;
        }
      });
    const before = await readStableAnchor();
    expect(before.scrollTop).toBeGreaterThan(0);

    await page.getByTestId("sidebar-nav-reports").click();
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${LARGE_VAULT}/reports(?:/|$)`),
    );
    await page.getByTestId("sidebar-nav-issues").click();
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${LARGE_VAULT}/issues(?:\\?|$)`),
    );
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(column).toHaveAttribute("aria-label", "Todo, 1205", {
      timeout: 20_000,
    });
    await expect(anchorCard).toBeVisible();
    await expect(anchorCard).toBeFocused();
    await expect(anchorCard).toHaveAttribute("data-keyboard-focused", "true");
    await expect
      .poll(() =>
        readStableAnchor().then((position) =>
          Math.abs(position.offset - before.offset),
        ),
      )
      .toBeLessThanOrEqual(2);
    const after = await readStableAnchor();
    expect(after.id).toBe("REEF-1167");
    expect(after.occurrenceKey).toBe(before.occurrenceKey);
    expect(after.focused).toBe(true);
    expect(after.scrollTop).toBeGreaterThan(0);
  });

  test("retries the complete Board projection without introducing cursors", async ({
    page,
    request,
  }) => {
    await setIssueListFailure(request, true);
    const boardRequests: string[] = [];
    const isBoardProjection = (url: URL) => {
      const statuses = url.searchParams.getAll("status");
      return (
        url.pathname === "/api/issues" &&
        url.searchParams.get("vault") === LARGE_VAULT &&
        url.searchParams.get("sort_field") === "rank" &&
        statuses.length === 5 &&
        ["todo", "in_progress", "in_review", "done", "closed"].every((status) =>
          statuses.includes(status),
        )
      );
    };
    page.on("request", (requestEvent) => {
      const url = new URL(requestEvent.url());
      if (requestEvent.method() === "GET" && isBoardProjection(url)) {
        boardRequests.push(url.toString());
      }
    });
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, LARGE_VAULT);
    await page.goto(`/workspace/${LARGE_VAULT}/issues?view=board`);
    await expect(
      page
        .locator('[role="alert"]')
        .filter({ hasText: "Failed to load some issues." }),
    ).toContainText("Failed to load some issues.", { timeout: 20_000 });
    const failedBoardRequestCount = boardRequests.length;
    expect(failedBoardRequestCount).toBeGreaterThan(0);
    expect(
      boardRequests.every((raw) => !new URL(raw).searchParams.has("cursor")),
    ).toBe(true);

    await setIssueListFailure(request, false);
    const retryResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        isBoardProjection(url) &&
        response.ok()
      );
    });
    await page.getByRole("button", { name: "Retry" }).click();
    const retryResponse = await retryResponsePromise;
    expect(retryResponse.status()).toBe(200);
    expect(new URL(retryResponse.url()).searchParams.has("cursor")).toBe(false);
    await expect(
      page.locator('[data-group-by="status"][data-group-value="todo"]'),
    ).toHaveAttribute("aria-label", "Todo, 1205");
    expect(boardRequests).toHaveLength(failedBoardRequestCount + 1);
  });

  test("pointer auto-scroll reorders past the mounted window using canonical neighbours", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, LARGE_VAULT);
    const initialState = await readFixtureState(request);
    const initialIssues = initialState.vaults.find(
      (vault) => vault.name === LARGE_VAULT,
    )?.issues;
    if (!initialIssues) throw new Error("missing large-vault issues");
    const initialOrder = canonicalTodoIds(initialIssues);
    const sourceId = initialOrder[0];
    if (!sourceId) throw new Error("missing initial canonical Board issue");

    await page.goto(`/workspace/${LARGE_VAULT}/issues?view=board`);
    await expect(page.getByTestId("sort-control-trigger")).toContainText(
      "Rank order",
    );
    const column = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    const scroll = column.getByTestId("kanban-column-scroll-container");
    const source = column.locator(
      `[data-testid="kanban-card"][data-issue-id="${sourceId}"]`,
    );
    await expect(source).toBeVisible();
    const initialMountedIds = await column
      .getByTestId("kanban-card")
      .evaluateAll((cards) =>
        cards
          .map((card) => card.getAttribute("data-issue-id"))
          .filter((id): id is string => id !== null),
      );
    const scrollBox = await scroll.boundingBox();
    const sourceBox = await source.boundingBox();
    if (!scrollBox || !sourceBox) {
      throw new Error("missing initial Board drag bounds");
    }
    const reorderRequestPromise = page.waitForRequest((requestEvent) => {
      return (
        requestEvent.method() === "POST" &&
        new URL(requestEvent.url()).pathname === "/api/issues/reorder"
      );
    });
    const reorderResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder"
      );
    });

    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 8,
      sourceBox.y + sourceBox.height / 2,
    );
    await expect(source).toHaveAttribute("data-dragging", "true");
    await page.mouse.move(
      scrollBox.x + scrollBox.width / 2,
      scrollBox.y + scrollBox.height - 8,
      { steps: 8 },
    );
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const safeDropInset = 64;
    const readVisibleDropCandidates = () =>
      scroll.evaluate((element) => {
        const root = element as HTMLElement;
        const rootRect = root.getBoundingClientRect();
        const cards = Array.from(
          root.querySelectorAll<HTMLElement>('[data-testid="kanban-card"]'),
        );
        const visible = cards.flatMap((card) => {
          const issueId = card.dataset.issueId;
          if (!issueId) return [];
          const rect = card.getBoundingClientRect();
          return rect.top >= rootRect.top + 8 &&
            rect.bottom <= rootRect.bottom - 8
            ? [{ issueId, top: rect.top, bottom: rect.bottom }]
            : [];
        });
        return {
          rootTop: rootRect.top,
          rootBottom: rootRect.bottom,
          mountedIds: cards.flatMap((card) =>
            card.dataset.issueId ? [card.dataset.issueId] : [],
          ),
          visible,
        };
      });
    await expect
      .poll(
        async () => {
          const snapshot = await readVisibleDropCandidates();
          return snapshot.visible.some((candidate) => {
            const index = initialOrder.indexOf(candidate.issueId);
            return (
              index > initialMountedIds.length - 1 &&
              candidate.top >= snapshot.rootTop + safeDropInset &&
              candidate.bottom <= snapshot.rootBottom - safeDropInset
            );
          });
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const targetCandidate = await readVisibleDropCandidates();
    const safeTarget = targetCandidate.visible.find((candidate) => {
      const index = initialOrder.indexOf(candidate.issueId);
      return (
        index > initialMountedIds.length - 1 &&
        candidate.top >= targetCandidate.rootTop + safeDropInset &&
        candidate.bottom <= targetCandidate.rootBottom - safeDropInset
      );
    });
    const targetId = safeTarget?.issueId;
    if (!targetId) throw new Error("missing mounted Board drop target");
    const targetIndex = initialOrder.indexOf(targetId);
    expect(targetIndex).toBeGreaterThan(initialMountedIds.length - 1);
    expect(initialMountedIds).not.toContain(targetId);
    expect(targetCandidate.mountedIds).toContain(sourceId);
    expect(targetCandidate.mountedIds.length).toBeLessThanOrEqual(50);

    const target = column.locator(
      `[data-testid="kanban-card"][data-issue-id="${targetId}"]`,
    );
    const waitForStableTarget = async () => {
      let previousScrollTop: number | null = null;
      let previousTargetBox: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = null;
      await expect
        .poll(
          async () => {
            const [currentScrollTop, currentTargetBox] = await Promise.all([
              scroll.evaluate((element) => (element as HTMLElement).scrollTop),
              target.boundingBox(),
            ]);
            const stable =
              currentTargetBox !== null &&
              previousTargetBox !== null &&
              currentScrollTop === previousScrollTop &&
              Math.abs(currentTargetBox.x - previousTargetBox.x) < 1 &&
              Math.abs(currentTargetBox.y - previousTargetBox.y) < 1 &&
              Math.abs(currentTargetBox.width - previousTargetBox.width) < 1 &&
              Math.abs(currentTargetBox.height - previousTargetBox.height) < 1;
            previousScrollTop = currentScrollTop;
            previousTargetBox = currentTargetBox;
            return stable;
          },
          { timeout: 5_000 },
        )
        .toBe(true);
    };
    let targetBox = await target.boundingBox();
    if (!targetBox) throw new Error("missing mounted Board target bounds");
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 },
    );
    await waitForStableTarget();
    targetBox = await target.boundingBox();
    if (!targetBox) throw new Error("missing settled Board target bounds");
    const releasePoint = {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + targetBox.height / 2,
    };
    await page.mouse.move(releasePoint.x, releasePoint.y, { steps: 1 });
    const pointerTargetAtRelease = await page.evaluate(
      ({ x, y, activeIssueId }) => {
        const elements = document.elementsFromPoint(x, y);
        const cards = elements
          .map((element) =>
            element.closest<HTMLElement>(
              '[data-testid="kanban-card"][data-occurrence-key]',
            ),
          )
          .filter((candidate): candidate is HTMLElement => candidate !== null);
        const card =
          cards.find(
            (candidate) => candidate.dataset.issueId !== activeIssueId,
          ) ?? cards[0];
        const column = elements
          .map((element) => element.closest<HTMLElement>("[data-group-by]"))
          .find((candidate): candidate is HTMLElement => candidate !== null);
        return {
          issueId: card?.dataset.issueId ?? null,
          groupBy: column?.dataset.groupBy ?? null,
          groupValue: column?.dataset.groupValue ?? null,
        };
      },
      { ...releasePoint, activeIssueId: sourceId },
    );
    expect(pointerTargetAtRelease).toMatchObject({
      issueId: targetId,
      groupBy: "status",
      groupValue: "todo",
    });
    await page.mouse.up();

    const [reorderRequest, reorderResponse] = await Promise.all([
      reorderRequestPromise,
      reorderResponsePromise,
    ]);
    expect(reorderResponse.status()).toBe(200);
    const requestBody = reorderRequest.postDataJSON() as {
      issue_id?: unknown;
      before_id?: unknown;
      after_id?: unknown;
    };
    expect(requestBody).toMatchObject({
      issue_id: sourceId,
    });
    const beforeId = requestBody.before_id;
    const afterId = requestBody.after_id;
    if (typeof beforeId !== "string" || typeof afterId !== "string") {
      throw new Error("missing canonical neighbours in Board reorder request");
    }
    const beforeIndex = initialOrder.indexOf(beforeId);
    const afterIndex = initialOrder.indexOf(afterId);
    const expectedAfterId = initialOrder[targetIndex + 1];
    expect(expectedAfterId).toBeDefined();
    expect(beforeId).toBe(targetId);
    expect(afterId).toBe(expectedAfterId);
    expect(beforeIndex).toBeGreaterThan(initialMountedIds.length - 1);
    expect(beforeIndex).toBe(targetIndex);
    expect(afterIndex).toBe(targetIndex + 1);

    const persistedState = await readFixtureState(request);
    const persistedIssues = persistedState.vaults.find(
      (vault) => vault.name === LARGE_VAULT,
    )?.issues;
    if (!persistedIssues)
      throw new Error("missing persisted large-vault issues");
    const persistedOrder = canonicalTodoIds(persistedIssues);
    const movedIndex = persistedOrder.indexOf(sourceId);
    expect(persistedOrder.slice(movedIndex - 1, movedIndex + 2)).toEqual([
      targetId,
      sourceId,
      expectedAfterId,
    ]);
  });

  test("keyboard Manual reorder crosses virtual windows, cancels, and persists exact neighbours", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, LARGE_VAULT);
    const initialState = await readFixtureState(request);
    const initialIssues = initialState.vaults.find(
      (vault) => vault.name === LARGE_VAULT,
    )?.issues;
    if (!initialIssues) throw new Error("missing large-vault issues");
    const initialOrder = canonicalTodoIds(initialIssues);
    const sourceId = initialOrder[0];
    if (!sourceId) throw new Error("missing initial canonical Board issue");

    await page.goto(`/workspace/${LARGE_VAULT}/issues?view=board`);
    const column = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    const scroll = column.getByTestId("kanban-column-scroll-container");
    const source = column.locator(
      `[data-testid="kanban-card"][data-issue-id="${sourceId}"]`,
    );
    await expect(source).toBeVisible();
    const initialMountedIds = await column
      .getByTestId("kanban-card")
      .evaluateAll((cards) =>
        cards
          .map((card) => card.getAttribute("data-issue-id"))
          .filter((id): id is string => id !== null),
      );
    let reorderRequestCount = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        new URL(requestEvent.url()).pathname === "/api/issues/reorder"
      ) {
        reorderRequestCount += 1;
      }
    });

    await source.focus();
    await page.keyboard.press("Space");
    await expect(source).toHaveAttribute("data-dragging", "true");
    for (let index = 0; index < 100; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(source).not.toHaveAttribute("data-dragging", "true");
    expect(reorderRequestCount).toBe(0);
    const afterCancel = await readFixtureState(request);
    const afterCancelIssues = afterCancel.vaults.find(
      (vault) => vault.name === LARGE_VAULT,
    )?.issues;
    if (!afterCancelIssues) throw new Error("missing issues after drag cancel");
    expect(canonicalTodoIds(afterCancelIssues)).toEqual(initialOrder);

    await scroll.evaluate(async (element) => {
      (element as HTMLElement).scrollTop = 0;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await source.focus();
    await page.keyboard.press("Space");
    await expect(source).toHaveAttribute("data-dragging", "true");
    for (let index = 0; index < 100; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const mountedAfterKeyboardMove = await column
      .getByTestId("kanban-card")
      .evaluateAll((cards) =>
        cards
          .map((card) => card.getAttribute("data-issue-id"))
          .filter((id): id is string => id !== null),
      );
    expect(
      mountedAfterKeyboardMove.some((id) => !initialMountedIds.includes(id)),
    ).toBe(true);

    const reorderRequestPromise = page.waitForRequest((requestEvent) => {
      return (
        requestEvent.method() === "POST" &&
        new URL(requestEvent.url()).pathname === "/api/issues/reorder"
      );
    });
    const reorderResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder"
      );
    });
    await setIssueReorderControl(request, { failures: 1 });
    await page.keyboard.press("Space");
    const [failedRequest, failedResponse] = await Promise.all([
      reorderRequestPromise,
      reorderResponsePromise,
    ]);
    expect(failedResponse.ok()).toBe(false);
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    expect(reorderRequestCount).toBe(1);
    const failedRequestBody = failedRequest.postDataJSON() as {
      issue_id?: unknown;
      before_id?: unknown;
      after_id?: unknown;
    };
    expect(failedRequestBody.issue_id).toBe(sourceId);
    expect(typeof failedRequestBody.before_id).toBe("string");
    expect(typeof failedRequestBody.after_id).toBe("string");
    expect(initialMountedIds).not.toContain(failedRequestBody.before_id);
    expect(initialMountedIds).not.toContain(failedRequestBody.after_id);
    await expect(source).toHaveAttribute("data-reorder-state", "error");
    const afterFailure = await readFixtureState(request);
    const afterFailureIssues = afterFailure.vaults.find(
      (vault) => vault.name === LARGE_VAULT,
    )?.issues;
    if (!afterFailureIssues)
      throw new Error("missing issues after reorder failure");
    expect(canonicalTodoIds(afterFailureIssues)).toEqual(initialOrder);

    const retryRequestPromise = page.waitForRequest((requestEvent) => {
      return (
        requestEvent.method() === "POST" &&
        new URL(requestEvent.url()).pathname === "/api/issues/reorder"
      );
    });
    const retryResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder"
      );
    });
    await page.getByRole("button", { name: "Retry" }).click();
    const [retryRequest, retryResponse] = await Promise.all([
      retryRequestPromise,
      retryResponsePromise,
    ]);
    expect(retryResponse.status()).toBe(200);
    expect(retryRequest.postDataJSON()).toEqual(failedRequest.postDataJSON());
    expect(reorderRequestCount).toBe(2);

    const persistedState = await readFixtureState(request);
    const persistedIssues = persistedState.vaults.find(
      (vault) => vault.name === LARGE_VAULT,
    )?.issues;
    if (!persistedIssues)
      throw new Error("missing persisted large-vault issues");
    const persistedOrder = canonicalTodoIds(persistedIssues);
    const movedIndex = persistedOrder.indexOf(sourceId);
    expect(persistedOrder[movedIndex - 1]).toBe(failedRequestBody.before_id);
    expect(persistedOrder[movedIndex + 1]).toBe(failedRequestBody.after_id);
  });

  test("bounds mounted cards and preserves deep keyboard focus and detail continuity", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, LARGE_VAULT);
    await page.addInitScript(() => {
      const metrics = {
        issueResponses: [] as Array<{
          url: string;
          parseMs: number;
          parsedAt: number;
          issueCount: number | null;
          responseBytes: number;
        }>,
        firstCardDomAt: null as number | null,
        mountedCardsAtFirstDom: 0,
      };
      const runtimeWindow = window as Window & {
        __reefBoardVirtualizationMetrics?: typeof metrics;
      };
      runtimeWindow.__reefBoardVirtualizationMetrics = metrics;
      const recordFirstCardDom = () => {
        if (
          metrics.issueResponses.length === 0 ||
          metrics.firstCardDomAt !== null
        ) {
          return;
        }
        const column = document.querySelector<HTMLElement>(
          '[data-group-by="status"][data-group-value="todo"]',
        );
        const mountedCards =
          column?.querySelectorAll('[data-testid="kanban-card"]').length ?? 0;
        if (mountedCards === 0) return;
        metrics.firstCardDomAt = performance.now();
        metrics.mountedCardsAtFirstDom = mountedCards;
        observer.disconnect();
      };
      const observer = new MutationObserver(recordFirstCardDom);

      const originalJson = Response.prototype.json;
      Response.prototype.json = async function timedJson() {
        const url = this.url;
        const startedAt = performance.now();
        const result = await originalJson.call(this);
        if (new URL(url).pathname === "/api/issues") {
          const parsedAt = performance.now();
          const issueCount = Array.isArray(result?.issues)
            ? result.issues.length
            : null;
          metrics.issueResponses.push({
            url,
            parseMs: parsedAt - startedAt,
            parsedAt,
            issueCount,
            responseBytes: new TextEncoder().encode(JSON.stringify(result))
              .byteLength,
          });
          recordFirstCardDom();
        }
        return result;
      };

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      recordFirstCardDom();
    });

    const issueListResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/issues" &&
        response.ok()
      );
    });
    await page.goto(
      `/workspace/${LARGE_VAULT}/issues?view=board&sort=reef_id&order=asc`,
    );
    const issueListResponse = await issueListResponsePromise;

    const column = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    await expect(column).toHaveAttribute("aria-label", "Todo, 1205", {
      timeout: 20_000,
    });
    const scroll = column.getByTestId("kanban-column-scroll-container");
    const firstCard = column.locator(
      '[data-testid="kanban-card"][data-issue-id="REEF-0001"]',
    );
    await expect(firstCard).toBeVisible();

    const initialMetrics = await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      return {
        clientHeight: root.clientHeight,
        scrollHeight: root.scrollHeight,
        mountedCards: root.querySelectorAll('[data-testid="kanban-card"]')
          .length,
      };
    });
    expect(initialMetrics.clientHeight).toBeGreaterThan(0);
    expect(initialMetrics.scrollHeight).toBeGreaterThan(
      initialMetrics.clientHeight,
    );
    expect(initialMetrics.mountedCards).toBeLessThanOrEqual(50);

    const viewportGeometry = await scroll.evaluate(async (element) => {
      const root = element as HTMLElement;
      const samples: Array<{
        position: "top" | "middle" | "end";
        scrollTop: number;
        issueIds: string[];
        heights: number[];
        indexes: number[];
        adjacentGaps: number[];
        leadingGap: number;
        trailingGap: number;
      }> = [];
      const settleVirtualWindow = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

      for (const position of ["top", "middle", "end"] as const) {
        const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
        root.scrollTop =
          position === "top"
            ? 0
            : position === "middle"
              ? Math.round(maxScrollTop * (600 / 1_205))
              : maxScrollTop;
        await settleVirtualWindow();
        if (position === "end") {
          root.scrollTop = root.scrollHeight;
          await settleVirtualWindow();
        }

        const rootRect = root.getBoundingClientRect();
        const visibleCards = Array.from(
          root.querySelectorAll<HTMLElement>('[data-testid="kanban-card"]'),
        )
          .map((card) => {
            const rect = card.getBoundingClientRect();
            return {
              id: card.dataset.issueId ?? "",
              index: Number(
                card.closest<HTMLElement>("[data-index]")?.dataset.index,
              ),
              top: rect.top,
              bottom: rect.bottom,
              height: rect.height,
            };
          })
          .filter(
            (card) => card.bottom > rootRect.top && card.top < rootRect.bottom,
          )
          .sort((left, right) => left.top - right.top);
        const firstCard = visibleCards[0];
        const lastCard = visibleCards.at(-1);
        samples.push({
          position,
          scrollTop: root.scrollTop,
          issueIds: visibleCards.map((card) => card.id),
          heights: visibleCards.map(
            (card) => Math.round(card.height * 100) / 100,
          ),
          indexes: visibleCards.map((card) => card.index),
          adjacentGaps: visibleCards.slice(1).map((card, index) => {
            const previousCard = visibleCards[index];
            return (
              Math.round(
                (card.top - (previousCard?.bottom ?? card.top)) * 100,
              ) / 100
            );
          }),
          leadingGap: firstCard ? firstCard.top - rootRect.top : Number.NaN,
          trailingGap: lastCard
            ? rootRect.bottom - lastCard.bottom
            : Number.NaN,
        });
      }
      root.scrollTop = 0;
      await settleVirtualWindow();
      return samples;
    });
    expect(viewportGeometry.map(({ position }) => position)).toEqual([
      "top",
      "middle",
      "end",
    ]);
    expect(viewportGeometry[0]?.issueIds).toContain("REEF-0001");
    expect(viewportGeometry[0]?.issueIds).toContain("REEF-0005");
    expect(viewportGeometry[1]?.issueIds).toContain("REEF-0601");
    expect(viewportGeometry[2]?.issueIds).toContain("REEF-1206");
    for (const sample of viewportGeometry) {
      expect(sample.heights.length).toBeGreaterThan(1);
      expect(
        Math.max(...sample.heights) - Math.min(...sample.heights),
      ).toBeGreaterThan(8);
      expect(
        sample.indexes.slice(1).every((index, offset) => {
          return index - (sample.indexes[offset] ?? index) === 1;
        }),
      ).toBe(true);
      expect(sample.adjacentGaps.every((gap) => gap >= -1 && gap <= 16)).toBe(
        true,
      );
    }
    expect(viewportGeometry[0]?.leadingGap).toBeLessThanOrEqual(16);
    expect(viewportGeometry[2]?.trailingGap).toBeLessThanOrEqual(16);

    const scrollRenderMs = await scroll.evaluate(async (element) => {
      const root = element as HTMLElement;
      const startedAt = performance.now();
      root.scrollTop = Math.min(1024, root.scrollHeight);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return performance.now() - startedAt;
    });
    const mountedCardsAfterScroll = await scroll.evaluate(
      (element) =>
        (element as HTMLElement).querySelectorAll('[data-testid="kanban-card"]')
          .length,
    );
    await scroll.evaluate(async (element) => {
      (element as HTMLElement).scrollTop = 0;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toBeInViewport({ ratio: 0.5 });

    const firstCardBounds = await firstCard.boundingBox();
    if (!firstCardBounds) throw new Error("missing initial Todo card bounds");
    const dragStartedAt = await page.evaluate(() => performance.now());
    await page.mouse.move(
      firstCardBounds.x + firstCardBounds.width / 2,
      firstCardBounds.y + firstCardBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      firstCardBounds.x + firstCardBounds.width / 2 + 8,
      firstCardBounds.y + firstCardBounds.height / 2,
    );
    await expect(firstCard).toHaveAttribute("data-dragging", "true", {
      timeout: 15_000,
    });
    const dragStartMs = await page.evaluate(
      (startedAt) => performance.now() - startedAt,
      dragStartedAt,
    );
    const activeDragScrollMs = await scroll.evaluate(async (element) => {
      const root = element as HTMLElement;
      const startedAt = performance.now();
      root.scrollTop = root.scrollHeight;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return performance.now() - startedAt;
    });
    const activeDragMetrics = await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      return {
        mountedCards: root.querySelectorAll('[data-testid="kanban-card"]')
          .length,
        activeCards: root.querySelectorAll(
          '[data-testid="kanban-card"][data-issue-id="REEF-0001"]',
        ).length,
        scrollTop: root.scrollTop,
      };
    });
    expect(activeDragMetrics.scrollTop).toBeGreaterThan(0);
    expect(activeDragMetrics.activeCards).toBe(1);
    expect(activeDragMetrics.mountedCards).toBeLessThanOrEqual(50);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(firstCard).not.toHaveAttribute("data-dragging", "true");

    const target = column.locator(
      '[data-testid="kanban-card"][data-issue-id="REEF-0101"]',
    );
    await expect(target).toHaveCount(0);
    await firstCard.focus();
    const keyboardStartedAt = await page.evaluate(() => performance.now());
    for (let index = 0; index < 100; index += 1) {
      await page.keyboard.press("j");
    }
    const keyboardTraversalMs = await page.evaluate(
      (startedAt) => performance.now() - startedAt,
      keyboardStartedAt,
    );
    await expect(target).toHaveAttribute("data-keyboard-focused", "true", {
      timeout: 15_000,
    });
    await expect(target).toBeFocused();
    const deepScrollMetrics = await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      const rootRect = root.getBoundingClientRect();
      const targetRect = root
        .querySelector<HTMLElement>('[data-issue-id="REEF-0101"]')
        ?.getBoundingClientRect();
      return {
        scrollTop: root.scrollTop,
        mountedCards: root.querySelectorAll('[data-testid="kanban-card"]')
          .length,
        targetTop: targetRect?.top ?? -1,
        targetBottom: targetRect?.bottom ?? -1,
        scrollTopEdge: rootRect.top,
        scrollBottomEdge: rootRect.bottom,
      };
    });
    expect(deepScrollMetrics.scrollTop).toBeGreaterThan(0);
    expect(deepScrollMetrics.mountedCards).toBeLessThanOrEqual(50);
    expect(deepScrollMetrics.targetTop).toBeGreaterThanOrEqual(
      deepScrollMetrics.scrollTopEdge,
    );
    expect(deepScrollMetrics.targetBottom).toBeLessThanOrEqual(
      deepScrollMetrics.scrollBottomEdge,
    );

    const targetViewportOffsetBeforeDetail = await target.evaluate((card) => {
      const scrollContainer = card.closest<HTMLElement>(
        '[data-testid="kanban-column-scroll-container"]',
      );
      if (!scrollContainer) throw new Error("missing Board scroll container");
      return Math.round(
        card.getBoundingClientRect().top -
          scrollContainer.getBoundingClientRect().top,
      );
    });
    await expect(target).not.toHaveAttribute("data-dragging", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.getByTestId("issue-close").click();
    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
    await expect(target).toBeFocused();
    await expect
      .poll(() =>
        target.evaluate((card, beforeOffset) => {
          const scrollContainer = card.closest<HTMLElement>(
            '[data-testid="kanban-column-scroll-container"]',
          );
          if (!scrollContainer) return Number.POSITIVE_INFINITY;
          return Math.abs(
            Math.round(
              card.getBoundingClientRect().top -
                scrollContainer.getBoundingClientRect().top,
            ) - beforeOffset,
          );
        }, targetViewportOffsetBeforeDetail),
      )
      .toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 640, height: 360 });
    const mobileMetrics = await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      return {
        clientHeight: root.clientHeight,
        scrollHeight: root.scrollHeight,
        mountedCards: root.querySelectorAll('[data-testid="kanban-card"]')
          .length,
      };
    });
    expect(mobileMetrics.clientHeight).toBeGreaterThan(0);
    expect(mobileMetrics.clientHeight).toBeLessThanOrEqual(360);
    expect(mobileMetrics.scrollHeight).toBeGreaterThan(
      mobileMetrics.clientHeight,
    );
    expect(mobileMetrics.mountedCards).toBeLessThanOrEqual(50);
    await scroll.scrollIntoViewIfNeeded();
    const boardBody = page.getByTestId("kanban-board-body");
    const boardBodyScrollTop = await boardBody.evaluate(
      (element) => element.scrollTop,
    );
    const mobileColumnScrollTopBeforeWheel = await scroll.evaluate(
      (element) => element.scrollTop,
    );
    const scrollBox = await scroll.boundingBox();
    if (!scrollBox) throw new Error("missing mobile Board column bounds");
    await page.mouse.move(
      scrollBox.x + scrollBox.width / 2,
      scrollBox.y + Math.min(8, scrollBox.height / 2),
    );
    await page.mouse.wheel(0, 800);
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(mobileColumnScrollTopBeforeWheel);
    await expect
      .poll(() => boardBody.evaluate((element) => element.scrollTop))
      .toBe(boardBodyScrollTop);
    const mobileColumnScrollTopAfterWheel = await scroll.evaluate(
      (element) => element.scrollTop,
    );

    const browserMetrics = await page.evaluate(() => {
      const runtimeWindow = window as Window & {
        __reefBoardVirtualizationMetrics?: {
          issueResponses: Array<{
            url: string;
            parseMs: number;
            parsedAt: number;
            issueCount: number | null;
            responseBytes: number;
          }>;
          firstCardDomAt: number | null;
          mountedCardsAtFirstDom: number;
        };
      };
      const measurement = runtimeWindow.__reefBoardVirtualizationMetrics;
      const response = measurement?.issueResponses.find(
        ({ url }) => new URL(url).searchParams.get("sort_field") === "reef_id",
      );
      const firstCardDomAt = measurement?.firstCardDomAt;
      return {
        parseMs: response?.parseMs ?? null,
        issueCount: response?.issueCount ?? null,
        responseBytes: response?.responseBytes ?? null,
        postParseToFirstCardDomMs:
          response && firstCardDomAt !== null && firstCardDomAt !== undefined
            ? firstCardDomAt - response.parsedAt
            : null,
        mountedCardsAtFirstDom: measurement?.mountedCardsAtFirstDom ?? null,
      };
    });
    const requestTiming = issueListResponse.request().timing();
    const report = {
      build: "candidate",
      fixture: "large_vault",
      query: "view=board&sort=reef_id&order=asc",
      cacheMode: "fresh browser context; persisted query cache removed",
      viewport: { width: 1440, height: 900 },
      mobileViewport: { width: 640, height: 360 },
      browserVersion: page.context().browser()?.version() ?? "unknown",
      totalIssues: browserMetrics.issueCount,
      requestDurationMs: requestTiming.responseEnd - requestTiming.requestStart,
      requestStartToFirstByteMs:
        requestTiming.responseStart - requestTiming.requestStart,
      responseBodyTransferMs:
        requestTiming.responseEnd - requestTiming.responseStart,
      ...browserMetrics,
      initialMountedCards: initialMetrics.mountedCards,
      mountedCardsAfterScroll,
      scrollRenderMs,
      dragStartMs,
      activeDragScrollMs,
      dragMode: "pointer",
      activeDragMountedCards: activeDragMetrics.mountedCards,
      activeDragScrollTop: activeDragMetrics.scrollTop,
      activeCardsAfterOffscreenScroll: activeDragMetrics.activeCards,
      viewportGeometry,
      keyboardTraversalMs,
      deepMountedCards: deepScrollMetrics.mountedCards,
      deepScrollTop: deepScrollMetrics.scrollTop,
      detailTargetViewportOffsetBeforeOpen: targetViewportOffsetBeforeDetail,
      initialClientHeight: initialMetrics.clientHeight,
      initialScrollHeight: initialMetrics.scrollHeight,
      mobileClientHeight: mobileMetrics.clientHeight,
      mobileScrollHeight: mobileMetrics.scrollHeight,
      mobileMountedCards: mobileMetrics.mountedCards,
      boardBodyScrollTopBeforeMobileWheel: boardBodyScrollTop,
      boardBodyScrollTopAfterMobileWheel: await boardBody.evaluate(
        (element) => element.scrollTop,
      ),
      mobileColumnScrollTopBeforeWheel,
      mobileColumnScrollTopAfterWheel,
    };
    expect(browserMetrics.parseMs).not.toBeNull();
    expect(browserMetrics.issueCount).toBe(1_205);
    expect(browserMetrics.responseBytes).toBeGreaterThan(0);
    expect(browserMetrics.postParseToFirstCardDomMs).not.toBeNull();
    expect(browserMetrics.mountedCardsAtFirstDom).not.toBeNull();
    expect(report.parseMs).toBeGreaterThanOrEqual(0);
    expect(report.postParseToFirstCardDomMs).toBeGreaterThanOrEqual(0);
    expect(report.mountedCardsAtFirstDom).toBeGreaterThan(0);
    expect(report.mountedCardsAtFirstDom).toBeLessThanOrEqual(50);
    expect(report.requestStartToFirstByteMs).toBeGreaterThanOrEqual(0);
    expect(report.responseBodyTransferMs).toBeGreaterThanOrEqual(0);
    expect(report.mountedCardsAfterScroll).toBeLessThanOrEqual(50);
    expect(report.activeDragMountedCards).toBeLessThanOrEqual(50);
    expect(report.keyboardTraversalMs).toBeGreaterThanOrEqual(0);
    expect(report.mobileClientHeight).toBeLessThanOrEqual(360);
    expect(report.boardBodyScrollTopAfterMobileWheel).toBe(
      report.boardBodyScrollTopBeforeMobileWheel,
    );
    console.log("BOARD_VIRTUALIZATION_LARGE", JSON.stringify(report));
    await testInfo.attach("board-virtualization-measurement", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  });

  test("restores the focused Board occurrence and pixel anchor after workspace navigation", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, LARGE_VAULT);
    await page.goto(
      `/workspace/${LARGE_VAULT}/issues?view=board&sort=reef_id&order=asc`,
    );

    const column = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    const scroll = column.getByTestId("kanban-column-scroll-container");
    const firstCard = column.locator(
      '[data-testid="kanban-card"][data-issue-id="REEF-0001"]',
    );
    const anchorCard = column.locator(
      '[data-testid="kanban-card"][data-issue-id="REEF-0101"]',
    );
    await expect(firstCard).toBeVisible();
    await firstCard.focus();
    for (let index = 0; index < 100; index += 1) {
      await page.keyboard.press("j");
    }
    await expect(anchorCard).toHaveAttribute("data-keyboard-focused", "true");
    await expect(anchorCard).toBeFocused();
    await scroll.evaluate(async (element) => {
      const root = element as HTMLElement;
      root.scrollTop = Math.max(0, root.scrollTop - 36);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });

    const before = await anchorCard.evaluate((element) => {
      const root = element.closest<HTMLElement>(
        '[data-testid="kanban-column-scroll-container"]',
      );
      if (!root) throw new Error("missing Board column scroll container");
      const rect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return {
        id: element.getAttribute("data-issue-id"),
        occurrenceKey: element.getAttribute("data-occurrence-key"),
        offset: Math.round(rect.top - rootRect.top),
        scrollTop: root.scrollTop,
        focused: document.activeElement === element,
      };
    });
    expect(before).toMatchObject({
      id: "REEF-0101",
      occurrenceKey: "todo:REEF-0101",
      focused: true,
    });
    expect(before.scrollTop).toBeGreaterThan(0);
    expect(before.offset).toBeGreaterThan(0);
    await page.getByTestId("sidebar-nav-settings").click();
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${LARGE_VAULT}/settings(?:/|$)`),
    );
    await page.getByTestId("sidebar-nav-issues").click();
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${LARGE_VAULT}/issues(?:\\?|$)`),
    );
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(anchorCard).toBeVisible({ timeout: 20_000 });
    await expect(anchorCard).toHaveAttribute("data-keyboard-focused", "true");
    await expect(anchorCard).toBeFocused();

    const after = await anchorCard.evaluate((element) => {
      const root = element.closest<HTMLElement>(
        '[data-testid="kanban-column-scroll-container"]',
      );
      if (!root) throw new Error("missing Board column scroll container");
      const rect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return {
        id: element.getAttribute("data-issue-id"),
        occurrenceKey: element.getAttribute("data-occurrence-key"),
        offset: Math.round(rect.top - rootRect.top),
        scrollTop: root.scrollTop,
        focused: document.activeElement === element,
      };
    });
    expect(after).toMatchObject({
      id: before.id,
      occurrenceKey: before.occurrenceKey,
      focused: true,
    });
    expect(after.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(2);
  });

  test("does not carry a same-ID Board anchor into another workspace", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await context.clearCookies();
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page, "reef-alpha");

    const boardUrl = (vault: string) => `/workspace/${vault}/issues?view=board`;
    await page.goto(boardUrl("reef-alpha"));
    const firstWorkspaceCard = page.locator(
      '[data-group-by="status"][data-group-value="todo"] [data-testid="kanban-card"][data-issue-id="REEF-001"]',
    );
    await expect(firstWorkspaceCard).toBeVisible();
    await firstWorkspaceCard.focus();
    await expect(firstWorkspaceCard).toHaveAttribute(
      "data-keyboard-focused",
      "true",
    );

    await page.getByTestId("sidebar-workspace-trigger").click();
    await page.getByTestId("workspace-switcher-option-reef-zeta").click();
    await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues(?:\?|$)/);
    const sameIdInOtherWorkspace = page.locator(
      '[data-group-by="status"][data-group-value="todo"] [data-testid="kanban-card"][data-issue-id="REEF-001"]',
    );
    await expect(sameIdInOtherWorkspace).toBeVisible();
    await expect(sameIdInOtherWorkspace).not.toHaveAttribute(
      "data-keyboard-focused",
      "true",
    );
    await expect(sameIdInOtherWorkspace).not.toBeFocused();

    await page.getByTestId("sidebar-workspace-trigger").click();
    await page.getByTestId("workspace-switcher-option-reef-alpha").click();
    await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues(?:\?|$)/);
    await expect(firstWorkspaceCard).toBeVisible();
    await expect(firstWorkspaceCard).toHaveAttribute(
      "data-keyboard-focused",
      "true",
    );
    await expect(firstWorkspaceCard).toBeFocused();
  });
});
