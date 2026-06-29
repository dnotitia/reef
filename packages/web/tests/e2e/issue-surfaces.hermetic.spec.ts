import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  writeIndexedDbConfig,
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
    await expect(page.locator('[data-testid="backlog-header"]')).toBeVisible();
    await expect(page.getByText("Backlog issue Gamma")).toBeVisible();
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

    // The Activity unread badge derives from `useUnreadInboxCount`, which runs
    // once when DashboardShell first mounts during onboarding — before this test
    // sets `last_visit_at` — and caches 0. That 0 is persisted to localStorage
    // and, with the hook's 5s staleTime, the reload below rehydrates it as still
    // fresh on a fast run, so no refetch fires and the badge never appears
    // (count 0 renders nothing). Drop the persisted snapshot at document-start so
    // the board entry fetches the unread count fresh against the now-set marker.
    await clearPersistedQueryCacheOnLoad(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="kanban-card"]')).toHaveCount(11);
    await expect(
      page.locator('[data-testid="activity-unread-badge"]'),
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
});
