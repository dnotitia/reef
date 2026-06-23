import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "./harness/fixture";

function reefVault(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): Awaited<ReturnType<typeof readFixtureState>>["vaults"][number] {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

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
    request,
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

    // The row write lands (the PATCH route ran updateIssue).
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issues.find((issue) => issue.id === "REEF-001")
          ?.title;
      })
      .toBe("Initial issue Alpha v2");

    // Reload so the activity query refetches; the producer's appended
    // title_change row now renders carrying the new title (end-to-end proof).
    await page.reload();
    await expect(
      page
        .locator('[data-testid="activity-event"]')
        .filter({ hasText: "Initial issue Alpha v2" }),
    ).toBeVisible();
  });
});
