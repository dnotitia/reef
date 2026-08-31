import {
  type APIRequestContext,
  type Locator,
  type Page,
  expect,
  test,
} from "@playwright/test";
import {
  E2E_MOCK_URL,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueListFailure,
} from "../harness/fixture";

async function discoveredReviewStartPath(
  request: APIRequestContext,
): Promise<string> {
  const response = await request.get(`${E2E_MOCK_URL}/__e2e/runtime`);
  expect(response.ok()).toBeTruthy();
  const contract = await response.json();
  const task = contract.tasks?.issue_change_review;
  if (typeof task?.start_path !== "string") {
    throw new Error(
      "Runtime discovery did not publish the issue change-review entrypoint",
    );
  }
  return task.start_path;
}

function issueGroup(page: Page, title: string): Locator {
  return page.getByTestId("issue-change-group").filter({ hasText: title });
}

async function expectNoIssueDetailInterception(page: Page): Promise<void> {
  // The parallel route can settle after the review request; observe the final
  // UI state so a delayed intercepted sheet cannot pass this assertion.
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="issue-detail-modal"]')).toHaveCount(
    0,
  );
  await expect(page.locator('[data-testid="issue-detail-error"]')).toHaveCount(
    0,
  );
}

test.describe("Hermetic issue change review", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "issue_change_review");
  });

  test("groups preserved changes, shows evidence, keeps lifecycle states, and retains 105 history entries", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(await discoveredReviewStartPath(request));

    const results = page.getByTestId("issue-change-review-results");
    await expect(results).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("issue-change-group")).toHaveCount(5, {
      timeout: 60_000,
    });

    await expect(
      issueGroup(page, "Completed and archived review issue"),
    ).toBeVisible();
    await expect(issueGroup(page, "Closed review issue")).toBeVisible();
    await expect(
      issueGroup(page, "Archived attachment review issue"),
    ).toBeVisible();
    const longHistory = issueGroup(page, "Long history review issue");
    await expect(longHistory).toContainText("105 changes");
    await expect(
      issueGroup(page, "Created during the review period"),
    ).toBeVisible();
    await expect(page.getByText("Only changed outside the period")).toHaveCount(
      0,
    );
    await expect(
      page.getByText("This comment is outside the selected period."),
    ).toHaveCount(0);

    const firstGroup = issueGroup(page, "Completed and archived review issue");
    await expect(firstGroup.getByText("Status", { exact: true })).toBeVisible();
    await expect(firstGroup.getByText("Title", { exact: true })).toBeVisible();
    await expect(firstGroup.getByText("Labels", { exact: true })).toBeVisible();
    await expect(
      firstGroup.getByText("Depends on", { exact: true }),
    ).toBeVisible();
    await expect(
      firstGroup.getByText("Attached review-notes.pdf"),
    ).toBeVisible();
    await expect(
      firstGroup.getByText("Removed attachment old-evidence.txt"),
    ).toHaveCount(0);

    const bodyDetails = firstGroup
      .locator("details")
      .filter({ hasText: "Body updated" });
    await expect(bodyDetails).toHaveCount(1);
    await expect(bodyDetails).toContainText("Body updated");
    await bodyDetails.locator("summary").click();
    await expect(bodyDetails.locator("pre")).toContainText(
      "Previous review body.",
    );
    await expect(bodyDetails.locator("pre")).toContainText(
      "Current review body.",
    );
    await expect(bodyDetails.locator("pre")).not.toContainText(
      "Previous review title",
    );

    const commentDetails = firstGroup
      .locator("details")
      .filter({ hasText: "Comment added" });
    await expect(commentDetails).toHaveCount(1);
    await commentDetails.locator("summary").click();
    await expect(commentDetails).toContainText(
      "A review comment with the complete text",
    );
    await expect(
      page.getByText("Removed attachment old-evidence.txt"),
    ).toBeVisible();

    const firstGroupTimes = await firstGroup
      .locator("time")
      .evaluateAll((nodes) =>
        nodes.map((node) => Date.parse(node.getAttribute("dateTime") ?? "")),
      );
    expect(firstGroupTimes).toEqual(
      [...firstGroupTimes].sort((left, right) => left - right),
    );
  });

  test("recomputes and remembers relative ranges, then rejects an invalid shared URL", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/changes");
    await expect(
      page.getByTestId("issue-change-review-relative-3"),
    ).toBeVisible();

    const relativeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (
        url.pathname === "/api/issues/changes" &&
        response.request().method() === "GET"
      ) {
        const start = Date.parse(url.searchParams.get("start_at") ?? "");
        const end = Date.parse(url.searchParams.get("end_at") ?? "");
        return end - start === 3 * 86_400_000;
      }
      return false;
    });
    await page.getByTestId("issue-change-review-relative-3").click();
    const firstRange = new URL((await relativeResponse).url()).searchParams;
    expect(
      Date.parse(firstRange.get("end_at") ?? "") -
        Date.parse(firstRange.get("start_at") ?? ""),
    ).toBe(3 * 86_400_000);
    expect(new URL(page.url()).search).toBe("");

    const reloadResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (
        url.pathname === "/api/issues/changes" &&
        response.request().method() === "GET"
      ) {
        const start = Date.parse(url.searchParams.get("start_at") ?? "");
        const end = Date.parse(url.searchParams.get("end_at") ?? "");
        return end - start === 3 * 86_400_000;
      }
      return false;
    });
    await page.reload();
    const secondRange = new URL((await reloadResponse).url()).searchParams;
    expect(
      Date.parse(secondRange.get("end_at") ?? "") -
        Date.parse(secondRange.get("start_at") ?? ""),
    ).toBe(3 * 86_400_000);
    expect(secondRange.get("end_at")).not.toBe(firstRange.get("end_at"));

    await page.goto(
      "/workspace/reef-e2e/issues/changes?start_at=2026-06-19T00:00:00.000Z&end_at=2026-06-19T00:00:00.000Z&tz=UTC",
    );
    await expect(page.locator('p[role="alert"]')).toHaveText(
      "Choose an end date on or after the start date.",
    );
    await expect(page.getByTestId("issue-change-review-loading")).toHaveCount(
      0,
    );
  });

  test("keeps relative and direct change-review ranges out of issue detail interception", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(await discoveredReviewStartPath(request));
    await expect(page.getByTestId("issue-change-review-results")).toBeVisible({
      timeout: 60_000,
    });

    const relativeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/issues/changes" &&
        response.request().method() === "GET"
      );
    });
    await page.getByTestId("issue-change-review-relative-3").click();
    await relativeResponse;
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/changes$/u);
    await expect(page.getByTestId("issue-change-review-results")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoIssueDetailInterception(page);

    const directRangeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/issues/changes" &&
        response.request().method() === "GET"
      );
    });
    await page.getByTestId("issue-change-review-start").fill("2026-06-15");
    await page.getByTestId("issue-change-review-end").fill("2026-06-19");
    await page.getByTestId("issue-change-review-apply").click();
    await directRangeResponse;
    await expect(page.getByTestId("issue-change-review-results")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoIssueDetailInterception(page);

    const emptyRangeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/issues/changes" &&
        response.request().method() === "GET"
      );
    });
    await page.getByTestId("issue-change-review-start").fill("2027-01-01");
    await page.getByTestId("issue-change-review-end").fill("2027-01-02");
    await page.getByTestId("issue-change-review-apply").click();
    await emptyRangeResponse;
    await expect(page.getByTestId("issue-change-review-empty")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoIssueDetailInterception(page);
  });

  test("copies fixed shared ranges and surfaces a review-query error distinctly from empty", async ({
    context,
    page,
    request,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openExistingWorkspace(page);
    const startPath = await discoveredReviewStartPath(request);
    await page.goto(startPath);
    await expect(page.getByTestId("issue-change-review-results")).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId("issue-change-review-share").click();
    await expect(page.getByText("Share link copied.")).toBeVisible();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    const sharedUrl = new URL(shared);
    expect(sharedUrl.pathname).toBe("/workspace/reef-e2e/issues/changes");
    expect(sharedUrl.searchParams.get("start_at")).toBe(
      "2026-06-15T00:00:00.000Z",
    );
    expect(sharedUrl.searchParams.get("end_at")).toBe(
      "2026-06-19T00:00:00.000Z",
    );
    expect(sharedUrl.searchParams.get("tz")).toBe("UTC");

    await setIssueListFailure(request, true);
    await page.reload();
    await expect(page.getByTestId("issue-change-review-error")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("issue-change-review-empty")).toHaveCount(0);
  });

  test("records a new comment in a current relative review window", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.getByLabel("Add a comment")).toBeVisible();
    await page.getByLabel("Add a comment").fill("New review-window comment");
    const commentResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/issues/REEF-001/comments" &&
        response.request().method() === "POST"
      );
    });
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    expect((await commentResponse).status()).toBe(201);
    await expect(page.getByText("New review-window comment")).toBeVisible();
    const fixtureState = await readFixtureState(request);
    const fixtureIssue = fixtureState.vaults
      .find((vault) => vault.name === "reef-e2e")
      ?.comments.find(
        (comment) => comment.body === "New review-window comment",
      );
    expect(fixtureIssue?.created_at).toEqual(expect.any(String));

    await page.goto("/workspace/reef-e2e/issues/changes");
    await expect(
      page.getByTestId("issue-change-review-relative-1"),
    ).toBeVisible();
    await page.getByTestId("issue-change-review-relative-1").click();
    const group = issueGroup(page, "Completed and archived review issue");
    const commentDetails = group
      .locator("details")
      .filter({ hasText: "Comment added" });
    await expect(commentDetails).toHaveCount(1);
    await commentDetails.locator("summary").click();
    await expect(
      commentDetails.getByText("New review-window comment", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
