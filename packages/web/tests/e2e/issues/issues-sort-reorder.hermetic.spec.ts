import {
  type Locator,
  type Page,
  type Request,
  expect,
  test,
} from "@playwright/test";
import {
  clearPersistedQueryCacheOnLoad,
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

/**
 * REEF-325: editing a non-membership field (title / labels / due date / …) must
 * refetch the `updated_at`-sorted list variants — the ones every edit reorders,
 * because the server restamps `updated_at` on every PATCH. The old
 * `useUpdateIssue` non-membership branch only refetched free-text (`q`) variants,
 * so those "Recently updated" caches drifted out of true server order until the
 * 60s stale window (a low-severity, self-healing staleness).
 *
 * The refetch is the isolable, guarded behavior. The list *view* also re-sorts
 * client-side (`IssueListTable` → `sortIssues`) over the in-place-patched cache,
 * so the visible row order corrects itself even without the refetch — which is
 * why this spec asserts the network refetch fires (the thing REEF-325 changes),
 * not just the final order. Without the fix the `updated_at`-sorted variant is
 * never re-requested and the count below never advances. The final-order check is
 * a secondary sanity assertion (server order and client sort agree).
 */
function countUpdatedAtListFetches(page: Page): () => number {
  let count = 0;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/issues" &&
      url.searchParams.get("sort_field") === "updated_at"
    ) {
      count += 1;
    }
  });
  return () => count;
}

async function dragIssueListGrip(
  page: Page,
  sourceId: string,
  targetId: string,
): Promise<void> {
  const source = page.getByTestId(`issue-list-grip-${sourceId}`);
  const target = page.getByTestId(`issue-list-grip-${targetId}`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox)
    throw new Error("missing issue list grip bounds");
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
}

async function issueListIds(page: Page): Promise<string[]> {
  return page
    .getByTestId("issue-list-row")
    .evaluateAll((rows) =>
      rows
        .map((row) => row.getAttribute("data-issue-id"))
        .filter((id): id is string => id !== null),
    );
}

async function dragBoardTarget(
  source: Locator,
  target: Locator,
  point: "card" | "body",
): Promise<void> {
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("missing Board drag target bounds");
  await source.dragTo(target, {
    targetPosition: {
      x: targetBox.width / 2,
      y:
        point === "card"
          ? targetBox.height / 2
          : Math.min(24, targetBox.height / 2),
    },
  });
}

async function boardIssueIds(column: Locator): Promise<string[]> {
  return column.locator('[data-testid="kanban-card"]').evaluateAll((cards) =>
    cards
      .map((card) => card.getAttribute("data-occurrence-key"))
      .filter((key): key is string => key !== null)
      .map((key) => key.slice(key.lastIndexOf(":") + 1)),
  );
}

function demoIssueState(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): Awaited<ReturnType<typeof readFixtureState>>["vaults"][number] {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error("demo fixture vault is missing");
  return vault;
}

test.describe("Hermetic issue-list sort re-order on edit (REEF-325/570)", () => {
  test.beforeEach(async ({ context, page, request }) => {
    await context.clearCookies();
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured");
  });

  test("a non-membership edit refetches the updated_at-sorted list and re-sorts it", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    const updatedAtFetches = countUpdatedAtListFetches(page);

    // Sort by "Recently updated" (updated_at desc). The configured fixture seeds
    // every row with the same updated_at, so the initial order falls to the
    // reef_id tiebreak (desc) — REEF-002 sits above REEF-001.
    await page.goto("/workspace/reef-e2e/issues?view=list&sort=updated_at");

    const rows = page.locator('[data-testid="issue-list-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    // The list loaded through an updated_at-sorted `/api/issues` request.
    await expect.poll(updatedAtFetches).toBeGreaterThan(0);

    // The row order as reef ids, read from the row's stable semantic id. The
    // leading cell is reserved for multi-selection and intentionally has no
    // display text.
    const orderedIds = (): Promise<string[]> =>
      rows.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-issue-id") ?? ""),
      );
    const indexOf = async (id: string): Promise<number> =>
      (await orderedIds()).indexOf(id);

    // Before the edit: REEF-001 sits below REEF-002 (updated_at tie → id desc).
    // The list can first paint from the default cache, then settle after the
    // updated_at request returns; poll the row order instead of sampling once.
    await expect
      .poll(async () => {
        const alpha = await indexOf("REEF-001");
        const beta = await indexOf("REEF-002");
        return alpha >= 0 && beta >= 0 && alpha > beta;
      })
      .toBe(true);

    // Open REEF-001 in the detail modal and rename it. The server restamps its
    // updated_at on the PATCH, and REEF-325 makes the edit refetch the
    // updated_at-sorted list that would otherwise drift stale.
    await rows
      .filter({ hasText: "REEF-001" })
      .first()
      .getByText("Initial issue Alpha", { exact: true })
      .click();
    const titleInput = page.locator('[data-testid="issue-title-input"]');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    await titleInput.fill("Initial issue Alpha (edited)");

    // Isolate the edit-driven refetch from the initial load / navigation.
    const beforeEdit = updatedAtFetches();
    await titleInput.press("Enter");

    // The REEF-325 fix: a non-membership edit refetches the updated_at-sorted
    // variant. This is the assertion the fix is required for.
    await expect
      .poll(updatedAtFetches, { timeout: 15_000 })
      .toBeGreaterThan(beforeEdit);

    // Sanity: the row is now first — the refreshed server order and the view's
    // client-side sort agree that the just-edited issue is most recent.
    await expect.poll(() => indexOf("REEF-001")).toBe(0);
  });

  test("shares Manual order between Board and List and gates reorder by mode", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=board`);
    await expect(page.getByTestId("kanban-board")).toBeVisible();
    await expect(page.getByTestId("sort-control-trigger")).toContainText(
      "Rank order",
    );

    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-priority").click();
    await expect(page.getByTestId("sort-control-trigger")).toContainText(
      "Priority",
    );

    await page.getByTestId("view-switcher-list").click();
    await page.waitForURL(/view=list/);
    await expect(page.getByTestId("issue-list-scroll-container")).toBeVisible();
    await expect(page.getByTestId("sort-control-trigger")).toContainText(
      "Priority",
    );
    await expect(page.locator('thead th[data-column-key="rank"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid^="issue-list-grip-"]')).toHaveCount(
      0,
    );

    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-rank").click();
    await expect(page.getByTestId("sort-control-trigger")).toContainText(
      "Rank order",
    );
    await expect(
      page.locator('thead th[data-column-key="rank"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="issue-list-grip-"]').first(),
    ).toBeVisible();

    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("group-by-assignee").click();
    await expect(page.getByTestId("issue-ordering-hint")).toContainText(
      "Switch to ungrouped Manual order",
    );
    await expect(page.locator('[data-testid^="issue-list-grip-"]')).toHaveCount(
      0,
    );

    await page.getByTestId("display-options-trigger").click();
    await page.getByTestId("group-by-none").click();
    await expect(page).toHaveURL(/group=none/);
    await expect(page.getByTestId("issue-ordering-hint")).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="issue-list-grip-"]').first(),
    ).toBeVisible();
  });

  test("persists a Manual Board same-group reorder through the canonical rank spine", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await context.clearCookies();
    await page.setViewportSize({ width: 2200, height: 1000 });
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?view=board&group=status`,
    );

    const todo = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    await expect(todo).toBeVisible();
    await expect
      .poll(() => boardIssueIds(todo))
      .toEqual(["REEF-103", "REEF-102", "REEF-101"]);

    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await dragBoardTarget(
      todo.getByTestId("kanban-card").filter({ hasText: "Review monitored" }),
      todo.getByTestId("kanban-card").filter({ hasText: "Polish onboarding" }),
      "card",
    );
    await expect((await responsePromise).ok()).toBeTruthy();
    await expect
      .poll(() => boardIssueIds(todo))
      .toEqual(["REEF-103", "REEF-101", "REEF-102"]);

    const persisted = demoIssueState(await readFixtureState(request));
    const todoState = persisted.issues
      .filter((issue) => issue.status === "todo")
      .sort(
        (left, right) =>
          (left.rank ?? Number.POSITIVE_INFINITY) -
            (right.rank ?? Number.POSITIVE_INFINITY) ||
          right.id.localeCompare(left.id, undefined, { numeric: true }),
      );
    expect(todoState.map((issue) => issue.id)).toEqual([
      "REEF-103",
      "REEF-101",
      "REEF-102",
    ]);

    await page.reload();
    await expect
      .poll(() => boardIssueIds(todo))
      .toEqual(["REEF-103", "REEF-101", "REEF-102"]);
  });

  test("commits a Manual Board cross-group body drop as one status+rank mutation", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await context.clearCookies();
    await page.setViewportSize({ width: 2200, height: 1000 });
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?view=board&group=status`,
    );

    const todo = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    const inProgress = page.locator(
      '[data-group-by="status"][data-group-value="in_progress"]',
    );
    await expect(todo).toBeVisible();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await dragBoardTarget(
      todo.getByTestId("kanban-card").filter({ hasText: "Add saved filters" }),
      inProgress,
      "body",
    );
    await expect((await responsePromise).ok()).toBeTruthy();
    await expect
      .poll(async () =>
        demoIssueState(await readFixtureState(request)).issues.find(
          (issue) => issue.id === "REEF-103",
        ),
      )
      .toMatchObject({ status: "in_progress" });
    const moved = demoIssueState(await readFixtureState(request)).issues.find(
      (issue) => issue.id === "REEF-103",
    );
    expect(moved).toMatchObject({ status: "in_progress" });
    await expect
      .poll(() => boardIssueIds(inProgress))
      .toEqual(["REEF-105", "REEF-104", "REEF-103"]);
    await page.reload();
    await expect(
      inProgress
        .getByTestId("kanban-card")
        .filter({ hasText: "Add saved filters" }),
    ).toBeVisible();
    await expect
      .poll(() => boardIssueIds(inProgress))
      .toEqual(["REEF-105", "REEF-104", "REEF-103"]);
  });

  test("commits a Manual Board cross-group card drop at the target rank", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await context.clearCookies();
    await page.setViewportSize({ width: 2200, height: 1000 });
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?view=board&group=status`,
    );

    const todo = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    const inProgress = page.locator(
      '[data-group-by="status"][data-group-value="in_progress"]',
    );
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await dragBoardTarget(
      todo.getByTestId("kanban-card").filter({ hasText: "Add saved filters" }),
      inProgress
        .getByTestId("kanban-card")
        .filter({ hasText: "Stream grounded" }),
      "card",
    );
    await expect((await responsePromise).ok()).toBeTruthy();
    await expect
      .poll(async () =>
        demoIssueState(await readFixtureState(request)).issues.find(
          (issue) => issue.id === "REEF-103",
        ),
      )
      .toMatchObject({ status: "in_progress" });
    await expect
      .poll(() => boardIssueIds(inProgress))
      .toEqual(["REEF-103", "REEF-105", "REEF-104"]);
    const movedCard = inProgress
      .getByTestId("kanban-card")
      .filter({ hasText: "Add saved filters" });
    await expect(movedCard).toHaveAttribute("data-keyboard-focused", "true");
    await expect(movedCard).toBeFocused();
  });

  test("refreshes stale Manual anchors and asks for a new drag after a conflict", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await context.clearCookies();
    await page.setViewportSize({ width: 2200, height: 1000 });
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?view=board&group=status`,
    );

    const todo = page.locator(
      '[data-group-by="status"][data-group-value="todo"]',
    );
    const inProgress = page.locator(
      '[data-group-by="status"][data-group-value="in_progress"]',
    );
    const movedCard = todo
      .getByTestId("kanban-card")
      .filter({ hasText: "Add saved filters" });
    await expect(movedCard).toBeVisible();

    // Change the row through the real Reef route without updating this page's
    // Query cache. The next drag therefore carries a stale updated_at snapshot
    // and exercises the canonical 409 recovery path.
    const externalStatus = await page.evaluate(
      async ({ id, vault }) => {
        const response = await fetch(`/api/issues/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vault,
            update: {
              issue_id: id,
              patch: { priority: "low" },
            },
          }),
        });
        return response.status;
      },
      { id: "REEF-103", vault: REEF_E2E_VAULT },
    );
    expect(externalStatus).toBe(200);

    const reorderResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await dragBoardTarget(movedCard, inProgress, "body");
    expect((await reorderResponse).status()).toBe(409);

    await expect(page.getByText("The issue order changed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect.poll(() => boardIssueIds(todo)).toContain("REEF-103");
  });

  test("keeps a newly created issue at the Manual-order tail after entering Todo", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByTestId("new-issue-title-input")
      .fill("New Manual tail issue");
    await dialog.getByTestId("new-issue-submit").click();

    await page.waitForURL(/\/issues\/REEF-113$/, { timeout: 10_000 });
    const issueId = "REEF-113";
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page.getByTestId("issue-status-select").click();
    await page.getByRole("option", { name: "Todo", exact: true }).click();
    await expect
      .poll(
        async () =>
          demoIssueState(await readFixtureState(request)).issues.find(
            (issue) => issue.id === issueId,
          )?.status,
      )
      .toBe("todo");
    await expect
      .poll(
        async () =>
          demoIssueState(await readFixtureState(request)).issues.find(
            (issue) => issue.id === issueId,
          )?.rank,
      )
      .toBeNull();

    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await expect(
      page.getByTestId("issue-list-row").filter({ hasText: issueId }),
    ).toBeVisible();
    await expect
      .poll(() => issueListIds(page).then((ids) => ids.at(-1)))
      .toBe(issueId);

    const initialIds = await issueListIds(page);
    const firstIssueId = initialIds[0];
    if (!firstIssueId || firstIssueId === issueId || initialIds.length < 2) {
      throw new Error("Manual list did not expose a ranked tail target");
    }
    const expectedIds = [firstIssueId, issueId, ...initialIds.slice(1, -1)];
    const grip = page.getByTestId(`issue-list-grip-${issueId}`);
    await grip.focus();
    await page.keyboard.press("Space");
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    const liveRegion = page.locator('[role="status"][aria-live="assertive"]');
    for (let attempt = 0; attempt < 32; attempt += 1) {
      if ((await liveRegion.textContent()) === `${issueId} is at position 2.`) {
        break;
      }
      await page.keyboard.press("ArrowUp");
      await page.evaluate(
        () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      );
    }
    await expect(liveRegion).toHaveText(`${issueId} is at position 2.`);
    const reorderResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await page.keyboard.press("Space");
    await expect((await reorderResponse).ok()).toBeTruthy();
    await expect.poll(() => issueListIds(page)).toEqual(expectedIds);

    await page.reload();
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible();
    await expect.poll(() => issueListIds(page)).toEqual(expectedIds);
  });

  test("persists Manual List reorder and exposes keyboard and screen-reader feedback", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await expect(page.getByTestId("issue-list-scroll-container")).toBeVisible();
    await expect(page.getByTestId("issue-list-grip-REEF-001")).toBeVisible();
    await expect(page.getByTestId("issue-list-grip-REEF-002")).toBeVisible();

    const pointerResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await dragIssueListGrip(page, "REEF-001", "REEF-002");
    await expect((await pointerResponse).ok()).toBeTruthy();
    await expect
      .poll(() => issueListIds(page))
      .toEqual(["REEF-001", "REEF-002"]);

    await page.reload();
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible();
    await expect
      .poll(() => issueListIds(page))
      .toEqual(["REEF-001", "REEF-002"]);
    const persisted = await readFixtureState(request);
    const persistedRows = persisted.vaults
      .find((vault) => vault.name === REEF_E2E_VAULT)
      ?.issues.filter(
        (issue) => issue.id === "REEF-001" || issue.id === "REEF-002",
      )
      .sort(
        (left, right) =>
          (left.rank ?? Number.POSITIVE_INFINITY) -
          (right.rank ?? Number.POSITIVE_INFINITY),
      );
    expect(persistedRows?.map((issue) => issue.id)).toEqual([
      "REEF-001",
      "REEF-002",
    ]);

    const liveRegion = page.locator('[role="status"][aria-live="assertive"]');
    const grip = page.getByTestId("issue-list-grip-REEF-001");
    await grip.focus();
    await page.keyboard.press("Space");
    await expect(liveRegion).toHaveText(
      /(?:Picked up REEF-001 for reordering\.|REEF-001 is at position 1\.)/,
    );
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
    await page.keyboard.press("ArrowDown");
    await expect(liveRegion).toHaveText("REEF-001 is at position 2.");
    const keyboardResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await page.keyboard.press("Space");
    await expect(liveRegion).toHaveText("REEF-001 moved to position 2.");
    await expect((await keyboardResponse).ok()).toBeTruthy();
    await expect
      .poll(() => issueListIds(page))
      .toEqual(["REEF-002", "REEF-001"]);
    await expect(grip).toBeFocused();
    await expect(page.locator('[data-testid="issue-detail"]')).toHaveCount(0);

    const cancelGrip = page.getByTestId("issue-list-grip-REEF-002");
    await cancelGrip.focus();
    await page.keyboard.press("Space");
    await expect(cancelGrip).toHaveAttribute("aria-pressed", "true");
    await expect(liveRegion).toHaveText("REEF-002 is at position 1.");
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
    await page.keyboard.press("Escape");
    await expect(cancelGrip).not.toHaveAttribute("aria-pressed", "true");
    await expect(liveRegion).toHaveText("Reordering REEF-002 cancelled.");
    await expect(cancelGrip).toBeFocused();
  });
});
