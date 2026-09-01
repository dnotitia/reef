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

async function setReviewDate(
  page: Page,
  id: string,
  label: string,
  value: string,
): Promise<void> {
  await page.locator(`#${id}`).click();
  const input = page.getByRole("textbox", {
    name: `${label} (YYYY-MM-DD)`,
  });
  await input.fill(value);
  await input.press("Enter");
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

async function waitForReviewContent(page: Page): Promise<void> {
  return expect
    .poll(
      async () => {
        if (await page.getByTestId("issue-change-review-results").isVisible()) {
          return "results";
        }
        if (await page.getByTestId("issue-change-review-empty").isVisible()) {
          return "empty";
        }
        if (await page.getByTestId("issue-change-review-error").isVisible()) {
          return "error";
        }
        return "loading";
      },
      { timeout: 30_000 },
    )
    .toMatch(/^(?:empty|results)$/u);
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
    const archivedGroup = issueGroup(page, "Archived attachment review issue");
    await expect(archivedGroup).toBeVisible();
    await archivedGroup.getByTestId("issue-change-group-summary").click();
    const longHistory = issueGroup(page, "Long history review issue");
    await expect(longHistory).toContainText("105 changes");
    await longHistory.getByTestId("issue-change-group-summary").click();
    await expect(longHistory.getByTestId("issue-change-row")).toHaveCount(105);
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
    await firstGroup.getByTestId("issue-change-group-summary").click();
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
      .locator("li details")
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
      .locator("li details")
      .filter({ hasText: "Comment added" });
    await expect(commentDetails).toHaveCount(1);
    await commentDetails.locator("summary").click();
    await expect(commentDetails).toContainText(
      "A review comment with the complete text",
    );
    await expect(
      archivedGroup.getByText("Removed attachment old-evidence.txt"),
    ).toBeVisible();

    const firstGroupTimes = await firstGroup
      .locator("li time")
      .evaluateAll((nodes) =>
        nodes.map((node) => Date.parse(node.getAttribute("dateTime") ?? "")),
      );
    expect(firstGroupTimes).toEqual(
      [...firstGroupTimes].sort((left, right) => left - right),
    );
  });

  test("enters change review from Issues and returns to the Issues screen", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByTestId("issues-subnav-issue-list")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("button", { name: "Change review" }),
    ).toHaveCount(0);
    await page.getByTestId("issues-subnav-change-review").click();
    await page.waitForURL(/\/workspace\/reef-e2e\/issues\/changes(?:\?|$)/u, {
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("issues-subnav-change-review"),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Review period", exact: true }),
    ).toBeVisible();
    await waitForReviewContent(page);
    await expectNoIssueDetailInterception(page);

    await page.goBack();
    await page.waitForURL(/\/workspace\/reef-e2e\/issues$/u, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Issues", exact: true }),
    ).toBeVisible();
  });

  test("switches from change review to the Issues route through shared subnavigation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(await discoveredReviewStartPath(request));
    await waitForReviewContent(page);
    await expect(
      page.getByTestId("issues-subnav-change-review"),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("issue-filter-toolbar")).toHaveCount(0);
    await expect(page.getByTestId("view-switcher")).toHaveCount(0);
    await expect(page.getByTestId("scope-switcher")).toHaveCount(0);

    await page.getByTestId("issues-subnav-issue-list").click();
    await page.waitForURL(/\/workspace\/reef-e2e\/issues$/u, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("heading", { name: "Issues", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("issues-subnav-issue-list")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("issue-filter-toolbar")).toBeVisible();
    await expect(page.getByTestId("issue-change-review-results")).toHaveCount(
      0,
    );
  });

  test("keeps the change-review chrome usable at narrow widths", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(await discoveredReviewStartPath(request));
    await waitForReviewContent(page);

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole("heading", { name: "Review period", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByTestId("issue-change-review-actions"),
      ).toBeVisible();
      await expect(page.getByTestId("issues-subnav")).toBeVisible();
      await expect(page.getByTestId("issues-subnav-issue-list")).toBeVisible();
      await expect(
        page.getByTestId("issues-subnav-change-review"),
      ).toBeVisible();
      const viewportFits = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(viewportFits, `document overflows at ${width}px`).toBe(true);
      await expect(page.locator("main")).toHaveCount(1);
      if (width === 320) {
        const titleWidth = await issueGroup(
          page,
          "Completed and archived review issue",
        )
          .getByTestId("issue-change-group-title")
          .evaluate((element) => element.getBoundingClientRect().width);
        expect(
          titleWidth,
          "issue title must keep a readable line width",
        ).toBeGreaterThan(150);
      }
    }
  });

  test("recomputes and remembers relative ranges, then rejects an invalid shared URL", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(await discoveredReviewStartPath(request));
    await waitForReviewContent(page);
    await page.goto(
      "/workspace/reef-e2e/issues/changes?start_at=2026-06-15T00:00:00.000Z&end_at=2026-06-19T00:00:00.000Z&tz=UTC",
    );
    await waitForReviewContent(page);
    await page.getByTestId("issue-change-review-apply").click();
    const reappliedFixed = new URL(page.url()).searchParams;
    expect(reappliedFixed.get("start_at")).toBe("2026-06-15T00:00:00.000Z");
    expect(reappliedFixed.get("end_at")).toBe("2026-06-19T00:00:00.000Z");
    expect(reappliedFixed.get("tz")).toBe("UTC");
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
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/changes$/u);
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
    await waitForReviewContent(page);
    await expectNoIssueDetailInterception(page);

    const directRangeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/issues/changes" &&
        response.request().method() === "GET"
      );
    });
    await setReviewDate(
      page,
      "issue-change-review-start",
      "Start date",
      "2026-06-15",
    );
    await setReviewDate(
      page,
      "issue-change-review-end",
      "End date",
      "2026-06-19",
    );
    await page.getByTestId("issue-change-review-apply").click();
    await directRangeResponse;
    const localTimezone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
    expect(new URL(page.url()).searchParams.get("tz")).toBe(localTimezone);
    await waitForReviewContent(page);
    await expectNoIssueDetailInterception(page);

    const emptyRangeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/issues/changes" &&
        response.request().method() === "GET"
      );
    });
    await setReviewDate(
      page,
      "issue-change-review-start",
      "Start date",
      "2027-01-01",
    );
    await setReviewDate(
      page,
      "issue-change-review-end",
      "End date",
      "2027-01-02",
    );
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

    await page.getByTestId("issue-change-review-actions").click();
    await page.getByTestId("issue-change-review-copy-link").click();
    await expect(
      page.getByTestId("issue-change-review-copy-feedback"),
    ).toHaveText("Review link copied.");
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
    await page.evaluate(() => {
      // The app persists React Query results across reloads. Drop the cached
      // review response so this assertion exercises the forced upstream error.
      window.localStorage.removeItem("REACT_QUERY_OFFLINE_CACHE");
    });
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
    await group.getByTestId("issue-change-group-summary").click();
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
