import { type Locator, expect, test } from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

const WORKSPACE = "/workspace/reef-e2e/issues";

async function dragCardToColumn(card: Locator, column: Locator): Promise<void> {
  const target = await column.boundingBox();
  if (!target) throw new Error("Drag target is not visible");
  await card.dragTo(column, {
    targetPosition: {
      x: target.width / 2,
      y: Math.min(target.height / 2, 160),
    },
  });
}

async function dragCardToColumnPoint(
  card: Locator,
  column: Locator,
  point: "center" | "header",
): Promise<void> {
  const target = await column.boundingBox();
  if (!target) throw new Error("Drag target is not visible");
  await card.dragTo(column, {
    targetPosition: {
      x: target.width / 2,
      y:
        point === "header"
          ? Math.min(24, target.height / 2)
          : Math.min(target.height / 2, 160),
    },
  });
}

test.describe("Hermetic issue grouping (REEF-341)", () => {
  test.beforeEach(async ({ context, page, request }) => {
    await context.clearCookies();
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured");
  });

  test("groups List by None and Label, keeps multi-label occurrences, collapse, and URL state", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`${WORKSPACE}?view=list`);
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("group-by-assignee").click();
    await page.waitForURL(/view=list&group=assignee|group=assignee&view=list/);
    await expect(
      page.locator(
        '[data-testid="issue-group-header"][data-group-id="assignee:none"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="issue-group-header"][data-group-id="assignee:alice"]',
      ),
    ).toBeVisible();

    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("group-by-label").click();
    await page.waitForURL(/group=label/);
    await expect(
      page.locator(
        '[data-testid="issue-group-header"][data-group-id="label:e2e"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="issue-group-header"][data-group-id="label:frontend"]',
      ),
    ).toBeVisible();
    await expect(
      page.locator('[data-occurrence-key="label:e2e:REEF-001"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-occurrence-key="label:frontend:REEF-001"]'),
    ).toHaveCount(1);

    const e2eHeader = page.locator(
      '[data-testid="issue-group-header"][data-group-id="label:e2e"]',
    );
    const e2eToggle = e2eHeader.getByRole("button");
    await expect(e2eToggle).toHaveAttribute("aria-expanded", "true");
    await e2eToggle.click();
    await expect(e2eToggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.locator('[data-occurrence-key="label:e2e:REEF-001"]'),
    ).toHaveCount(0);
    await expect(e2eHeader).toHaveAttribute("data-group-collapsed", "true");

    await page.reload();
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    await expect(page).toHaveURL(
      /view=list.*group=label|group=label.*view=list/,
    );
    await expect(
      page.locator('[data-occurrence-key="label:e2e:REEF-001"]'),
    ).toHaveCount(1);

    await page.getByTestId("view-switcher-board").click();
    await page.waitForURL(/view=board.*group=label|group=label.*view=board/);
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(
      page.locator('[data-group-by="label"] [aria-disabled="true"]').first(),
    ).toHaveAttribute("title", /Label groups are read-only/);
    await page.getByTestId("view-switcher-list").click();
    await page.waitForURL(/view=list.*group=label|group=label.*view=list/);
  });

  test("normalizes an invalid Board group to its view default", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`${WORKSPACE}?view=board&group=not-a-group`);
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(page).toHaveURL(
      /view=board&group=status|group=status&view=board/,
    );
    await expect(
      page.locator('[data-group-by="status"]').first(),
    ).toBeVisible();
  });

  test("groups Active Board and List by Epic with flat children, progress, and fallbacks", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "epic_grouping");
    await context.clearCookies();
    await openExistingWorkspace(page);

    await page.goto(`${WORKSPACE}?view=board&group=epic`);
    const foundationColumn = page.locator(
      '[data-group-by="epic"][data-group-value="REEF-100"]',
    );
    await expect(foundationColumn).toBeVisible();
    await expect(foundationColumn).toContainText("REEF-100");
    await expect(foundationColumn).toContainText("Platform foundation");
    await expect(foundationColumn).toContainText("In Progress");
    await expect(foundationColumn).toContainText("1 of 2 done or closed");
    await expect(
      foundationColumn.locator('[data-testid="kanban-card"]'),
    ).toHaveCount(2);
    await expect(
      foundationColumn.getByTestId("epic-group-read-only"),
    ).toContainText("Epic groups are read-only");
    await expect(
      foundationColumn.locator('[data-testid="kanban-card"]').first(),
    ).not.toHaveAttribute("aria-disabled");
    await expect(
      foundationColumn.locator('[data-testid="kanban-card"]').first(),
    ).not.toHaveAttribute("title", /Epic groups are read-only/);
    await expect(
      page.locator('[data-group-by="epic"][data-group-value="none"]'),
    ).toContainText("No epic");
    await expect(
      page.locator(
        '[data-group-by="epic"][data-group-value="unavailable-parent"]',
      ),
    ).toContainText("Unavailable parent");
    await expect(
      foundationColumn.locator('[data-testid="kanban-card"]').filter({
        hasText: "Platform foundation",
      }),
    ).toHaveCount(0);

    const childCard = foundationColumn
      .locator('[data-testid="kanban-card"]')
      .first();
    await childCard.click();
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    await page.goto(`${WORKSPACE}?view=board&group=epic`);
    const keyboardChildCard = foundationColumn
      .locator('[data-testid="kanban-card"]')
      .first();
    await keyboardChildCard.focus();
    await expect(keyboardChildCard).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    await page.goto(`${WORKSPACE}?view=board&group=epic`);
    const actionChildCard = foundationColumn
      .locator('[data-testid="kanban-card"]')
      .first();
    await actionChildCard.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await actionChildCard.focus();
    await page.keyboard.press("s");
    await expect(page.getByTestId("issue-quick-edit-status")).toBeVisible();
    await page.keyboard.press("Escape");

    await foundationColumn.getByTestId("open-epic-REEF-100").click();
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    await page.goto(`${WORKSPACE}?view=list&group=epic`);
    const listFoundationHeader = page.locator(
      '[data-testid="issue-group-header"][data-group-id="epic:REEF-100"]',
    );
    await expect(listFoundationHeader).toBeVisible();
    await expect(listFoundationHeader).toContainText("REEF-100");
    await expect(listFoundationHeader).toContainText("1 of 2 done or closed");
    await expect(
      page.locator('[data-occurrence-key="epic:REEF-100:REEF-001"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="issue-list-row"][data-issue-id="REEF-100"]'),
    ).toHaveCount(0);

    const listToggle = listFoundationHeader.getByRole("button").first();
    await expect(listToggle).toHaveAccessibleName(
      /Collapse Platform foundation/,
    );
    await listToggle.click();
    await expect(listToggle).toHaveAccessibleName(/Expand Platform foundation/);
    await expect(listToggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.locator('[data-occurrence-key="epic:REEF-100:REEF-001"]'),
    ).toHaveCount(0);

    await page.goto(`${WORKSPACE}?view=board&group=epic&type=epic`);
    await expect(
      page.locator('[data-group-by="epic"][data-group-value="REEF-100"]'),
    ).toContainText("0");
    await expect(
      page.locator('[data-group-by="epic"][data-group-value="REEF-101"]'),
    ).toContainText("0");
  });

  test("keeps grouped List child titles inside the internal scrollport at narrow widths", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "epic_grouping");
    await context.clearCookies();
    await openExistingWorkspace(page);

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${WORKSPACE}?view=list&group=epic`);

      const scrollport = page.getByTestId("issue-list-scroll-container");
      const childTitle = page.locator(
        '[data-testid="issue-list-row"][data-issue-id="REEF-001"] [data-column-key="title"] > span > span',
      );
      await expect(scrollport).toBeVisible();
      await expect(childTitle).toBeVisible();
      const geometry = await page.evaluate(() => {
        const scroll = document.querySelector<HTMLElement>(
          '[data-testid="issue-list-scroll-container"]',
        );
        const title = document.querySelector<HTMLElement>(
          '[data-testid="issue-list-row"][data-issue-id="REEF-001"] [data-column-key="title"] > span > span',
        );
        if (!scroll || !title) throw new Error("Missing narrow List geometry");
        const scrollRect = scroll.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          viewportWidth: window.innerWidth,
          scrollClientWidth: scroll.clientWidth,
          scrollWidth: scroll.scrollWidth,
          titleLeft: titleRect.left,
          titleRight: titleRect.right,
          titleWidth: titleRect.width,
          scrollLeft: scrollRect.left,
          scrollRight: scrollRect.right,
        };
      });

      expect(geometry.documentWidth).toBeLessThanOrEqual(
        geometry.viewportWidth,
      );
      expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.scrollWidth).toBeGreaterThan(geometry.scrollClientWidth);
      expect(geometry.titleLeft).toBeGreaterThanOrEqual(
        geometry.scrollLeft - 1,
      );
      expect(geometry.titleRight).toBeLessThanOrEqual(geometry.scrollRight + 1);
      expect(geometry.titleWidth).toBeGreaterThan(0);
    }
  });

  test("toggles grouped List headers with native Enter and Space activation", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`${WORKSPACE}?view=list&group=assignee`);

    const toggle = page
      .locator('[data-testid="issue-group-header"]')
      .first()
      .getByRole("button");
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toBeFocused();
  });

  test("moves a real pointer drag from priority High to Medium", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await context.clearCookies();
    await page.setViewportSize({ width: 1280, height: 720 });
    await openExistingWorkspace(page);

    await page.goto(`${WORKSPACE}?view=board&group=priority`);
    const priorityCard = page
      .getByTestId("kanban-card")
      .filter({ hasText: "Initial issue Alpha" });
    await dragCardToColumnPoint(
      priorityCard,
      page.locator('[data-group-by="priority"][data-group-value="medium"]'),
      "center",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === "reef-e2e")
          ?.issues.find((issue) => issue.id === "REEF-001")?.priority;
      })
      .toBe("medium");

    await page.reload();
    await expect(
      page
        .locator(
          '[data-group-by="priority"][data-group-value="medium"] [data-testid="kanban-card"]',
        )
        .filter({ hasText: "Initial issue Alpha" }),
    ).toBeVisible();
  });

  test("moves a real pointer drag from assignee Alice to None", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await context.clearCookies();
    await openExistingWorkspace(page);

    await page.goto(`${WORKSPACE}?view=board&group=assignee`);
    const assigneeCard = page
      .getByTestId("kanban-card")
      .filter({ hasText: "Initial issue Alpha" });
    await dragCardToColumnPoint(
      assigneeCard,
      page.locator('[data-group-by="assignee"][data-group-value="none"]'),
      "header",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === "reef-e2e")
          ?.issues.find((issue) => issue.id === "REEF-001")?.assigned_to;
      })
      .toBeNull();
    await page.reload();
    await expect(
      page
        .locator(
          '[data-group-by="assignee"][data-group-value="none"] [data-testid="kanban-card"]',
        )
        .filter({ hasText: "Initial issue Alpha" }),
    ).toBeVisible();
  });

  test("moves writable Board groups, requires a close reason, and leaves Label read-only", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await page.setViewportSize({ width: 2200, height: 1000 });
    await openExistingWorkspace(page);

    await page.goto(`${WORKSPACE}?view=board&group=priority`);
    await expect(
      page.locator('[data-testid="kanban-card"]').first(),
    ).toBeVisible();
    const priorityCard = page
      .getByTestId("kanban-card")
      .filter({ hasText: "Wire board filters into shareable URL state" });
    await dragCardToColumn(
      priorityCard,
      page.locator('[data-group-by="priority"][data-group-value="medium"]'),
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === "reef-e2e")
          ?.issues.find((issue) => issue.id === "REEF-104")?.priority;
      })
      .toBe("medium");

    await page.goto(`${WORKSPACE}?view=board&group=status`);
    await expect(
      page.locator('[data-testid="kanban-card"]').first(),
    ).toBeVisible();
    const todoCard = page
      .getByTestId("kanban-card")
      .filter({ hasText: "Review monitored-repo findings" });
    await dragCardToColumn(
      todoCard,
      page.locator('[data-group-by="status"][data-group-value="closed"]'),
    );
    await expect(page.getByTestId("close-issue-dialog")).toBeVisible();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === "reef-e2e")
          ?.issues.find((issue) => issue.id === "REEF-101")?.status;
      })
      .toBe("todo");
    await page.getByTestId("closed-reason-select").click();
    await page.getByRole("option", { name: /Won't fix/i }).click();
    await page.getByTestId("close-issue-confirm").click();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .find((vault) => vault.name === "reef-e2e")
          ?.issues.find((issue) => issue.id === "REEF-101")?.status;
      })
      .toBe("closed");

    await page.goto(`${WORKSPACE}?view=board&group=label`);
    await expect(
      page.locator('[data-testid="kanban-card"]').first(),
    ).toBeVisible();
    const labelCard = page.getByTestId("kanban-card").first();
    await expect(labelCard).toHaveAttribute("aria-disabled", "true");
    await expect(labelCard).toHaveAttribute(
      "title",
      /Label groups are read-only/,
    );
    await expect(
      page.locator('[data-group-by="label"] [role="tooltip"]').first(),
    ).toContainText("Label groups are read-only");
  });

  test("keeps Label Board cards tabbable and opens detail with Enter", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`${WORKSPACE}?view=board&group=label`);

    const labelCard = page.getByTestId("kanban-card").first();
    await expect(labelCard).toHaveAttribute("aria-disabled", "true");
    await expect(labelCard).toHaveAttribute("tabindex", "0");
    await labelCard.focus();
    await expect(labelCard).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
  });
});
