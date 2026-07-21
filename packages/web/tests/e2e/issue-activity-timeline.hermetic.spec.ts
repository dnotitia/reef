import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

// REEF-277: the issue activity timeline now records title / labels / due date /
// estimate / parent / relation / archive changes. These flows render the seeded
// events live through the real route + render path, and confirm a real field
// edit appends a fresh event end-to-end.
test.describe("Hermetic issue activity timeline (REEF-277)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("renders every REEF-277 field-change event in the timeline", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    // The seeded reef_activity rows render as their own one-line entries.
    const timeline = page.locator('[data-testid="activity-event"]');
    await expect(
      timeline.filter({ hasText: "changed the title" }),
    ).toBeVisible();
    await expect(
      timeline.filter({ hasText: "Initial issue Alpha (revised)" }),
    ).toBeVisible();
    await expect(timeline.filter({ hasText: "updated labels" })).toBeVisible();
    await expect(timeline.filter({ hasText: "backend" })).toBeVisible();
    await expect(timeline.filter({ hasText: "frontend" })).toBeVisible();
    await expect(
      timeline.filter({ hasText: "set the due date to" }),
    ).toBeVisible();
    await expect(timeline.filter({ hasText: "2026-07-15" })).toBeVisible();
    await expect(
      timeline.filter({ hasText: "set the estimate to" }),
    ).toBeVisible();
    await expect(
      timeline.filter({ hasText: "set the parent to" }),
    ).toBeVisible();
    await expect(timeline.filter({ hasText: "REEF-002" })).toBeVisible();
    await expect(timeline.filter({ hasText: "depends on" })).toBeVisible();
    await expect(timeline.filter({ hasText: "REEF-003" })).toBeVisible();
    await expect(
      timeline.filter({ hasText: "archived this issue" }),
    ).toBeVisible();
    await expect(
      timeline.filter({ hasText: "changed the issue type" }),
    ).toContainText("Story → Bug");
    await expect(
      timeline.filter({ hasText: "set the start date to" }),
    ).toContainText("2026-07-21");

    // A reef id is a code identifier — kept un-translated, unlike the prose.
    await expect(
      page.locator('[data-testid="activity-event"] [translate="no"]', {
        hasText: "REEF-002",
      }),
    ).toBeVisible();

    await page
      .locator('[data-testid="activity-event"]')
      .last()
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/reef-392-activity-timeline-en.png",
      fullPage: true,
    });

    await page.goto("/workspace/reef-e2e/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(
      page
        .locator('[data-testid="activity-event"]')
        .filter({ hasText: "이슈 유형을" }),
    ).toContainText("스토리에서 버그로");
    await expect(
      page
        .locator('[data-testid="activity-event"]')
        .filter({ hasText: "시작일을" }),
    ).toContainText("2026-07-21");
    await page.screenshot({
      path: "test-results/reef-392-activity-timeline-ko.png",
      fullPage: true,
    });
  });

  test("appends a fresh title_change event when the title is edited through the route", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Initial issue Alpha",
    );

    await page
      .locator('[data-testid="issue-title-input"]')
      .fill("Initial issue Alpha v2");
    await page.locator('[data-testid="issue-title-input"]').press("Enter");

    // The title edit appends a `title_change` row server-side (REEF-277), and
    // the update mutation invalidates the issue's activity query, so the unified
    // timeline refetches in place and renders the freshly logged event — the
    // immediate-update path status changes already use (REEF-064), now covering
    // the whole field-change set. No `page.reload()`: a full reload recompiles
    // the dev server and, under CI load, can outrun the assertion timeout while
    // the timeline is still cold-loading. The rendered event is the server's
    // persisted row fetched back through the real activity route, so this stays
    // an end-to-end proof of the append.
    await expect(
      page
        .locator('[data-testid="activity-event"]')
        .filter({ hasText: "Initial issue Alpha v2" }),
    ).toBeVisible();
  });

  test("persists root → reply → reply-to-reply as one-depth threads", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.getByLabel("Add a comment")).toBeVisible();

    await page.getByLabel("Add a comment").fill("REEF-065 root comment");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const thread = page
      .getByTestId("comment-thread")
      .filter({ hasText: "REEF-065 root comment" });
    await expect(thread).toBeVisible();

    await thread
      .getByRole("button", { name: "Reply", exact: true })
      .first()
      .click();
    await thread.getByLabel("Reply to alice").fill("REEF-065 first reply");
    await thread
      .getByLabel("Reply to alice")
      .locator("..")
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    const firstReply = thread
      .getByTestId("comment-reply")
      .filter({ hasText: "REEF-065 first reply" });
    await expect(firstReply).toBeVisible();

    await firstReply
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    await thread.getByLabel("Reply to alice").fill("REEF-065 second reply");
    await thread
      .getByLabel("Reply to alice")
      .locator("..")
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    await expect(
      thread
        .getByTestId("comment-reply")
        .filter({ hasText: "REEF-065 second reply" }),
    ).toBeVisible();
    await expect(thread.getByTestId("comment-reply")).toHaveCount(2);

    await page.reload();
    const persistedThread = page
      .getByTestId("comment-thread")
      .filter({ hasText: "REEF-065 root comment" });
    await expect(persistedThread.getByTestId("comment-reply")).toHaveCount(2);
    await expect(page.getByText(/Kicking this off/)).toBeVisible();
    await expect(page.getByTestId("activity-event").first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(persistedThread).toBeVisible();
    const shareOneDepth = await persistedThread
      .getByTestId("comment-reply")
      .evaluateAll(
        (rows) =>
          rows.length === 2 &&
          rows[0]?.parentElement === rows[1]?.parentElement,
      );
    expect(shareOneDepth).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const crossIssueStatus = await page.evaluate(async () => {
      const response = await fetch(
        "/api/issues/REEF-002/comments?vault=reef-e2e",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: "must not cross issues",
            parent_comment_id: "00000000-0000-4000-8000-000000000040",
          }),
        },
      );
      return response.status;
    });
    expect(crossIssueStatus).toBe(404);
  });
});
