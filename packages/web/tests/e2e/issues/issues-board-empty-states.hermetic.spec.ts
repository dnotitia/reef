import { type Page, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

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

test.describe("Hermetic board empty states", () => {
  test("distinguishes no-match from true empty and recovers with keyboard clear", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
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
    await expect(
      frame.getByRole("heading", { name: "No matching issues" }),
    ).toBeVisible();
    await expect(
      frame.getByText(
        "Try widening your filters or search to see more issues.",
      ),
    ).toBeVisible();
    await expect(frame.getByRole("button")).toHaveCount(0);
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
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.getByText("Initial issue Alpha")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("kanban-no-matches")).toHaveCount(0);
  });

  test("keeps the five columns and zero counts for a configured empty board", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");

    await expectEmptyColumns(page);
    await expect(page.getByTestId("kanban-no-matches")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Clear filters", exact: true }),
    ).toHaveCount(0);
  });
});
