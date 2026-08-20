import { type Locator, expect, test } from "../harness/test";
import {
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

const WORKSPACE = "/workspace/reef-e2e/issues";

async function dragCardToColumn(
  page: import("@playwright/test").Page,
  card: Locator,
  column: Locator,
): Promise<void> {
  const source = await card.boundingBox();
  const target = await column.boundingBox();
  if (!source || !target)
    throw new Error("Drag source or target is not visible");

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + Math.min(target.height / 2, 160),
    { steps: 12 },
  );
  await page.mouse.up();
}

async function dragCardToColumnPoint(
  page: import("@playwright/test").Page,
  card: Locator,
  column: Locator,
  point: "center" | "header",
): Promise<void> {
  const source = await card.boundingBox();
  const target = await column.boundingBox();
  if (!source || !target)
    throw new Error("Drag source or target is not visible");

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    point === "header"
      ? target.y + 24
      : target.y + Math.min(target.height / 2, 160),
    { steps: 12 },
  );
  await page.mouse.up();
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
      page,
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
      page,
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
      page,
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
      .filter({ hasText: "Triage GitHub activity into draft issues" });
    await dragCardToColumn(
      page,
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
