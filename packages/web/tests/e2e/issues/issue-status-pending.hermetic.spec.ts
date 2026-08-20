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
  return page.locator(`[data-testid="issue-list-row"][data-issue-id="${id}"]`);
}

async function chooseStatus(
  page: Parameters<typeof openExistingWorkspace>[0],
  id: string,
  label: string,
) {
  await issueRow(page, id).getByTestId("issue-inline-edit-status").click();
  await page.getByRole("option", { name: label, exact: true }).click();
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

test.describe("Hermetic List status pending quick edit", () => {
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
    await expect(row.locator("[data-status-update-announcement]")).toHaveText(
      "Updating status…",
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
    await expect(first.locator("[data-status-update-announcement]")).toHaveText(
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
