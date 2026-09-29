import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueReadControl,
  waitForIssueReadIdle,
  waitForIssueReadPending,
} from "../harness/fixture";

// The demo_board fixture wires a parent chain REEF-101 → REEF-102 → REEF-103
// (mock-server.mjs), so each issue exposes a sub-issue to drill *into* and a
// parent breadcrumb to drill *up* — the two relationship-link kinds REEF-270
// drives through the in-memory nav stack.
const ROOT = "REEF-101";
const MID = "REEF-102";
const LEAF = "REEF-103";
const SHORT_CHILD = "REEF-112";
const ROOT_TITLE = "Review monitored-repo findings";
const SHORT_CHILD_TITLE = "Mobile density";
const NEW_TAB_MODIFIER: "Control" | "Meta" =
  process.platform === "darwin" ? "Meta" : "Control";

const drillBack = '[data-testid="issue-drill-back"]';
const breadcrumb = '[data-testid="issue-parent-breadcrumb"]';

interface IssueDrillFrame {
  time: number;
  pathname: string;
  activePanels: Array<{
    instanceId: string;
    rect: { x: number; y: number; width: number; height: number };
  }>;
  activeDialogs: number;
  backCount: number;
  closeCount: number;
  titleValues: string[];
}

function startIssueDrillFrameRecorder(destinationId: string) {
  type RecorderWindow = Window & {
    __reef649RecordFrame?: (frame: IssueDrillFrame) => Promise<void>;
    __reef649MarkClick?: (
      time: number,
      defaultPrevented: boolean,
    ) => Promise<void>;
  };
  const recorderWindow = window as RecorderWindow;
  const documentId = String(performance.timeOrigin);
  const panelIds = new WeakMap<Element, string>();
  let nextPanelId = 1;

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`a[data-issue-id="${destinationId}"]`) === null)
        return;
      void recorderWindow.__reef649MarkClick?.(
        performance.timeOrigin + performance.now(),
        event.defaultPrevented,
      );
    },
    false,
  );

  const recordFrame = () => {
    if (sessionStorage.getItem("__reef649_issue_drill_trace") !== "recording") {
      return;
    }
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="sheet-content"]'),
    );
    const activePanels = panels.flatMap((panel) => {
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        panel.closest('[aria-hidden="true"]') === null;
      if (!visible) return [];
      let instanceId = panelIds.get(panel);
      if (instanceId === undefined) {
        instanceId = `${documentId}:${nextPanelId}`;
        nextPanelId += 1;
        panelIds.set(panel, instanceId);
      }
      return [
        {
          instanceId,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        },
      ];
    });
    const activeDialog = panels.find(
      (panel) =>
        panel.getAttribute("role") === "dialog" &&
        panel.closest('[aria-hidden="true"]') === null,
    );
    const frame: IssueDrillFrame = {
      time: performance.timeOrigin + performance.now(),
      pathname: location.pathname,
      activePanels,
      activeDialogs: activeDialog ? 1 : 0,
      backCount:
        activeDialog?.querySelectorAll('[data-testid="issue-drill-back"]')
          .length ?? 0,
      closeCount:
        activeDialog?.querySelectorAll('[data-testid="issue-close"]').length ??
        0,
      titleValues: Array.from(
        activeDialog?.querySelectorAll<HTMLInputElement>(
          '[data-testid="issue-title-input"]',
        ) ?? [],
      ).map((input) => input.value),
    };
    const recordFrameOnHost = recorderWindow.__reef649RecordFrame;
    if (!recordFrameOnHost) return;
    void recordFrameOnHost(frame).then(() => {
      requestAnimationFrame(recordFrame);
    });
  };

  requestAnimationFrame(recordFrame);
}

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

test.describe("Direct detail first relationship move", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  });

  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  async function openDirectRoot(
    page: import("@playwright/test").Page,
    beforeOpen?: () => Promise<void>,
  ): Promise<void> {
    await openExistingWorkspace(page);
    await beforeOpen?.();
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/workspace/reef-e2e/issues/${ROOT}?view=list`);
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      ROOT_TITLE,
    );
    await expect(
      page.locator(
        `[data-testid="issue-children"] a[data-issue-id="${SHORT_CHILD}"]`,
      ),
    ).toBeVisible();
  }

  async function captureFirstMove(
    page: import("@playwright/test").Page,
    request: import("@playwright/test").APIRequestContext,
    testInfo: import("@playwright/test").TestInfo,
    artifactPrefix: string,
    waitForDelayedRead: boolean,
  ): Promise<void> {
    const frames: IssueDrillFrame[] = [];
    let clickAt: number | null = null;
    let clickDefaultPrevented: boolean | null = null;
    await page.exposeFunction(
      "__reef649RecordFrame",
      (frame: IssueDrillFrame) => {
        frames.push(frame);
      },
    );
    await page.exposeFunction(
      "__reef649MarkClick",
      (time: number, defaultPrevented: boolean) => {
        clickAt ??= time;
        clickDefaultPrevented ??= defaultPrevented;
      },
    );
    await page.addInitScript(startIssueDrillFrameRecorder, SHORT_CHILD);
    await page.evaluate(() => {
      sessionStorage.setItem("__reef649_issue_drill_trace", "recording");
    });
    await page.evaluate(startIssueDrillFrameRecorder, SHORT_CHILD);

    const beforeClick = await page.screenshot();
    const beforePath = `${artifactPrefix}-click-before.png`;
    await writeFile(testInfo.outputPath(beforePath), beforeClick);
    await testInfo.attach(beforePath, {
      body: beforeClick,
      contentType: "image/png",
    });

    const clickStartedAt = Date.now();
    await page
      .locator(
        `[data-testid="issue-children"] a[data-issue-id="${SHORT_CHILD}"]`,
      )
      .click();
    await page.waitForURL(new RegExp(`/issues/${SHORT_CHILD}\\?view=list$`), {
      timeout: 10_000,
    });
    if (waitForDelayedRead) {
      await waitForIssueReadPending(request, SHORT_CHILD);
    }
    await page.waitForTimeout(250);
    const pendingFrames = frames.filter(
      (frame) => clickAt !== null && frame.time >= clickAt,
    );
    expect(pendingFrames.length).toBeGreaterThan(4);
    expect(
      pendingFrames.every(
        (frame) => frame.activePanels.length === 1 && frame.activeDialogs === 1,
      ),
    ).toBe(true);
    expect(
      pendingFrames.every(
        (frame) => frame.backCount === 1 && frame.closeCount === 1,
      ),
    ).toBe(true);
    expect(
      pendingFrames.every((frame) =>
        frame.titleValues.every((value) => value !== ROOT_TITLE),
      ),
    ).toBe(true);

    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      SHORT_CHILD_TITLE,
      { timeout: 15_000 },
    );
    if (waitForDelayedRead) {
      await waitForIssueReadIdle(request, SHORT_CHILD);
      expect(Date.now() - clickStartedAt).toBeGreaterThan(800);
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    const destinationReady = await page.screenshot();
    const readyPath = `${artifactPrefix}-destination-ready.png`;
    await writeFile(testInfo.outputPath(readyPath), destinationReady);
    await testInfo.attach(readyPath, {
      body: destinationReady,
      contentType: "image/png",
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          sessionStorage.removeItem("__reef649_issue_drill_trace");
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const trace = {
      viewport: await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      })),
      clickAt,
      clickDefaultPrevented,
      elapsedMs: Date.now() - clickStartedAt,
      readyAt: Date.now(),
      frames,
    };
    const traceJson = JSON.stringify(trace, null, 2);
    const tracePath = `${artifactPrefix}-transition-frames.json`;
    await writeFile(testInfo.outputPath(tracePath), traceJson);
    await testInfo.attach(tracePath, {
      body: traceJson,
      contentType: "application/json",
    });

    expect(trace.viewport).toEqual({ width: 1440, height: 900 });
    expect(trace.clickAt).not.toBeNull();
    expect(trace.clickDefaultPrevented).toBe(true);
    const transitionFrames = trace.frames.filter(
      (frame) =>
        frame.time >= (trace.clickAt ?? 0) && frame.time <= trace.readyAt,
    );
    expect(transitionFrames.length).toBeGreaterThan(10);
    expect(
      transitionFrames.every(
        (frame) => frame.activePanels.length === 1 && frame.activeDialogs === 1,
      ),
    ).toBe(true);
    expect(
      transitionFrames.every(
        (frame) => frame.backCount === 1 && frame.closeCount === 1,
      ),
    ).toBe(true);
    expect(
      transitionFrames.every((frame) =>
        frame.titleValues.every((value) => value !== ROOT_TITLE),
      ),
    ).toBe(true);
    expect(
      new Set(
        transitionFrames.flatMap((frame) =>
          frame.activePanels.map((panel) => panel.instanceId),
        ),
      ).size,
    ).toBe(1);
    await expect(
      page.locator('[data-testid="issue-drill-back"]'),
    ).toHaveAttribute("data-back-to", ROOT);
  }

  test("keeps one 1440×900 sheet through the delayed first move in three fresh contexts", async ({
    browser,
    request,
  }, testInfo) => {
    for (const contextNumber of [1, 2, 3]) {
      const videoDirectory = testInfo.outputPath(
        `context-${contextNumber}-video`,
      );
      await mkdir(videoDirectory, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
        recordVideo: {
          dir: videoDirectory,
          size: { width: 1440, height: 900 },
        },
      });
      const page = await context.newPage();
      const video = page.video();
      try {
        await openDirectRoot(
          page,
          contextNumber === 1
            ? () =>
                setIssueReadControl(request, {
                  issueId: SHORT_CHILD,
                  delayMs: 1_200,
                })
            : undefined,
        );
        await captureFirstMove(
          page,
          request,
          testInfo,
          `context-${contextNumber}`,
          contextNumber === 1,
        );
        if (contextNumber === 1) {
          const state = await readFixtureState(request);
          expect(state.calls).toContainEqual(
            expect.objectContaining({
              method: "GET",
              path: `/akb/api/v1/documents/reef-e2e/issues/${SHORT_CHILD.toLowerCase()}.md`,
            }),
          );
          await setIssueReadControl(request, { issueId: SHORT_CHILD });
        }

        await page.locator(drillBack).click();
        await page.waitForURL(new RegExp(`/issues/${ROOT}\\?view=list$`));
        await page
          .locator(
            `[data-testid="issue-children"] a[data-issue-id="${SHORT_CHILD}"]`,
          )
          .click();
        await page.waitForURL(
          new RegExp(`/issues/${SHORT_CHILD}\\?view=list$`),
        );
        await expect(
          page.locator('[data-testid="issue-title-input"]'),
        ).toHaveValue(SHORT_CHILD_TITLE);
        await page.locator('[data-testid="issue-close"]').click();
        await page.waitForURL(/\/issues\?view=list$/);
      } finally {
        await context.close();
        const videoPath = video ? await video.path() : null;
        if (videoPath) {
          await copyFile(
            videoPath,
            testInfo.outputPath(`context-${contextNumber}.webm`),
          );
          await testInfo.attach(`context-${contextNumber}.webm`, {
            path: testInfo.outputPath(`context-${contextNumber}.webm`),
            contentType: "video/webm",
          });
        }
      }
    }
  });

  test("preserves Back, Escape, Close, the entry query, and new-tab relation clicks", async ({
    page,
    context,
  }) => {
    await openDirectRoot(page);

    const childLink = page.locator(
      `[data-testid="issue-children"] a[data-issue-id="${SHORT_CHILD}"]`,
    );
    const [modifierTab] = await Promise.all([
      context.waitForEvent("page", { timeout: 10_000 }),
      childLink.click({ modifiers: [NEW_TAB_MODIFIER] }),
    ]);
    await modifierTab.waitForURL(
      new RegExp(`/issues/${SHORT_CHILD}\\?view=list$`),
    );
    await expect(
      modifierTab.locator('[data-testid="issue-title-input"]'),
    ).toHaveValue(SHORT_CHILD_TITLE);
    await expect(modifierTab.locator(drillBack)).toHaveCount(0);
    await modifierTab.close();
    await expect(page).toHaveURL(new RegExp(`/issues/${ROOT}\\?view=list$`));

    const [middleTab] = await Promise.all([
      context.waitForEvent("page"),
      childLink.click({ button: "middle" }),
    ]);
    await middleTab.waitForURL(
      new RegExp(`/issues/${SHORT_CHILD}\\?view=list$`),
    );
    await expect(
      middleTab.locator('[data-testid="issue-title-input"]'),
    ).toHaveValue(SHORT_CHILD_TITLE);
    await middleTab.close();

    await page
      .locator(`[data-testid="issue-children"] a[data-issue-id="${MID}"]`)
      .click();
    await page.waitForURL(new RegExp(`/issues/${MID}\\?view=list$`));
    await expect(page.locator(drillBack)).toHaveAttribute("data-back-to", ROOT);
    await page
      .locator(`[data-testid="issue-children"] a[data-issue-id="${LEAF}"]`)
      .click();
    await page.waitForURL(new RegExp(`/issues/${LEAF}\\?view=list$`));
    await expect(page.locator(drillBack)).toHaveAttribute("data-back-to", MID);

    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${MID}\\?view=list$`));
    await expect(page.locator(drillBack)).toHaveAttribute("data-back-to", ROOT);
    await page.keyboard.press("Escape");
    await page.waitForURL(new RegExp(`/issues/${ROOT}\\?view=list$`));
    await expect(page.locator(drillBack)).toHaveCount(0);
    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues\?view=list$/);
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(0);
  });

  test("keeps autosaved edits isolated to the drilled issue", async ({
    page,
    request,
  }) => {
    await openDirectRoot(page);
    await page
      .locator(
        `[data-testid="issue-children"] a[data-issue-id="${SHORT_CHILD}"]`,
      )
      .click();
    await page.waitForURL(new RegExp(`/issues/${SHORT_CHILD}\\?view=list$`));
    const titleInput = page.locator('[data-testid="issue-title-input"]');
    await expect(titleInput).toHaveValue(SHORT_CHILD_TITLE);
    await titleInput.fill("Mobile density edited");
    await titleInput.press("Enter");
    await expect(page.getByTestId("issue-save-status")).toContainText("Saved", {
      timeout: 15_000,
    });
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === "reef-e2e")
          ?.issues.find((issue) => issue.id === SHORT_CHILD)?.title;
      })
      .toBe("Mobile density edited");

    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${ROOT}\\?view=list$`));
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      ROOT_TITLE,
    );
    const savedIssues = await readFixtureState(request);
    const fixtureVault = savedIssues.vaults.find(
      (vault) => vault.name === "reef-e2e",
    );
    expect(fixtureVault?.issues.find((issue) => issue.id === ROOT)?.title).toBe(
      ROOT_TITLE,
    );
    expect(
      fixtureVault?.issues.find((issue) => issue.id === SHORT_CHILD)?.title,
    ).toBe("Mobile density edited");

    await page
      .locator(
        `[data-testid="issue-children"] a[data-issue-id="${SHORT_CHILD}"]`,
      )
      .click();
    await page.waitForURL(new RegExp(`/issues/${SHORT_CHILD}\\?view=list$`));
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Mobile density edited",
    );
    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues\?view=list$/);
  });

  test("keeps wayfinding available when the destination issue read fails", async ({
    page,
    request,
  }) => {
    await openDirectRoot(page);
    await setIssueReadControl(request, {
      issueId: SHORT_CHILD,
      failureStatus: 404,
    });
    await page
      .locator(
        `[data-testid="issue-children"] a[data-issue-id="${SHORT_CHILD}"]`,
      )
      .click();
    await page.waitForURL(new RegExp(`/issues/${SHORT_CHILD}\\?view=list$`));
    await expect(
      page.locator('[data-testid="issue-detail-error"]'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(1);
    await expect(page.locator(drillBack)).toHaveAttribute("data-back-to", ROOT);
    await expect(page.locator('[data-testid="issue-close"]')).toBeVisible();

    await page.locator(drillBack).click();
    await page.waitForURL(new RegExp(`/issues/${ROOT}\\?view=list$`));
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      ROOT_TITLE,
    );
    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues\?view=list$/);
  });
});
