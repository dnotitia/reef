import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

// The demo_board fixture wires a parent chain REEF-101 → REEF-102 → REEF-103
// (mock-server.mjs), so each issue exposes a sub-issue to drill *into* and a
// parent breadcrumb to drill *up* — the two relationship-link kinds REEF-270
// drives through the in-memory nav stack.
const ROOT = "REEF-101";
const MID = "REEF-102";
const LEAF = "REEF-103";

const drillBack = '[data-testid="issue-drill-back"]';
const breadcrumb = '[data-testid="issue-parent-breadcrumb"]';

test.describe("Hermetic issue drill navigation (REEF-270)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  async function openRootFromList(page: import("@playwright/test").Page) {
    await openExistingWorkspace(page);
    await page.goto("/issues?view=list");
    await page.getByText("Triage GitHub activity into draft issues").click();
    await page.waitForURL(new RegExp(`/issues/${ROOT}`), { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    // Entry point: no drill trail yet (depth 0), so no Back.
    await expect(page.locator(drillBack)).toHaveCount(0);
  }

  async function drillIntoChild(
    page: import("@playwright/test").Page,
    childId: string,
    expectBackTo: string,
  ) {
    await page
      .locator(`[data-testid="issue-children"] a[data-issue-id="${childId}"]`)
      .click();
    await page.waitForURL(new RegExp(`/issues/${childId}`), {
      timeout: 10_000,
    });
    await expect(page.locator(drillBack)).toHaveAttribute(
      "data-back-to",
      expectBackTo,
    );
  }

  test("drills A→B→C through sub-issues and Back unwinds one hop at a time (AC1/AC4)", async ({
    page,
  }) => {
    await openRootFromList(page);

    // A → B → C, each hop swapping the panel in place with a Back to the prior.
    await drillIntoChild(page, MID, ROOT);
    await drillIntoChild(page, LEAF, MID);

    // Back once → B (REEF-102), whose own Back now points at A again.
    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${MID}`), { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Polish onboarding for existing AKB workspaces",
    );
    await expect(page.locator(drillBack)).toHaveAttribute("data-back-to", ROOT);

    // Back again → A (REEF-101), back at depth 0 with no Back affordance.
    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${ROOT}`), { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Triage GitHub activity into draft issues",
    );
    await expect(page.locator(drillBack)).toHaveCount(0);
  });

  test("Close exits the whole trail to the list in one action (AC2)", async ({
    page,
  }) => {
    await openRootFromList(page);
    await drillIntoChild(page, MID, ROOT);
    await drillIntoChild(page, LEAF, MID);

    // From three levels deep, Close returns straight to the list — not one hop.
    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues\?view=list$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);
  });

  test("Esc means Back while drilled in, then Close once the trail is empty (AC3)", async ({
    page,
  }) => {
    await openRootFromList(page);
    await drillIntoChild(page, MID, ROOT);

    // Drilled in → Esc steps back to the root rather than closing.
    await page.keyboard.press("Escape");
    await page.waitForURL(new RegExp(`/issues/${ROOT}`), { timeout: 10_000 });
    await expect(page.locator(drillBack)).toHaveCount(0);
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    // No trail left → Esc closes to the list.
    await page.keyboard.press("Escape");
    await page.waitForURL(/\/issues\?view=list$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);
  });

  test("Back and the parent breadcrumb coexist as distinct affordances (AC5)", async ({
    page,
  }) => {
    await openRootFromList(page);
    await drillIntoChild(page, MID, ROOT);
    await drillIntoChild(page, LEAF, MID);

    // On the leaf both are present and point at the mid issue, but they are
    // different controls: Back is navigation (where you came from), the
    // breadcrumb is structure (this issue's parent). The Back strip sits above
    // the header that holds the breadcrumb.
    const back = page.locator(drillBack);
    const crumb = page.locator(breadcrumb);
    await expect(back).toHaveAttribute("data-back-to", MID);
    await expect(crumb).toHaveAttribute("data-issue-id", MID);

    const order = await back.evaluate(
      (el, sel) =>
        el.compareDocumentPosition(document.querySelector(sel) as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      breadcrumb,
    );
    expect(order).toBeTruthy(); // Back precedes the breadcrumb in the DOM.
  });

  test("reopening the drilled-in issue after a browser Back starts at depth 0", async ({
    page,
  }) => {
    // Drill A → B, then leave the modal with the browser Back button (not our
    // Close), which pops the flat history straight to the list without running
    // exit(). Reopening B fresh must not resurrect the stale Back.
    await openRootFromList(page);
    await drillIntoChild(page, MID, ROOT);

    await page.goBack();
    await page.waitForURL(/\/issues\?view=list$/, { timeout: 10_000 });

    await page
      .getByText("Polish onboarding for existing AKB workspaces")
      .click();
    await page.waitForURL(new RegExp(`/issues/${MID}`), { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator(drillBack)).toHaveCount(0);
  });

  test("a cold deep link starts at depth 0 — breadcrumb but no Back", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    // Land directly on the leaf: its parent breadcrumb still resolves, but there
    // is no drill trail, so Back is absent and Close exits to the list.
    await page.goto(`/issues/${LEAF}`);
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator(breadcrumb)).toHaveAttribute(
      "data-issue-id",
      MID,
    );
    await expect(page.locator(drillBack)).toHaveCount(0);

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
  });
});
