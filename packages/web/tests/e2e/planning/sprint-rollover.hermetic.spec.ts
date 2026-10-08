import { expect, test, type Page } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setAuthControl,
  setIssueListFailure,
  setIssueUpdateControl,
} from "../harness/fixture";
import { PERSISTED_QUERY_CACHE_KEY } from "../../../src/lib/storage/clientCache";

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
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByTestId("planning-kind-switcher")).toBeVisible();
  await expect(page.getByTestId("planning-kind-sprints")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
        "Completed steps are saved. Retry with the same destination sprint.",
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

    await dialog.getByTestId("sprint-rollover-close").click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByTestId("sprint-rollover-resume-notice"),
    ).toBeVisible();
    const currentSprintNudge = page.getByTestId("sprint-rollover-nudge");
    await expect(currentSprintNudge).toBeVisible();
    await expect(currentSprintNudge).toHaveAttribute(
      "data-priority",
      "secondary",
    );
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
    await expect(dialog.getByTestId("sprint-rollover-target-name")).toHaveCount(
      0,
    );
    await expect(
      dialog.getByTestId("sprint-rollover-target-summary"),
    ).toContainText("Fresh Sprint");

    const partial = await readFixtureState(request);
    const partialVault = partial.vaults.find(
      (item) => item.name === REEF_E2E_VAULT,
    );
    const target = partialVault?.sprints.find(
      (item) => item.name === "Fresh Sprint",
    );
    expect(target?.status).toBe("active");

    await dialog.getByTestId("sprint-rollover-close").click();
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

  for (const failureMode of [409, 503, "network"] as const) {
    test(`keeps the overdue nudge visible through background issue-list ${failureMode} errors`, async ({
      page,
      request,
    }) => {
      await openExistingWorkspace(page);
      const issueListResponseStatuses: number[] = [];
      page.on("response", (response) => {
        if (new URL(response.url()).pathname === "/api/issues") {
          issueListResponseStatuses.push(response.status());
        }
      });

      const nudge = page.getByTestId("sprint-rollover-nudge");
      await expect(nudge).toBeVisible();
      await expect(nudge).toContainText("Sprint 14 - Rollover fixture");
      await expect(nudge).toContainText("2 unfinished issues");
      const initialBounds = await nudge.boundingBox();
      if (!initialBounds) throw new Error("rollover notice has no layout box");

      await page.clock.install({ time: new Date() });
      await page.clock.fastForward(60_001);
      await setIssueListFailure(request, true, 0, 0, failureMode);
      // Switching views remounts the stale issue-list observer while preserving
      // the workspace's warm QueryClient cache. This triggers the real Route
      // Handler refetch without relying on a headless browser focus transition.
      const failureResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/issues" &&
          response.status() !== 200,
      );
      await page.getByTestId("view-switcher-list").click();
      const failureResponse = await failureResponsePromise;
      expect(failureResponse.status()).toBe(failureMode === 409 ? 409 : 502);
      await expect(page.getByTestId("view-switcher-list")).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await page.getByTestId("view-switcher-board").click();
      const board = page.getByTestId("kanban-board");
      const boardError = board.getByRole("alert");
      await expect(board).toBeVisible();
      await expect(boardError).toBeVisible({ timeout: 10_000 });
      await expect(boardError).toContainText(
        "Failed to load some issues. Displaying cached data if available.",
      );
      const retryButton = boardError.getByRole("button", {
        name: "Retry",
        exact: true,
      });
      await expect(retryButton).toBeVisible();
      await expect(retryButton).toBeEnabled();
      await expect(nudge).toBeVisible();
      await expect(nudge).toContainText("Sprint 14 - Rollover fixture");
      await expect(nudge).toContainText("2 unfinished issues");
      const errorBounds = await nudge.boundingBox();
      if (!errorBounds)
        throw new Error("rollover notice lost its layout box during refetch");
      expect(errorBounds.x).toBeCloseTo(initialBounds.x, 0);
      expect(errorBounds.y).toBeCloseTo(initialBounds.y, 0);
      expect(errorBounds.width).toBeCloseTo(initialBounds.width, 0);
      expect(errorBounds.height).toBeCloseTo(initialBounds.height, 0);

      await setIssueListFailure(request, false);
      const responseCountBeforeRetry = issueListResponseStatuses.length;
      await retryButton.click();
      await expect(boardError).toHaveCount(0);
      await expect
        .poll(() =>
          issueListResponseStatuses
            .slice(responseCountBeforeRetry)
            .includes(200),
        )
        .toBe(true);
      await expect(nudge).toBeVisible();
      await expect(nudge).toContainText("2 unfinished issues");
      const recoveredBounds = await nudge.boundingBox();
      if (!recoveredBounds)
        throw new Error("rollover notice lost its layout box after retry");
      expect(recoveredBounds.x).toBeCloseTo(initialBounds.x, 0);
      expect(recoveredBounds.y).toBeCloseTo(initialBounds.y, 0);
      expect(recoveredBounds.width).toBeCloseTo(initialBounds.width, 0);
      expect(recoveredBounds.height).toBeCloseTo(initialBounds.height, 0);
    });
  }

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

  test("revalidates reader access before showing a saved resume action", async ({
    page,
    request,
  }) => {
    await setIssueUpdateControl(request, [
      { issueId: "REEF-002", failures: 1 },
    ]);
    await openPlanning(page);
    const sourceSprintId = sprintByName(
      await readFixtureState(request),
      "Sprint 14 - Rollover fixture",
    )?.id;
    if (!sourceSprintId) throw new Error("Rollover source sprint is missing");
    await page
      .getByRole("button", {
        name: "Close Sprint 14 - Rollover fixture and roll over",
      })
      .click();
    const dialog = page.getByTestId("sprint-rollover-dialog");
    await dialog
      .getByTestId("sprint-rollover-target-name")
      .fill("Reader resume target");
    await dialog.getByTestId("sprint-rollover-submit").click();
    await expect(dialog.getByTestId("sprint-rollover-result")).toBeVisible();
    await dialog.getByTestId("sprint-rollover-close").click();
    await expect(
      page.getByTestId("sprint-rollover-resume-notice"),
    ).toBeVisible();

    // The cache persister is asynchronous and throttled. Make this an actual
    // saved-resume revalidation test instead of reloading from its older empty
    // snapshot before the partial rollover reaches localStorage.
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ cacheKey, vaultName, sourceId }) => {
              type CachedQuery = {
                queryKey?: unknown;
                state?: { data?: unknown };
              };
              type CachedClient = {
                clientState?: { queries?: CachedQuery[] };
              };
              type CachedResume = {
                end_date?: string;
                target?: { kind?: string };
                result?: {
                  status?: string;
                  source_sprint_id?: string;
                  phases?: { issue_rollover?: string };
                };
              };

              try {
                const raw = window.localStorage.getItem(cacheKey);
                if (!raw) return null;
                const persisted = JSON.parse(raw) as CachedClient;
                const planningQuery = persisted.clientState?.queries?.find(
                  (query) => {
                    const key = query.queryKey;
                    return (
                      Array.isArray(key) &&
                      key[0] === "planning" &&
                      key[1] === "catalog" &&
                      key[2] === vaultName
                    );
                  },
                );
                const catalog = planningQuery?.state?.data as
                  | { rollover_resumes?: CachedResume[] }
                  | undefined;
                const resume = catalog?.rollover_resumes?.find(
                  (candidate) =>
                    candidate.result?.source_sprint_id === sourceId &&
                    candidate.result.status === "partial",
                );
                if (!resume?.result) return null;
                return {
                  endDate: resume.end_date,
                  sourceSprintId: resume.result.source_sprint_id,
                  status: resume.result.status,
                  issueRollover: resume.result.phases?.issue_rollover,
                  targetKind: resume.target?.kind,
                };
              } catch {
                return null;
              }
            },
            {
              cacheKey: PERSISTED_QUERY_CACHE_KEY,
              vaultName: REEF_E2E_VAULT,
              sourceId: sourceSprintId,
            },
          ),
        {
          timeout: 5_000,
          message:
            "The partial rollover resume should be persisted before reader revalidation",
        },
      )
      .toEqual({
        endDate: "2026-06-14",
        sourceSprintId,
        status: "partial",
        issueRollover: "partial",
        targetKind: "new",
      });

    await setAuthControl(request, {
      protectedResponse: "forbidden",
      session: "active",
    });
    await page.reload();

    const planningNotice = page.getByTestId("sprint-rollover-resume-notice");
    const planningResume = planningNotice.getByRole("button", {
      name: "Resume Sprint 14 - Rollover fixture rollover",
    });
    await expect(planningResume).toBeDisabled();
    await expect(
      planningNotice.getByText(
        "Edit access is required to resume this rollover.",
      ),
    ).toBeVisible();

    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/planning/sprints/00000000-0000-4000-8000-000000000001`,
    );
    const detailNotice = page.getByTestId("sprint-rollover-resume-notice");
    await expect(
      detailNotice.getByRole("button", {
        name: "Resume Sprint 14 - Rollover fixture rollover",
      }),
    ).toBeDisabled();
    await expect(
      detailNotice.getByText(
        "Edit access is required to resume this rollover.",
      ),
    ).toBeVisible();

    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues`);
    const issuesNotice = page.getByTestId("sprint-rollover-resume-notice");
    await expect(
      issuesNotice.getByRole("button", {
        name: "Resume Sprint 14 - Rollover fixture rollover",
      }),
    ).toBeDisabled();
    await expect(
      issuesNotice.getByText(
        "Edit access is required to resume this rollover.",
      ),
    ).toBeVisible();

    await setAuthControl(request, {
      protectedResponse: "healthy",
      session: "active",
    });
    await page.reload();
    await expect(
      page.getByTestId("sprint-rollover-resume-notice").getByRole("button", {
        name: "Resume Sprint 14 - Rollover fixture rollover",
      }),
    ).toBeEnabled();
  });
});
