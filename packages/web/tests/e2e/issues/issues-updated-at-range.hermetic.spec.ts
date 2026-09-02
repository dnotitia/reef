import { type Page, expect, test } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  resetFixture,
  readIndexedDbConfig,
} from "../harness/fixture";

const LIST_URL =
  "/workspace/reef-e2e/issues?view=list&group=none&columns=start&sort=updated_at&order=asc";

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
});
