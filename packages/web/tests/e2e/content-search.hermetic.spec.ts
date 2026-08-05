import { expect, test } from "@playwright/test";
import { runContentSearchBehavior } from "./behaviors/content-search.cjs";
import {
  openExistingWorkspace,
  resetFixture,
  setAkbAccountDenial,
  setContentSearchMode,
} from "./harness/fixture";

const inputSelector = '[data-testid="global-search-input"]';
const contentItemSelector = '[data-testid="global-search-content-item"]';

test.describe("Global body and comment search (REEF-347)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "content_search");
  });

  test("does not request content below two code points", async ({ page }) => {
    await openExistingWorkspace(page);
    const contentRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/issues/search-content") {
        contentRequests.push(request.url());
      }
    });

    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("한");
    await page.waitForTimeout(500);
    expect(contentRequests).toEqual([]);
    await expect(page.getByText("No matching issues.")).toBeVisible();
  });

  test("shows Korean field/content headings and inline body provenance", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", url: "http://localhost:7353" },
    ]);
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "이슈" }),
    ).toBeVisible();
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("Initial issue Alpha");
    await expect(page.getByText("이슈 필드 검색 결과")).toBeVisible();
    await page.locator(inputSelector).fill("한국어 본문 전용");

    const row = page.locator(contentItemSelector, {
      has: page.getByText("REEF-002", { exact: true }),
    });
    await expect(row).toBeVisible();
    await expect(page.getByText("이슈 콘텐츠 검색 결과")).toBeVisible();
    await expect(row.getByText("본문", { exact: true })).toBeVisible();
    await expect(row.locator("mark")).toHaveText("한국어 본문 전용");
    const source = row.getByTestId("global-search-content-source-body");
    const sourceStyle = await source.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderWidths: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
        borderRadius: style.borderRadius,
      };
    });
    expect(sourceStyle).toMatchObject({
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderWidths: ["0px", "0px", "0px", "0px"],
      borderRadius: "0px",
    });
    await expect(row.getByTestId("content-source-separator")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      await row.evaluate((rowElement) => {
        const sourceElement = rowElement.querySelector(
          '[data-testid^="global-search-content-source-"]',
        );
        const snippetElement = rowElement.querySelector(
          '[data-testid^="global-search-content-snippet-"]',
        );
        return Boolean(
          sourceElement &&
            snippetElement &&
            sourceElement.compareDocumentPosition(snippetElement) &
              Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    await expect(row.locator("a")).toHaveAccessibleName(
      /REEF-002.*Initial issue Beta.*본문.*한국어 본문 전용/,
    );
    const anchor = row.locator("a");
    await expect(anchor).toHaveAttribute(
      "href",
      "/workspace/reef-e2e/issues/REEF-002",
    );
    await anchor.click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/REEF-002/);
  });

  test("shows English field/content headings and inline comment provenance", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);
    await runContentSearchBehavior({ page, context, expect });
  });

  test("deduplicates metadata issues and preserves canonical exact-ID promotion", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("REEF-001");

    const metadata = page.locator('[data-testid="global-search-item"]');
    await expect(metadata.first()).toHaveAttribute("data-issue-id", "REEF-001");
    await expect(
      page.locator(`${contentItemSelector}[data-issue-id="REEF-001"]`),
    ).toHaveCount(0);
  });

  test("treats SQL and regex metacharacters as literal highlighted text", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("%_[\\");

    const row = page.locator(contentItemSelector, {
      has: page.getByText("REEF-003", { exact: true }),
    });
    await expect(row).toBeVisible();
    await expect(row.locator("mark")).toHaveText("%_[\\");
    await expect(row.locator("script")).toHaveCount(0);
  });

  test("guards rapid query changes and includes content in the teal busy state", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setContentSearchMode(request, "healthy", 700);
    await page.keyboard.press("Control+K");
    const input = page.locator(inputSelector);
    const firstRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/issues/search-content" &&
        url.searchParams.get("q") === "한국어 본문 전용"
      );
    });
    await input.fill("한국어 본문 전용");
    await firstRequest;
    await input.fill("comment-only lighthouse");

    await expect(page.getByTestId("search-progress-bar")).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    await expect(
      page.locator(`${contentItemSelector}[data-issue-id="REEF-002"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`${contentItemSelector}[data-issue-id="REEF-003"]`),
    ).toBeVisible();
  });

  test("expands 10 to 20 while retaining rows and stops when exhausted", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("bounded expansion phrase");
    await expect(page.locator(contentItemSelector)).toHaveCount(10);
    const more = page.getByTestId("global-search-content-more");
    await expect(more).toHaveText("Load more");

    await setContentSearchMode(request, "healthy", 700);
    await more.click();
    await expect(more).toBeDisabled();
    await expect(page.locator(contentItemSelector)).toHaveCount(10);
    await expect(page.locator(contentItemSelector)).toHaveCount(12);
    await expect(more).toHaveCount(0);
    await expect(page.getByText(/10\s*\/\s*12|10 of 12/i)).toHaveCount(0);
  });

  test("keeps long content rows contained and selected in light and narrow dark layouts", async ({
    page,
  }) => {
    const observeLayout = async () =>
      page.locator(contentItemSelector).evaluateAll((rows) =>
        rows.map((row) => {
          const anchor = row.querySelector("a");
          const source = row.querySelector(
            '[data-testid^="global-search-content-source-"]',
          );
          const snippet = row.querySelector(
            '[data-testid^="global-search-content-snippet-"]',
          );
          const dialog = row.closest('[role="dialog"]');
          if (!(anchor && source && snippet && dialog)) return null;
          const rowRect = row.getBoundingClientRect();
          const dialogRect = dialog.getBoundingClientRect();
          const sourceRect = source.getBoundingClientRect();
          const snippetRect = snippet.getBoundingClientRect();
          return {
            contained:
              rowRect.left >= dialogRect.left - 1 &&
              rowRect.right <= dialogRect.right + 1 &&
              sourceRect.left >= rowRect.left - 1 &&
              sourceRect.right <= rowRect.right + 1 &&
              snippetRect.left >= rowRect.left - 1 &&
              snippetRect.right <= rowRect.right + 1,
            noHorizontalOverflow:
              row.scrollWidth <= row.clientWidth + 1 &&
              anchor.scrollWidth <= anchor.clientWidth + 1,
          };
        }),
      );

    await page.setViewportSize({ width: 1280, height: 900 });
    await openExistingWorkspace(page);
    await page.keyboard.press("Control+K");
    const input = page.locator(inputSelector);
    await input.fill("bounded expansion phrase");
    await expect(page.locator(contentItemSelector)).toHaveCount(10);
    await expect(input).toBeFocused();
    await expect(page.locator(contentItemSelector).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await observeLayout()).toEqual(
      Array.from({ length: 10 }, () => ({
        contained: true,
        noHorizontalOverflow: true,
      })),
    );

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 760, height: 720 });
    await page.keyboard.press("Control+K");
    await page.getByTestId("command-mode-entry").click();
    await page
      .locator('[data-testid="command-page-entry"][data-command-page="theme"]')
      .click();
    await page
      .locator('[data-testid="command-action"][data-command-id="theme.dark"]')
      .click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("bounded expansion phrase");
    await expect(page.locator(contentItemSelector)).toHaveCount(10);
    await expect(page.locator(inputSelector)).toBeFocused();
    await expect(page.locator(contentItemSelector).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await observeLayout()).toEqual(
      Array.from({ length: 10 }, () => ({
        contained: true,
        noHorizontalOverflow: true,
      })),
    );
  });

  test("silently degrades to metadata-only and keeps body hits without comments", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setContentSearchMode(request, "degraded");
    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("Initial issue Alpha");
    await expect(
      page.locator(
        '[data-testid="global-search-item"][data-issue-id="REEF-001"]',
      ),
    ).toBeVisible();
    await expect(page.locator(contentItemSelector)).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await setContentSearchMode(request, "missing-comments");
    await page.keyboard.press("Control+K");
    await page.locator(inputSelector).fill("한국어 본문 전용");
    await expect(
      page.locator(`${contentItemSelector}[data-source="body"]`),
    ).toBeVisible();
    await expect(
      page.locator(`${contentItemSelector}[data-source="comment"]`),
    ).toHaveCount(0);

    await page.locator(inputSelector).fill("comment-only lighthouse");
    await expect(page.locator(contentItemSelector)).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });

  test("validates the real route and returns schema-conforming JSON", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const observations = await page.evaluate(async () => {
      const invalid = await fetch(
        "/api/issues/search-content?vault=reef-e2e&q=a&limit=10",
      );
      const valid = await fetch(
        "/api/issues/search-content?vault=reef-e2e&q=comment-only%20lighthouse&limit=10",
      );
      return {
        invalidStatus: invalid.status,
        validStatus: valid.status,
        validBody: await valid.json(),
      };
    });
    expect(observations.invalidStatus).toBe(400);
    expect(observations.validStatus).toBe(200);
    expect(observations.validBody).toEqual({
      results: [
        expect.objectContaining({
          reef_id: "REEF-003",
          source: "comment",
          score: null,
          match_id: expect.stringMatching(/^comment:/),
        }),
      ],
      has_more: false,
    });
  });

  test("exposes account denial through the real route and clears the session", async ({
    context,
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    const sessionCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__reef_session",
    );
    if (!sessionCookie) throw new Error("Expected an authenticated session");
    await setAkbAccountDenial(request, "membership_required");

    const response = await request.get(
      "/api/issues/search-content?vault=reef-e2e&q=comment-only%20lighthouse&limit=10",
      {
        headers: {
          cookie: `${sessionCookie.name}=${sessionCookie.value}`,
        },
      },
    );
    const observation = {
      status: response.status(),
      accountError: response.headers()["x-reef-account-error"],
      setCookie: response.headers()["set-cookie"],
    };

    expect(observation).toMatchObject({
      status: 403,
      accountError: "membership_required",
    });
    expect(observation.setCookie).toContain("__reef_session=");
    expect(observation.setCookie).toContain("Max-Age=0");
  });

  test("selects each issue's latest matching comment before applying the limit", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const response = await page.evaluate(async () => {
      const result = await fetch(
        "/api/issues/search-content?vault=reef-e2e&q=dedupe-before-limit&limit=10",
      );
      return { status: result.status, body: await result.json() };
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      results: [
        expect.objectContaining({
          reef_id: "REEF-003",
          source: "comment",
          snippet: "Dedupe-before-limit comment 10",
        }),
        expect.objectContaining({
          reef_id: "REEF-001",
          source: "comment",
          snippet: "Dedupe-before-limit other issue",
        }),
      ],
      has_more: false,
    });
  });
});
