import { type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  removeFixtureIssue,
  resetFixture,
  setIssueUpdateFailure,
} from "../harness/fixture";

async function openList(page: Page) {
  await openExistingWorkspace(page);
  await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
  await expect(page.getByTestId("issue-list-row").first()).toBeVisible({
    timeout: 15_000,
  });
}

async function openBacklog(page: Page) {
  const backlogResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/issues" &&
        url.searchParams.get("status") === "backlog"
      );
    },
    { timeout: 15_000 },
  );
  await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=backlog`);
  await expect(page.getByTestId("backlog-row").first()).toBeVisible({
    timeout: 15_000,
  });
  await backlogResponse;
}

async function selectRow(page: Page, id: string, shift = false) {
  const row = page.getByTestId("issue-list-row").filter({ hasText: id });
  await row
    .getByRole("checkbox", { name: `Select ${id}` })
    .click({ modifiers: shift ? ["Shift"] : [] });
}

async function selectBacklogRow(page: Page, id: string, shift = false) {
  const row = page.getByTestId("backlog-row").filter({ hasText: id });
  await row
    .getByRole("checkbox", { name: `Select ${id}` })
    .click({ modifiers: shift ? ["Shift"] : [] });
}

async function chooseBulkStatus(page: Page, label: string) {
  await page.getByTestId("bulk-status").click();
  await page.getByRole("option", { name: label }).click();
}

async function backlogIds(page: Page) {
  return page
    .getByTestId("backlog-row")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-issue-id")),
    );
}

async function prepareConfiguredTwoRowBacklog(
  page: Page,
  request: Parameters<typeof resetFixture>[0],
) {
  await resetFixture(request, "configured");
  await openList(page);
  await selectRow(page, "REEF-002");
  await selectRow(page, "REEF-003");
  await chooseBulkStatus(page, "Backlog");
  await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);
  await expect
    .poll(async () => {
      const vault = reefVault(await readFixtureState(request));
      return vault.issues
        .filter((issue) => issue.id === "REEF-002" || issue.id === "REEF-003")
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((issue) => [issue.id, issue.status, issue.rank]);
    })
    .toEqual([
      ["REEF-002", "backlog", 2000],
      ["REEF-003", "backlog", 1000],
    ]);
  await openBacklog(page);
  await selectBacklogRow(page, "REEF-002");
  await selectBacklogRow(page, "REEF-003");
  await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
    "2 selected",
  );
  return page;
}

async function dragBacklogGrip(page: Page, sourceId: string, targetId: string) {
  const source = page.getByTestId(`backlog-grip-${sourceId}`);
  const target = page.getByTestId(`backlog-grip-${targetId}`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("missing backlog grip bounds");
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

function reefVault(state: Awaited<ReturnType<typeof readFixtureState>>) {
  const vault = state.vaults.find((item) => item.name === REEF_E2E_VAULT);
  if (!vault) throw new Error("missing reef-e2e vault");
  return vault;
}

test.describe("Hermetic issue multi-select and bulk edit", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("selects loaded rows and applies one sequential bulk action through Route Handlers", async ({
    page,
    request,
  }) => {
    await openList(page);
    const patchIds: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let listGets = 0;
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (req.method() === "PATCH" && url.pathname.startsWith("/api/issues/")) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        patchIds.push(url.pathname.split("/").at(-1) ?? "");
      }
      if (req.method() === "GET" && url.pathname === "/api/issues")
        listGets += 1;
    });
    page.on("response", (res) => {
      const url = new URL(res.url());
      if (
        res.request().method() === "PATCH" &&
        url.pathname.startsWith("/api/issues/")
      ) {
        inFlight -= 1;
      }
    });

    await selectRow(page, "REEF-101");
    await selectRow(page, "REEF-106", true);
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "3 selected",
    );
    await expect(page.getByTestId("bulk-sprint")).toBeVisible();
    await expect(page.getByTestId("bulk-add-labels")).toBeVisible();
    await expect(page.getByTestId("bulk-remove-labels")).toBeVisible();
    await expect(page.getByTestId("bulk-more")).toHaveCount(0);
    const getsBefore = listGets;
    await chooseBulkStatus(page, "In Review");
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    // REEF-106 is already In Review, so the sequential runner skips its PATCH.
    expect(patchIds).toEqual(["REEF-101", "REEF-108"]);
    expect(maxInFlight).toBe(1);
    expect(listGets - getsBefore).toBeLessThanOrEqual(1);
    const vault = reefVault(await readFixtureState(request));
    for (const id of patchIds) {
      expect(vault.issues.find((issue) => issue.id === id)?.status).toBe(
        "in_review",
      );
      expect(
        vault.activity.some(
          (event) =>
            event.reef_id === id &&
            event.event_type === "status_change" &&
            (event.payload as { to?: string }).to === "in_review",
        ),
      ).toBe(true);
    }
  });

  test("keeps Board free of selection and bulk-edit controls", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?view=board&status=todo&priority=high`,
    );
    const first = page
      .getByTestId("kanban-card")
      .filter({ hasText: "REEF-102" });
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(
      first.getByRole("checkbox", { name: "Select REEF-102" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);
    await expect(page.getByTestId("board-bulk-edit-shortcut")).toHaveCount(0);
  });

  test("supports Backlog bulk status changes without a Sprint control and keeps drag selection", async ({
    page,
    request,
  }) => {
    // Move one existing demo issue into Backlog through the user-facing bulk
    // action so the fixture supplies two independently ranked backlog rows.
    await openList(page);
    await selectRow(page, "REEF-101");
    await chooseBulkStatus(page, "Backlog");
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          reefVault(await readFixtureState(request)).issues.find(
            (issue) => issue.id === "REEF-101",
          )?.status,
      )
      .toBe("backlog");
    await openBacklog(page);
    await selectBacklogRow(page, "REEF-112");
    await selectBacklogRow(page, "REEF-101", true);
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "2 selected",
    );
    await expect(page.getByTestId("bulk-sprint")).toHaveCount(0);

    const before = await page
      .getByTestId("backlog-row")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-issue-id")),
      );
    expect(before).toEqual(["REEF-112", "REEF-101"]);

    const source = page.getByTestId("backlog-grip-REEF-101");
    const target = page.getByTestId("backlog-grip-REEF-112");
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox)
      throw new Error("missing backlog grip bounds");
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

    await expect
      .poll(() =>
        page
          .getByTestId("backlog-row")
          .evaluateAll((rows) =>
            rows.map((row) => row.getAttribute("data-issue-id")),
          ),
      )
      .toEqual(["REEF-101", "REEF-112"]);
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "2 selected",
    );
  });

  test("persists a pointer reorder after bulk-entering the configured backlog", async ({
    page,
    request,
  }) => {
    await prepareConfiguredTwoRowBacklog(page, request);
    const reorderResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    await dragBacklogGrip(page, "REEF-003", "REEF-002");
    await expect((await reorderResponse).ok()).toBeTruthy();

    await expect.poll(() => backlogIds(page)).toEqual(["REEF-002", "REEF-003"]);
    await page.reload();
    await expect(page.getByTestId("backlog-row").first()).toBeVisible();
    await expect.poll(() => backlogIds(page)).toEqual(["REEF-002", "REEF-003"]);
  });

  test("persists a keyboard reorder after bulk-entering the configured backlog", async ({
    page,
    request,
  }) => {
    await prepareConfiguredTwoRowBacklog(page, request);
    const reorderResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/reorder",
    );
    const grip = page.getByTestId("backlog-grip-REEF-003");
    const liveRegion = page.locator('[role="status"][aria-live="assertive"]');
    await expect(grip).toHaveAttribute("aria-label", "Reorder REEF-003");
    await grip.focus();
    await page.keyboard.press("Space");
    await expect(liveRegion).toHaveText(
      /(?:Picked up REEF-003 for reordering\.|REEF-003 is at position 1\.)/,
    );
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    // dnd-kit attaches the active keyboard listener on the next task after
    // activation. Let that task run before sending the first movement key.
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
    await page.keyboard.press("ArrowDown");
    await expect(liveRegion).toHaveText("REEF-003 is at position 2.");
    await page.keyboard.press("Space");
    await expect(liveRegion).toHaveText("REEF-003 moved to position 2.");
    await expect((await reorderResponse).ok()).toBeTruthy();

    await expect.poll(() => backlogIds(page)).toEqual(["REEF-002", "REEF-003"]);
    await page.reload();
    await expect(page.getByTestId("backlog-row").first()).toBeVisible();
    await expect.poll(() => backlogIds(page)).toEqual(["REEF-002", "REEF-003"]);
  });

  test("applies the typed label draft without requiring Enter", async ({
    page,
    request,
  }) => {
    await openList(page);
    await selectRow(page, "REEF-101");
    await page.getByTestId("bulk-add-labels").click();
    await page.getByTestId("bulk-add-labels-input").fill("frontend");
    await page.getByRole("button", { name: "Add labels" }).last().click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    const vault = reefVault(await readFixtureState(request));
    expect(
      vault.issues.find((issue) => issue.id === "REEF-101")?.labels,
    ).toContain("frontend");
  });

  test("preserves successes on a middle failure and retries only the failed item", async ({
    page,
    request,
  }) => {
    await setIssueUpdateFailure(request, "REEF-102", "once");
    await openList(page);
    await selectRow(page, "REEF-101");
    await selectRow(page, "REEF-102");
    await selectRow(page, "REEF-103");
    await chooseBulkStatus(page, "In Review");

    const tray = page.getByRole("button", { name: "1 failed" });
    await expect(tray).toBeVisible();
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "1 selected",
    );
    await expect(
      page.getByTestId("issue-list-row").filter({ hasText: "REEF-102" }),
    ).toHaveAttribute("aria-selected", "true");
    const beforeRetry = reefVault(await readFixtureState(request));
    expect(
      beforeRetry.issues.find((issue) => issue.id === "REEF-101")?.status,
    ).toBe("in_review");
    expect(
      beforeRetry.issues.find((issue) => issue.id === "REEF-102")?.status,
    ).toBe("todo");
    expect(
      beforeRetry.issues.find((issue) => issue.id === "REEF-103")?.status,
    ).toBe("in_review");
    await tray.click();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);
    await expect
      .poll(async () => {
        const vault = reefVault(await readFixtureState(request));
        return vault.issues.find((issue) => issue.id === "REEF-102")?.status;
      })
      .toBe("in_review");
  });

  test("uses one close reason, reports a stale id, and clears idle selection on view change", async ({
    page,
    request,
  }) => {
    await openList(page);
    await selectRow(page, "REEF-101");
    await selectRow(page, "REEF-102");
    await chooseBulkStatus(page, "Closed");
    await expect(page.getByTestId("close-issue-dialog")).toHaveCount(1);
    await page.getByTestId("close-issue-confirm").click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    const closed = reefVault(await readFixtureState(request));
    for (const id of ["REEF-101", "REEF-102"]) {
      expect(closed.issues.find((issue) => issue.id === id)?.status).toBe(
        "closed",
      );
    }

    await page.reload();
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible();
    await selectRow(page, "REEF-103");
    await selectRow(page, "REEF-104");
    await removeFixtureIssue(request, "REEF-103");
    await chooseBulkStatus(page, "Done");
    const staleTray = page.getByRole("button", { name: "1 failed" });
    await expect(staleTray).toBeVisible();
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "1 selected",
    );

    await staleTray.click();
    const failureList = page.getByRole("dialog", {
      name: "Failed issue updates",
    });
    await expect(failureList).toBeVisible();
    await expect(
      failureList.getByRole("button", { name: "Retry" }),
    ).toHaveCount(0);
    await failureList
      .getByRole("button", { name: "Remove from selection" })
      .click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    await selectRow(page, "REEF-104");
    await page.getByTestId("view-switcher-board").click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);
  });
});
