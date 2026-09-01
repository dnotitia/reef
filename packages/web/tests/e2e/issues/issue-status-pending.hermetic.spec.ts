import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueUpdateControl,
} from "../harness/fixture";

function issueRow(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
) {
  return page.locator(
    `[data-testid="issue-list-row"][data-issue-id="${id}"], [data-testid="backlog-row"][data-issue-id="${id}"]`,
  );
}

function issueCard(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
) {
  return page.locator(`[data-testid="kanban-card"][data-issue-id="${id}"]`);
}

async function chooseStatus(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  await issueRow(page, id).getByTestId("issue-inline-edit-status").click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function choosePriority(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  await issueRow(page, id).getByTestId("issue-inline-edit-priority").click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function chooseAssignee(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  await issueRow(page, id).getByTestId("issue-inline-edit-assignee").click();
  await page.getByRole("option", { name: label }).click();
}

async function chooseBoardPriority(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  const card = issueCard(page, id);
  await card.focus();
  await page.keyboard.press("p");
  await expect(page.getByTestId("issue-quick-edit-priority")).toBeVisible();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function chooseBoardAssignee(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  const card = issueCard(page, id);
  await card.focus();
  await page.keyboard.press("a");
  await expect(page.getByTestId("assignee-combobox")).toBeVisible();
  await page.getByRole("option", { name: label }).click();
}

async function addListLabel(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  const row = issueRow(page, id);
  await row.focus();
  await page.keyboard.press("l");
  const input = page.getByTestId("issue-quick-edit-labels");
  await expect(input).toBeVisible();
  await input.fill(label);
  await input.press("Enter");
}

async function addBoardLabel(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  const card = issueCard(page, id);
  await card.focus();
  await page.keyboard.press("l");
  const input = page.getByTestId("issue-quick-edit-labels");
  await expect(input).toBeVisible();
  await input.fill(label);
  await input.press("Enter");
}

async function fixtureIssue(
  request: Parameters<typeof readFixtureState>[0],
  id: string,
) {
  const state = await readFixtureState(request);
  const issue = state.vaults
    .find((vault) => vault.name === REEF_E2E_VAULT)
    ?.issues.find((candidate) => candidate.id === id);
  if (!issue) throw new Error(`Missing fixture issue: ${id}`);
  return issue;
}

async function fixtureIssueStatus(
  request: Parameters<typeof readFixtureState>[0],
  id: string,
) {
  const state = await readFixtureState(request);
  return state.vaults
    .find((vault) => vault.name === REEF_E2E_VAULT)
    ?.issues.find((issue) => issue.id === id)?.status;
}

test.describe("Hermetic issue quick-edit save state", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "status_quick_edit");
  });

  test("shows one row pending, blocks duplicate activation, and settles a delayed success", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-001", delayMs: 800 },
    ]);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    const row = issueRow(page, "REEF-001");
    await expect(row).toBeVisible();
    let patchCount = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "PATCH" &&
        new URL(requestEvent.url()).pathname === "/api/issues/REEF-001"
      ) {
        patchCount += 1;
      }
    });

    await chooseStatus(page, "REEF-001", "In Progress");
    const trigger = row.getByTestId("issue-inline-edit-status");
    await expect(trigger).toContainText("In Progress");
    await expect(trigger).toHaveAttribute("aria-busy", "true");
    await expect(trigger).toBeDisabled();
    await expect(trigger).toHaveAccessibleName("Status");
    await expect(row.locator("[data-issue-update-announcement]")).toHaveText(
      "Updating Status…",
    );
    await expect.poll(() => patchCount).toBe(1);

    await expect
      .poll(
        async () =>
          (await readFixtureState(request)).issue_update_calls[
            `${REEF_E2E_VAULT}:REEF-001`
          ] ?? 0,
      )
      .toBe(1);
    await page.waitForTimeout(150);
    expect(patchCount).toBe(1);

    await expect(trigger).not.toHaveAttribute("aria-busy");
    await expect(trigger).toHaveAccessibleName("Status");
    expect(await fixtureIssueStatus(request, "REEF-001")).toBe("in_progress");
  });

  test("shows pending and success for List priority, assignee, and labels", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-001", delayMs: 700 },
      { issueId: "REEF-002", delayMs: 700 },
    ]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    const first = issueRow(page, "REEF-001");
    const second = issueRow(page, "REEF-002");
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    await choosePriority(page, "REEF-001", "Medium");
    const priorityTrigger = first.getByTestId("issue-inline-edit-priority");
    await expect(priorityTrigger).toContainText("Medium");
    await expect(priorityTrigger).toHaveAttribute("aria-busy", "true");
    await expect(priorityTrigger).toBeDisabled();
    await expect(first.locator("[data-issue-update-announcement]")).toHaveText(
      "Updating Priority…",
    );
    await expect(priorityTrigger).not.toHaveAttribute("aria-busy");
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-001")).priority)
      .toBe("medium");

    await addListLabel(page, "REEF-001", "quick-edit");
    const labelsInput = page.getByTestId("issue-quick-edit-labels");
    const labelsAnchor = page.getByTestId("issue-quick-edit-anchor");
    await expect(labelsInput).toBeDisabled();
    await expect(labelsAnchor).toHaveAttribute("aria-busy", "true");
    await expect(
      labelsAnchor.locator("[data-issue-update-announcement]"),
    ).toHaveText("Updating Labels…");
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-001")).labels)
      .toContain("quick-edit");
    await expect(labelsInput).not.toBeDisabled();
    await expect(labelsAnchor).not.toHaveAttribute("aria-busy");
    await expect(
      labelsAnchor.locator("[data-issue-update-announcement]"),
    ).toHaveText("Labels updated.");
    await page.keyboard.press("Escape");
    await expect(labelsAnchor).toHaveCount(0);

    await chooseAssignee(page, "REEF-002", "Bob Example");
    const assigneeTrigger = second.getByTestId("issue-inline-edit-assignee");
    await expect(assigneeTrigger).toContainText("Bob Example");
    await expect(assigneeTrigger).toHaveAttribute("aria-busy", "true");
    await expect(assigneeTrigger).toBeDisabled();
    await expect(second.locator("[data-issue-update-announcement]")).toHaveText(
      "Updating Assignee…",
    );
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-002")).assigned_to)
      .toBe("bob");
    await expect(assigneeTrigger).not.toHaveAttribute("aria-busy");
  });

  test("rolls back and retries a failed Backlog assignee quick edit", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-003", delayMs: 500 },
    ]);
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );

    const row = page.getByTestId("backlog-row").filter({ hasText: "REEF-003" });
    await expect(row).toBeVisible();

    await choosePriority(page, "REEF-003", "Medium");
    const priorityTrigger = row.getByTestId("issue-inline-edit-priority");
    await expect(priorityTrigger).toHaveAttribute("aria-busy", "true");
    await expect(priorityTrigger).toContainText("Medium");
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-003")).priority)
      .toBe("medium");
    await expect(priorityTrigger).not.toHaveAttribute("aria-busy");

    await setIssueUpdateControl(request, [
      { issueId: "REEF-003", delayMs: 500, failures: 1 },
    ]);
    await chooseAssignee(page, "REEF-003", "Bob Example");
    const assigneeTrigger = row.getByTestId("issue-inline-edit-assignee");
    await expect(assigneeTrigger).toHaveAttribute("aria-busy", "true");
    await expect(assigneeTrigger).toContainText("bob");
    await expect(assigneeTrigger).not.toHaveAttribute("aria-busy");
    await expect(assigneeTrigger).toContainText("—");
    await expect(row.locator("[data-issue-update-announcement]")).toHaveText(
      "Assignee update failed. Retry is available.",
    );
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-003")).assigned_to)
      .toBe(null);

    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(assigneeTrigger).toHaveAttribute("aria-busy", "true");
    await expect(assigneeTrigger).toContainText("bob");
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-003")).assigned_to)
      .toBe("bob");
    await expect(assigneeTrigger).not.toHaveAttribute("aria-busy");
  });

  test("keeps Board priority and assignee saves pending independently and flashes both cards", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-001", delayMs: 700 },
      { issueId: "REEF-002", delayMs: 700 },
    ]);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=board`);

    const first = issueCard(page, "REEF-001");
    const second = issueCard(page, "REEF-002");
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    await chooseBoardPriority(page, "REEF-001", "Medium");
    await chooseBoardAssignee(page, "REEF-002", "Bob Example");

    await expect(first).toHaveAttribute("aria-busy", "true");
    await expect(
      first.locator('[data-issue-update-field="priority"]'),
    ).toHaveAttribute("aria-busy", "true");
    await expect(first).toHaveText(/Updating Priority…/);
    await expect(second).toHaveAttribute("aria-busy", "true");
    await expect(
      second.locator('[data-issue-update-field="assigned_to"]'),
    ).toHaveAttribute("aria-busy", "true");
    await expect(second).toHaveText(/Updating Assignee…/);

    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-002")).assigned_to)
      .toBe("bob");
    await expect(first).not.toHaveAttribute("aria-busy");
    await expect(second).not.toHaveAttribute("aria-busy");
    await expect(first.locator("[data-issue-update-announcement]")).toHaveText(
      "Priority updated.",
    );
    await expect(second.locator("[data-issue-update-announcement]")).toHaveText(
      "Assignee updated.",
    );
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-001")).priority)
      .toBe("medium");

    await addBoardLabel(page, "REEF-001", "board-edit");
    const labelsInput = page.getByTestId("issue-quick-edit-labels");
    await expect(labelsInput).toBeDisabled();
    await expect(page.getByTestId("issue-quick-edit-anchor")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-001")).labels)
      .toContain("board-edit");
    await expect(labelsInput).not.toBeDisabled();
  });

  test("keeps concurrent rows independent through failure, rollback, and retry", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-001", delayMs: 600, failures: 1 },
      { issueId: "REEF-002", delayMs: 150 },
    ]);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    const first = issueRow(page, "REEF-001");
    const second = issueRow(page, "REEF-002");
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    let firstPatchCount = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "PATCH" &&
        new URL(requestEvent.url()).pathname === "/api/issues/REEF-001"
      ) {
        firstPatchCount += 1;
      }
    });

    await chooseStatus(page, "REEF-001", "In Progress");
    await chooseStatus(page, "REEF-002", "Done");

    const firstTrigger = first.getByTestId("issue-inline-edit-status");
    const secondTrigger = second.getByTestId("issue-inline-edit-status");
    await expect(firstTrigger).toHaveAttribute("aria-busy", "true");
    await expect(secondTrigger).toHaveAttribute("aria-busy", "true");
    await expect(firstTrigger).toContainText("In Progress");
    await expect(secondTrigger).toContainText("Done");

    await expect(secondTrigger).not.toHaveAttribute("aria-busy");
    await expect(firstTrigger).toHaveAttribute("aria-busy", "true");
    expect(await fixtureIssueStatus(request, "REEF-002")).toBe("done");

    await expect(firstTrigger).not.toHaveAttribute("aria-busy");
    await expect(firstTrigger).toContainText("Todo");
    await expect(firstTrigger).toHaveAccessibleName("Status");
    await expect(first.locator("[data-issue-update-announcement]")).toHaveText(
      "Status update failed. Retry is available.",
    );
    await expect(secondTrigger).toContainText("Done");
    expect(await fixtureIssueStatus(request, "REEF-001")).toBe("todo");
    await expect.poll(() => firstPatchCount).toBe(1);

    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(firstTrigger).toHaveAttribute("aria-busy", "true");
    await expect(firstTrigger).toContainText("In Progress");
    await expect.poll(() => firstPatchCount).toBe(2);
    await expect(firstTrigger).not.toHaveAttribute("aria-busy");
    await expect(firstTrigger).toContainText("In Progress");
    expect(await fixtureIssueStatus(request, "REEF-001")).toBe("in_progress");
    await expect(secondTrigger).toContainText("Done");
  });
});
