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
    await page.goto("/issues/REEF-001");
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
      path: "test-results/reef-277-activity-timeline.png",
      fullPage: true,
    });
  });

  test("appends a fresh title_change event when the title is edited through the route", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/issues/REEF-001");
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
});
