import { expect, test, type Page } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setAuthControl,
  setIssueUpdateControl,
} from "../harness/fixture";

function sprintByName(
  state: Awaited<ReturnType<typeof readFixtureState>>,
  name: string,
) {
  return state.vaults
    .find((vault) => vault.name === REEF_E2E_VAULT)
    ?.sprints.find((sprint) => sprint.name === name);
}

async function openPlanning(page: Page) {
  await openExistingWorkspace(page);
  await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);
  await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
}

test.describe("Hermetic sprint rollover workflow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "sprint_rollover");
  });

  test("closes into an existing planned target and preserves the issue matrix", async ({
    page,
    request,
  }) => {
    await openPlanning(page);
    await page
      .getByRole("button", {
        name: "Close Sprint 14 - Rollover fixture and roll over",
      })
      .click();

    const dialog = page.getByTestId("sprint-rollover-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Unfinished issues to move")).toBeVisible();
    await expect(dialog.getByRole("definition").first()).toHaveText("2");

    await dialog
      .getByRole("button", { name: "Use an existing planned sprint" })
      .click();
    const before = await readFixtureState(request);
    const target = sprintByName(before, "Sprint 15 - Rollover fixture");
    expect(target).toBeDefined();
    await dialog
      .getByTestId("sprint-rollover-existing-target")
      .selectOption(target?.id ?? "");
    await dialog.getByTestId("sprint-rollover-submit").click();
    await expect(dialog.getByTestId("sprint-rollover-complete")).toBeVisible();
    await expect(
      dialog.getByTestId("sprint-rollover-completed-count"),
    ).toHaveText("2 issues rolled over");
    await expect(
      dialog.getByTestId("sprint-rollover-completed-route"),
    ).toContainText("Sprint 14 - Rollover fixture");
    await expect(
      dialog.getByTestId("sprint-rollover-completed-route"),
    ).toContainText("Sprint 15 - Rollover fixture");
    await expect(dialog.getByText("Confirmed close date")).toBeVisible();
    await expect(dialog.getByText("2026-06-14")).toBeVisible();
    await expect(dialog.getByTestId("sprint-rollover-result")).toHaveCount(0);
    await expect(dialog.getByTestId("sprint-rollover-target-link")).toHaveText(
      "Sprint 15 - Rollover fixture",
    );
    await dialog.getByTestId("sprint-rollover-close").click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        const vault = state.vaults.find((item) => item.name === REEF_E2E_VAULT);
        const source = vault?.sprints.find((item) =>
          item.name.startsWith("Sprint 14"),
        );
        const next = vault?.sprints.find((item) =>
          item.name.startsWith("Sprint 15"),
        );
        const moved =
          vault?.issues.filter((item) => item.sprint_id === target?.id)
            .length ?? 0;
        return { source: source?.status, target: next?.status, moved };
      })
      .toEqual({ source: "closed", target: "active", moved: 2 });

    const after = await readFixtureState(request);
    const vault = after.vaults.find((item) => item.name === REEF_E2E_VAULT);
    const sourceId = vault?.sprints.find((item) =>
      item.name.startsWith("Sprint 14"),
    )?.id;
    const movedIds = new Set(
      vault?.issues
        .filter((item) => item.sprint_id === target?.id)
        .map((item) => item.id),
    );
    expect(movedIds).toEqual(new Set(["REEF-001", "REEF-002"]));
    expect(
      vault?.issues.find((item) => item.id === "REEF-003")?.sprint_id,
    ).toBe(sourceId);
    expect(
      vault?.activity.filter(
        (event) =>
          event.event_type === "planning_link" &&
          ["REEF-001", "REEF-002"].includes(event.reef_id),
      ),
    ).toHaveLength(2);
  });

  test("activates a new target with zero unfinished issues", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "sprint_rollover_empty");
    await openPlanning(page);
    await page
      .getByRole("button", {
        name: "Close Sprint 14 - Rollover fixture and roll over",
      })
      .click();
    const dialog = page.getByTestId("sprint-rollover-dialog");
    await expect(dialog.getByText("Unfinished issues to move")).toBeVisible();
    await expect(dialog.getByRole("definition").first()).toHaveText("0");
    await dialog
      .getByTestId("sprint-rollover-target-name")
      .fill("Fresh Sprint");
    await dialog.getByTestId("sprint-rollover-submit").click();
    await expect(dialog.getByTestId("sprint-rollover-complete")).toBeVisible();
    await expect(
      dialog.getByTestId("sprint-rollover-completed-count"),
    ).toHaveText("0 issues rolled over");
    await expect(dialog.getByTestId("sprint-rollover-result")).toHaveCount(0);
    await dialog.getByTestId("sprint-rollover-close").click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        const vault = state.vaults.find((item) => item.name === REEF_E2E_VAULT);
        return vault?.sprints.find((item) => item.name === "Fresh Sprint")
          ?.status;
      })
      .toBe("active");
    const state = await readFixtureState(request);
    const vault = state.vaults.find((item) => item.name === REEF_E2E_VAULT);
    expect(vault?.issues).toHaveLength(0);
  });

  test("opens the same confirmation flow from the sprint detail header", async ({
    page,
    request,
  }) => {
    const before = await readFixtureState(request);
    const source = sprintByName(before, "Sprint 14 - Rollover fixture");
    const target = sprintByName(before, "Sprint 15 - Rollover fixture");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/planning/sprints/${source?.id}`,
    );
    await expect(page.getByTestId("sprint-detail-header")).toBeVisible();
    await page.getByTestId("sprint-rollover-trigger").click();
    const dialog = page.getByTestId("sprint-rollover-dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Use an existing planned sprint" })
      .click();
    await dialog
      .getByTestId("sprint-rollover-existing-target")
      .selectOption(target?.id ?? "");
    await dialog.getByTestId("sprint-rollover-submit").click();
    await expect(dialog.getByTestId("sprint-rollover-complete")).toBeVisible();
    await expect(dialog.getByTestId("sprint-rollover-result")).toHaveCount(0);
    await dialog.getByTestId("sprint-rollover-close").click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await readFixtureState(request)).vaults
            .find((item) => item.name === REEF_E2E_VAULT)
            ?.sprints.find((item) => item.id === target?.id)?.status,
      )
      .toBe("active");
  });

  test("keeps the same target across a partial issue failure and retry", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-002", failures: 1 },
    ]);
    await openPlanning(page);
    await page
      .getByRole("button", {
        name: "Close Sprint 14 - Rollover fixture and roll over",
      })
      .click();
    const dialog = page.getByTestId("sprint-rollover-dialog");
    await dialog
      .getByRole("button", { name: "Use an existing planned sprint" })
      .click();
    const before = await readFixtureState(request);
    const existingTarget = sprintByName(before, "Sprint 15 - Rollover fixture");
    expect(existingTarget).toBeDefined();
    await dialog
      .getByTestId("sprint-rollover-existing-target")
      .selectOption(existingTarget?.id ?? "");
    await dialog.getByTestId("sprint-rollover-submit").click();
    await expect(dialog.getByTestId("sprint-rollover-result")).toBeVisible();
    await expect(
      dialog.getByText(
        "The completed steps and same target are saved. Retry now or close this dialog and resume later.",
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Retry rollover" }),
    ).toBeVisible();
    const partial = await readFixtureState(request);
    const partialVault = partial.vaults.find(
      (item) => item.name === REEF_E2E_VAULT,
    );
    const activeTarget = partialVault?.sprints.find(
      (item) => item.status === "active",
    );
    expect(activeTarget?.name).toBe("Sprint 15 - Rollover fixture");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByTestId("sprint-rollover-resume-notice"),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Resume Sprint 14 - Rollover fixture rollover",
      })
      .click();
    await expect(dialog.getByTestId("sprint-rollover-result")).toBeVisible();
    await dialog.getByRole("button", { name: "Retry rollover" }).click();
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        const vault = state.vaults.find((item) => item.name === REEF_E2E_VAULT);
        return vault?.issues.find((item) => item.id === "REEF-002")?.sprint_id;
      })
      .toBe(activeTarget?.id);

    const complete = await readFixtureState(request);
    const completeVault = complete.vaults.find(
      (item) => item.name === REEF_E2E_VAULT,
    );
    expect(
      completeVault?.activity.filter(
        (event) => event.event_type === "planning_link",
      ),
    ).toHaveLength(2);
  });

  test("retries a newly created target after a partial issue failure", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-002", failures: 1 },
    ]);
    await openPlanning(page);
    await page
      .getByRole("button", {
        name: "Close Sprint 14 - Rollover fixture and roll over",
      })
      .click();
    const dialog = page.getByTestId("sprint-rollover-dialog");
    await dialog
      .getByTestId("sprint-rollover-target-name")
      .fill("Fresh Sprint");
    await dialog.getByTestId("sprint-rollover-submit").click();
    await expect(dialog.getByTestId("sprint-rollover-result")).toBeVisible();
    await expect(
      dialog.getByTestId("sprint-rollover-target-name"),
    ).toBeDisabled();

    const partial = await readFixtureState(request);
    const partialVault = partial.vaults.find(
      (item) => item.name === REEF_E2E_VAULT,
    );
    const target = partialVault?.sprints.find(
      (item) => item.name === "Fresh Sprint",
    );
    expect(target?.status).toBe("active");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(
      page.getByTestId("sprint-rollover-resume-notice"),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Resume Sprint 14 - Rollover fixture rollover",
      })
      .click();
    await expect(dialog.getByTestId("sprint-rollover-result")).toBeVisible();
    await dialog.getByRole("button", { name: "Retry rollover" }).click();
    await expect(dialog.getByTestId("sprint-rollover-complete")).toBeVisible();
    await expect(dialog.getByTestId("sprint-rollover-result")).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        const vault = state.vaults.find((item) => item.name === REEF_E2E_VAULT);
        return vault?.issues.find((item) => item.id === "REEF-002")?.sprint_id;
      })
      .toBe(target?.id);
  });

  test("dismisses an overdue nudge and shows it again on re-entry", async ({
    page,
  }) => {
    await openPlanning(page);
    const nudge = page.getByTestId("sprint-rollover-nudge");
    await expect(nudge).toBeVisible();
    await nudge
      .getByRole("button", { name: "Dismiss sprint rollover notice" })
      .click();
    await expect(nudge).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("sprint-rollover-nudge")).toBeVisible();
  });

  test("rejects a direct close request when the workspace is reader-only", async ({
    page,
    request,
  }) => {
    await openPlanning(page);
    const before = await readFixtureState(request);
    const target = sprintByName(before, "Sprint 15 - Rollover fixture");
    expect(target).toBeDefined();
    await setAuthControl(request, { protectedResponse: "forbidden" });
    const response = await page.request.post(
      `/api/planning/sprints/${sprintByName(before, "Sprint 14 - Rollover fixture")?.id}/close`,
      {
        data: {
          vault: REEF_E2E_VAULT,
          end_date: "2026-06-14",
          target: { kind: "existing", id: target?.id },
        },
      },
    );
    expect(response.status()).toBe(403);
    const after = await readFixtureState(request);
    const vault = after.vaults.find((item) => item.name === REEF_E2E_VAULT);
    expect(
      vault?.sprints.find((item) => item.name.startsWith("Sprint 14"))?.status,
    ).toBe("active");
  });
});
