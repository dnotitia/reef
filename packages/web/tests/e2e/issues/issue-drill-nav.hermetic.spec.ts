import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

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
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Review monitored-repo findings").click();
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
      "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context",
    );
    await expect(page.locator(drillBack)).toHaveAttribute("data-back-to", ROOT);

    // Back again → A (REEF-101), back at depth 0 with no Back affordance.
    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${ROOT}`), { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Review monitored-repo findings",
    );
    await expect(page.locator(drillBack)).toHaveCount(0);
  });

  test("shows the full child title only when its title track overflows", async ({
    page,
  }) => {
    await openRootFromList(page);

    const longLink = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-102"]',
    );
    const shortLink = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-112"]',
    );
    const longTitle = longLink.locator(
      '[data-issue-option-slot="title"] > span',
    );
    const shortTitle = shortLink.locator(
      '[data-issue-option-slot="title"] > span',
    );
    const fullLongTitle =
      "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context";

    await expect(longLink).toBeVisible();
    await expect(shortLink).toBeVisible();

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          longTitle.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          shortTitle.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          ),
        )
        .toBe(false);

      await longLink.hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toHaveText(fullLongTitle);

      await longLink.focus();
      await expect(tooltip).toBeVisible();

      const listBox = await page
        .locator('[data-testid="issue-children"] ul')
        .boundingBox();
      const focusedLinkBox = await longLink.boundingBox();
      if (!listBox || !focusedLinkBox) {
        throw new Error(
          "Expected the child list and focused link to have bounds",
        );
      }
      expect(focusedLinkBox.x).toBeGreaterThanOrEqual(listBox.x + 2);
      expect(focusedLinkBox.x + focusedLinkBox.width).toBeLessThanOrEqual(
        listBox.x + listBox.width - 2,
      );
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);

      await shortLink.hover();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await shortLink.focus();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await shortLink.blur();

      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
    }
  });

  test("shows child assignees at narrow widths and refreshes after reassignment", async ({
    page,
    request,
  }) => {
    await openRootFromList(page);

    const assignedLink = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-102"]',
    );
    const unassignedLink = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-112"]',
    );
    await expect(
      page.getByTestId("issue-child-assignee-REEF-102"),
    ).toContainText("Alice Example");
    await expect(
      page.getByTestId("issue-child-assignee-REEF-112"),
    ).toContainText("Unassigned");
    await page.getByTestId("issue-child-assignee-REEF-102").hover();
    await expect(page.getByRole("tooltip")).toHaveText("Alice Example");

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await expect(
        page.getByTestId("issue-child-assignee-REEF-102"),
      ).toBeVisible();
      await expect(
        page.getByTestId("issue-child-assignee-REEF-112"),
      ).toBeVisible();
    }

    await assignedLink.click();
    await page.waitForURL(new RegExp(`/issues/${MID}`), { timeout: 10_000 });
    const assignee = page.getByTestId("assignee-combobox");
    await assignee.locator("button").first().click();
    await expect(
      assignee.getByRole("option", { name: "Bob Example" }),
    ).toBeVisible();
    await assignee.getByRole("option", { name: "Bob Example" }).click();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        const vault = state.vaults.find(
          (candidate) => candidate.name === "reef-e2e",
        );
        return vault?.issues.find((issue) => issue.id === MID)?.assigned_to;
      })
      .toBe("bob");

    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${ROOT}`), { timeout: 10_000 });
    await expect(
      page.getByTestId("issue-child-assignee-REEF-102"),
    ).toContainText("Bob Example");
    await expect(
      page.getByTestId("issue-child-assignee-REEF-112"),
    ).toContainText("Unassigned");
  });

  test("keeps assigned and unassigned assignee slots aligned at desktop and 390px", async ({
    page,
  }) => {
    await openRootFromList(page);

    const assignedSlot = page.getByTestId("issue-child-assignee-REEF-102");
    const unassignedSlot = page.getByTestId("issue-child-assignee-REEF-112");
    const assignedLink = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-102"]',
    );
    const unassignedLink = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-112"]',
    );

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(assignedSlot).toBeVisible();
      await expect(unassignedSlot).toBeVisible();

      const [assigneeTypography, titleTypography] = await Promise.all([
        assignedSlot.evaluate((element) => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, lineHeight: style.lineHeight };
        }),
        assignedLink
          .locator('[data-issue-option-slot="title"] > span')
          .evaluate((element) => {
            const style = getComputedStyle(element);
            return { fontSize: style.fontSize, lineHeight: style.lineHeight };
          }),
      ]);
      expect(assigneeTypography).toEqual(titleTypography);

      const [assignedBox, unassignedBox, assignedTitleBox, unassignedTitleBox] =
        await Promise.all([
          assignedSlot.boundingBox(),
          unassignedSlot.boundingBox(),
          assignedLink.boundingBox(),
          unassignedLink.boundingBox(),
        ]);
      expect(assignedBox).not.toBeNull();
      expect(unassignedBox).not.toBeNull();
      expect(assignedTitleBox).not.toBeNull();
      expect(unassignedTitleBox).not.toBeNull();

      expect(
        Math.abs((assignedBox?.x ?? 0) - (unassignedBox?.x ?? 0)),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs((assignedBox?.width ?? 0) - (unassignedBox?.width ?? 0)),
      ).toBeLessThanOrEqual(2);

      for (const [titleBox, assigneeBox] of [
        [assignedTitleBox, assignedBox],
        [unassignedTitleBox, unassignedBox],
      ] as const) {
        const overlaps =
          (titleBox?.x ?? 0) <
            (assigneeBox?.x ?? 0) + (assigneeBox?.width ?? 0) &&
          (assigneeBox?.x ?? 0) < (titleBox?.x ?? 0) + (titleBox?.width ?? 0) &&
          Math.abs((titleBox?.y ?? 0) - (assigneeBox?.y ?? 0)) <
            Math.max(titleBox?.height ?? 0, assigneeBox?.height ?? 0);
        expect(overlaps).toBe(false);
      }

      const rows = page.locator('[data-testid="issue-children"] li');
      for (let index = 0; index < (await rows.count()); index += 1) {
        const overflow = await rows
          .nth(index)
          .evaluate((element) => element.scrollWidth > element.clientWidth);
        expect(overflow).toBe(false);
      }
    }

    await expect(assignedLink).toHaveClass(/focus-visible:ring-2/);
    await expect(assignedSlot).toHaveClass(/focus-visible:ring-2/);
  });

  test("switches from assignee hover to the focused title tooltip", async ({
    page,
  }) => {
    await openRootFromList(page);

    const assignedLink = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-102"]',
    );
    const assignee = page.getByTestId("issue-child-assignee-REEF-102");
    const fullLongTitle =
      "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context";

    await assignee.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Alice Example");

    // Focus the hovered assignee and reverse-tab into the preceding title link
    // in the same row. This is a real keyboard transition while the pointer
    // remains over the assignee; the two tooltip states must be exclusive.
    await assignee.press("Shift+Tab");
    await expect(assignedLink).toBeFocused();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
    await expect(page.getByRole("tooltip")).toHaveText(fullLongTitle);
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

    const overflowingChild = page.locator(
      '[data-testid="issue-children"] a[data-issue-id="REEF-102"]',
    );
    await overflowingChild.hover();
    await overflowingChild.focus();
    await expect(page.getByRole("tooltip")).toContainText(
      "Polish onboarding for existing AKB workspaces",
    );

    // An open title tooltip consumes the first Escape without closing the
    // issue detail sheet.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/issues/${ROOT}`));

    await drillIntoChild(page, MID, ROOT);

    // Drilled in → Esc steps back to the root rather than closing.
    await page.keyboard.press("Escape");
    await page.waitForURL(new RegExp(`/issues/${ROOT}`), { timeout: 10_000 });
    await expect(page.locator(drillBack)).toHaveCount(0);
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);

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
    // breadcrumb is structure (this issue's parent). Back sits in the top chrome
    // row, above the header that holds the breadcrumb (REEF-284).
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

  test("drills through a relationship row in place, Back + Close share one chrome row (REEF-284)", async ({
    page,
  }) => {
    // REEF-105 depends on REEF-104 (fixture), so its Relationships "Depends on"
    // renders a navigable row — the relation-link kind REEF-284 folds into the
    // same in-place drill model as the breadcrumb and sub-issues.
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Stream grounded Ask AI answers from core").click();
    await page.waitForURL(/\/issues\/REEF-105/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator(drillBack)).toHaveCount(0);

    // Click the depends-on row → swap the panel to REEF-104 in place.
    await page.locator('a[data-issue-id="REEF-104"]').click();
    await page.waitForURL(/\/issues\/REEF-104(\?|$)/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Wire board filters into shareable URL state",
    );

    // Drilled in like any other hop: Back points to where we came from, and the
    // originating ?view= rides along so Close returns to the list, not the Board
    // default (REEF-222).
    await expect(page.locator(drillBack)).toHaveAttribute(
      "data-back-to",
      "REEF-105",
    );
    await expect(page).toHaveURL(/view=list/);

    // Back and Close occupy the single top chrome row, Back first (left).
    const back = page.locator(drillBack);
    await expect(back).toBeVisible();
    await expect(page.locator('[data-testid="issue-close"]')).toBeVisible();
    const sameRowBackFirst = await back.evaluate((el) => {
      const closeEl = document.querySelector('[data-testid="issue-close"]');
      const row = el.closest("div");
      return (
        !!closeEl &&
        !!row &&
        row.contains(closeEl) &&
        Boolean(
          el.compareDocumentPosition(closeEl) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
      );
    });
    expect(sameRowBackFirst).toBe(true);

    // Back returns to REEF-105 at depth 0.
    await back.click();
    await page.waitForURL(/\/issues\/REEF-105/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Stream grounded Ask AI answers from core",
    );
    await expect(page.locator(drillBack)).toHaveCount(0);
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
      .getByText(
        "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context",
      )
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
    await page.goto(`/workspace/reef-e2e/issues/${LEAF}`);
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator(breadcrumb)).toHaveAttribute(
      "data-issue-id",
      MID,
    );
    await expect(page.locator(drillBack)).toHaveCount(0);

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
  });

  async function openDeepLeafAndDrillToParent(
    page: import("@playwright/test").Page,
    { reload = false } = {},
  ) {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/reef-e2e/issues/${LEAF}`);
    if (reload) await page.reload();

    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(1);
    await expect(page.locator(breadcrumb)).toHaveAttribute(
      "data-issue-id",
      MID,
    );

    await page.locator(breadcrumb).click();
    await page.waitForURL(new RegExp(`/issues/${MID}`), { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Polish onboarding for existing AKB workspaces across migration, access, and workspace setup flows with inherited settings and preserved planning context",
    );
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(1);
  }

  test("deep-link child → parent → Close exits the session once", async ({
    page,
  }) => {
    await openDeepLeafAndDrillToParent(page);

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);
  });

  test("refreshed deep-link child → parent → Close keeps URL, title, and sheet aligned", async ({
    page,
  }) => {
    await openDeepLeafAndDrillToParent(page, { reload: true });

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);
  });

  test("deep-link child → parent → Back returns to the child without a duplicate sheet", async ({
    page,
  }) => {
    await openDeepLeafAndDrillToParent(page);

    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${LEAF}`), { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Add saved filters for stakeholder reports",
    );
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(1);

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(0);
  });

  test("deep-link child → parent → outside click closes the whole session", async ({
    page,
  }) => {
    await openDeepLeafAndDrillToParent(page);

    await page.locator('[data-slot="sheet-overlay"]').click({
      position: { x: 8, y: 8 },
    });
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(0);
  });
});
