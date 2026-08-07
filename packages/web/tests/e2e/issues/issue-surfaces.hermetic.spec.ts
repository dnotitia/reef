import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  writeIndexedDbConfig,
} from "../harness/fixture";

function reefVault(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): Awaited<ReturnType<typeof readFixtureState>>["vaults"][number] {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

test.describe("Hermetic issue route surfaces", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("switches between board, list, timeline, and backlog views from /issues", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=board");
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="kanban-card"]').first(),
    ).toContainText("Initial issue Alpha");

    await page.locator('[data-testid="view-switcher-list"]').click();
    await page.waitForURL(/view=list/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    await page.locator('[data-testid="view-switcher-timeline"]').click();
    await page.waitForURL(/view=timeline/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="timeline-grid"]')).toBeVisible();

    await page.locator('[data-testid="view-switcher-backlog"]').click();
    await page.waitForURL(/view=backlog/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="backlog-table"]')).toBeVisible();
    await expect(page.getByText("Backlog issue Gamma")).toBeVisible();
  });

  test("keeps List and Backlog table geometry and controls aligned on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    const list = page.locator('[data-testid="issue-list-scroll-container"]');
    const defaultList = await list.evaluate((element) => {
      const root = element as HTMLElement;
      const header = root.querySelector('thead th[data-column-key="id"]');
      const row = root.querySelector(
        'tbody tr[data-testid="issue-list-row"] td[data-column-key="id"]',
      );
      return {
        headerHeight: header?.getBoundingClientRect().height ?? 0,
        rowHeight: row?.getBoundingClientRect().height ?? 0,
        columnKeys: Array.from(
          root.querySelectorAll("thead th[data-column-key]"),
        ).map((cell) => cell.getAttribute("data-column-key")),
        tableOverflow: root.scrollWidth > root.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(Math.round(defaultList.headerHeight)).toBe(32);
    expect(Math.round(defaultList.rowHeight)).toBe(40);
    expect(defaultList.columnKeys).toEqual([
      "select",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "due",
      "updated",
    ]);
    expect(defaultList.tableOverflow).toBe(false);
    expect(defaultList.documentOverflow).toBe(false);

    async function toggleListColumn(column: string) {
      await page.getByTestId("issue-list-columns-control").click();
      await page.getByTestId(`issue-list-column-${column}`).click();
    }

    for (const column of ["start", "sprint", "milestone", "release"]) {
      await toggleListColumn(column);
    }

    const expandedList = await list.evaluate((element) => {
      const root = element as HTMLElement;
      root.scrollLeft = root.scrollWidth;
      root.dispatchEvent(new Event("scroll"));
      const stickyKeys = ["select", "id", "type", "title"];
      return {
        tableOverflow: root.scrollWidth > root.clientWidth,
        stickyAlignment: stickyKeys.map((key) => {
          const header = root.querySelector(
            `thead th[data-column-key="${key}"]`,
          );
          const cell = root.querySelector(
            `tbody tr[data-testid="issue-list-row"] td[data-column-key="${key}"]`,
          );
          return {
            key,
            headerLeft: Math.round(header?.getBoundingClientRect().left ?? 0),
            cellLeft: Math.round(cell?.getBoundingClientRect().left ?? 0),
          };
        }),
      };
    });
    expect(expandedList.tableOverflow).toBe(true);
    for (const alignment of expandedList.stickyAlignment) {
      expect(alignment.cellLeft).toBe(alignment.headerLeft);
    }

    await page.getByTestId("view-switcher-backlog").click();
    await page.waitForURL(/view=backlog/, { timeout: 10_000 });
    await expect(page.getByTestId("backlog-table")).toBeVisible();
    await expect(page.getByTestId("backlog-rank-header")).toBeVisible();

    const backlog = page.getByTestId("backlog-table");
    const backlogGeometry = await backlog.evaluate((element) => {
      const root = element as HTMLElement;
      const header = root.querySelector('thead th[data-column-key="id"]');
      const row = root.querySelector(
        'tbody tr[data-testid="backlog-row"] td[data-column-key="id"]',
      );
      const status = root.querySelector(
        '[data-testid^="backlog-status-select-"]',
      );
      return {
        headerHeight: header?.getBoundingClientRect().height ?? 0,
        rowHeight: row?.getBoundingClientRect().height ?? 0,
        statusHeight: status?.getBoundingClientRect().height ?? 0,
        columnKeys: Array.from(
          root.querySelectorAll("thead th[data-column-key]"),
        ).map((cell) => cell.getAttribute("data-column-key")),
      };
    });
    expect(Math.round(backlogGeometry.headerHeight)).toBe(32);
    expect(Math.round(backlogGeometry.rowHeight)).toBe(40);
    expect(backlogGeometry.statusHeight).toBeLessThanOrEqual(32);
    expect(backlogGeometry.columnKeys).toEqual([
      "rank",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "updated",
    ]);

    const filterTops = await Promise.all(
      ["type-dropdown-trigger", "display-options-trigger"].map(async (id) =>
        page
          .getByTestId(id)
          .evaluate((element) => element.getBoundingClientRect().top),
      ),
    );
    expect(
      Math.max(...filterTops) - Math.min(...filterTops),
    ).toBeLessThanOrEqual(1);

    const grip = page.locator('[data-testid^="backlog-grip-"]').first();
    await expect(grip).toBeVisible();
    await expect(grip).toHaveAttribute(
      "title",
      "Drag to reorder in Rank order",
    );
    await grip.focus();
    expect(
      await grip.evaluate((element) => getComputedStyle(element).opacity),
    ).toBe("1");

    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-priority").click();
    await expect(page.getByTestId("backlog-rank-header")).toHaveAttribute(
      "title",
      "Switch to Rank order to reorder",
    );
    await expect(page.locator('[data-testid^="backlog-grip-"]')).toHaveCount(0);

    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-rank").click();
    await expect(
      page.locator('[data-testid^="backlog-grip-"]').first(),
    ).toBeVisible();

    await page.getByTestId("view-switcher-list").click();
    await page.waitForURL(/view=list/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();
    await expect(page.locator('thead th[data-column-key="start"]')).toHaveCount(
      0,
    );
  });

  test("renders the README demo board fixture across workflow columns", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await writeIndexedDbConfig(
      page,
      "last_visit_at",
      "2026-06-01T00:00:00.000Z",
    );

    await clearPersistedQueryCacheOnLoad(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="kanban-card"]')).toHaveCount(11);
    await expect(
      page.locator('[data-testid="suggestions-pending-badge"]'),
    ).toHaveText("3");
    await expect(
      page.getByText("Triage GitHub activity into draft issues"),
    ).toBeVisible();
    await expect(
      page.getByText("Review activity-scan status proposals"),
    ).toBeVisible();
    await expect(
      page.getByText("Ship stateless BFF route handlers"),
    ).toBeVisible();
  });

  test("opens an intercepted issue detail, autosaves a title edit, and returns to the list backdrop", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Initial issue Alpha").click();

    await page.waitForURL(/\/issues\/REEF-001\?view=list/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Initial issue Alpha",
    );

    await page
      .locator('[data-testid="issue-title-input"]')
      .fill("Initial issue Alpha edited");
    await page.locator('[data-testid="issue-title-input"]').press("Enter");

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issues.find((issue) => issue.id === "REEF-001")
          ?.title;
      })
      .toBe("Initial issue Alpha edited");

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues\?view=list$/, { timeout: 10_000 });
  });

  test("renders a cold issue deep link and closes it back to /issues", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues/REEF-002");

    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Initial issue Beta",
    );

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
  });

  test("creates an issue from the global dialog and deletes it from the detail actions menu", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    await page.locator('[data-testid="new-issue-trigger"]').click();
    await expect(
      page.locator('[data-testid="new-issue-dialog"]'),
    ).toBeVisible();
    await page
      .locator('[data-testid="new-issue-title-input"]')
      .fill("Created from hermetic E2E");
    await page.locator('[data-testid="new-issue-submit"]').click();

    await page.waitForURL(/\/issues\/REEF-004/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Created from hermetic E2E",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issue_ids;
      })
      .toContain("REEF-004");

    await page.locator('[data-testid="issue-more-trigger"]').click();
    await page.locator('[data-testid="issue-delete-trigger"]').click();
    await expect(
      page.locator('[data-testid="issue-delete-confirm"]'),
    ).toBeVisible();
    await page.locator('[data-testid="issue-delete-confirm-btn"]').click();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issue_ids;
      })
      .not.toContain("REEF-004");
  });

  test("creates a sub-issue from Sub-issues with inherited defaults and optimistic child list update", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    const before = reefVault(await readFixtureState(request));
    const parent = before.issues.find((issue) => issue.id === "REEF-001");
    if (!parent) throw new Error("Missing parent issue REEF-001");

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Initial issue Alpha").click();
    await page.waitForURL(/\/issues\/REEF-001\?view=list/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-children"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="issue-children-empty"]'),
    ).toContainText("No sub-issues yet.");

    await page.locator('[data-testid="add-sub-issue-trigger"]').click();
    const dialog = page.locator('[data-testid="new-issue-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("New sub-issue")).toBeVisible();
    await expect(
      dialog.locator('[data-testid="new-issue-parent-locked"]'),
    ).toContainText("REEF-001");
    await expect(
      dialog.locator('[data-testid="new-issue-priority-select"]'),
    ).toContainText("High");
    await expect(dialog.getByLabel("Sprint: Sprint Alpha")).toBeVisible();
    await expect(
      dialog.getByLabel("Milestone: Coverage Complete"),
    ).toBeVisible();

    await dialog
      .locator('[data-testid="new-issue-title-input"]')
      .fill("Child from sub-issue E2E");
    await dialog.locator('[data-testid="create-and-add-another"]').check();
    await dialog.locator('[data-testid="new-issue-submit"]').click();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issues.find(
          (issue) => issue.title === "Child from sub-issue E2E",
        );
      })
      .toMatchObject({
        id: "REEF-004",
        status: "todo",
        priority: parent.priority,
        parent_id: "REEF-001",
        sprint_id: parent.sprint_id,
        milestone_id: parent.milestone_id,
        labels: parent.labels,
      });

    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator('[data-testid="new-issue-title-input"]'),
    ).toHaveValue("");
    await expect(
      dialog.locator('[data-testid="new-issue-parent-locked"]'),
    ).toContainText("REEF-001");
    await expect(page).toHaveURL(
      /\/workspace\/reef-e2e\/issues\/REEF-001\?view=list$/,
    );

    await dialog.locator('[data-testid="new-issue-cancel"]').click();
    await page.locator('[data-testid="discard-draft-confirm-button"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-testid="issue-children"]')).toContainText(
      "Child from sub-issue E2E",
    );
    await expect(page.locator('[data-testid="issue-children"]')).toContainText(
      "0 of 1 done",
    );
  });

  test("copies the canonical issue deep link from the detail actions menu", async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openExistingWorkspace(page);

    // Open from the list so the address bar is the intercept route
    // (/issues/REEF-001?view=list), not this issue's own deep link — the copied
    // link must still be the clean canonical URL, not the address-bar value.
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Initial issue Alpha").click();
    await page.waitForURL(/\/issues\/REEF-001\?view=list/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    await page.locator('[data-testid="issue-more-trigger"]').click();
    await page.locator('[data-testid="issue-copy-link"]').click();

    // A success toast confirms the copy (locale-agnostic: assert the toast
    // surface, not its text).
    await expect(page.locator("[data-sonner-toast]")).toBeVisible();

    // The copied value is the clean canonical deep link — vault + id, with no
    // ?view=list riding along from the intercept URL in the address bar.
    const origin = new URL(page.url()).origin;
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`${origin}/workspace/reef-e2e/issues/REEF-001`);
  });
});
