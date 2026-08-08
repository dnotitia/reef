import { type Locator, expect, test } from "@playwright/test";
import {
  E2E_MOCK_URL,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";
import fixtureLogin from "../harness/fixture-login.json";

test.describe("Hermetic runtime discovery", () => {
  test("publishes runtime controls and resets named-filter fixtures idempotently", async ({
    request,
  }) => {
    const response = await request.get(`${E2E_MOCK_URL}/__e2e/runtime`);
    expect(response.ok()).toBeTruthy();
    const contract = await response.json();

    expect(contract).toMatchObject({
      schema_version: 1,
      status: "ready",
      operations: {
        health: { method: "GET", path: "/__e2e/health" },
        reset: {
          method: "POST",
          path: "/__e2e/reset",
          content_type: "application/json",
          body: { scenario: "<supported_scenario>" },
        },
      },
      fixture_login: {
        ...fixtureLogin,
      },
      tasks: {
        named_issue_filters: {
          scenario: "configured_multi",
          workspace: "reef-e2e",
          secondary_workspace: "reef-zeta",
          start_path: "/workspace/reef-e2e/issues?view=list",
        },
        backlog_bulk_partial_failure: {
          scenario: "backlog_bulk_partial_failure",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues?view=backlog",
          interaction: {
            type: "bulk_status_update",
            operation:
              "select the visible Backlog issues, choose In Review from the bulk Status control, observe one successful issue leave Backlog while one failed issue keeps its original Backlog state and selection, then open the failure tray and retry the failed update",
          },
        },
        content_search: {
          scenario: "content_search",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "global_search",
            shortcut: "Mod+K",
            platform_shortcuts: {
              macos: "Meta+K",
              other: "Control+K",
            },
            query: "issue title, body, or comment phrase",
          },
        },
        activity_suggestions: {
          scenario: "activity_suggestions",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/suggestions",
          interaction: {
            type: "activity_review",
            operation:
              "review a pending suggestion, approve it, inspect the created issue, and add a comment",
          },
        },
        chat: {
          scenario: "configured",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "workspace_chat",
            operation:
              "open Ask AI, submit distinct questions, and observe each assistant response",
          },
        },
        comments: {
          scenario: "comment_mentions",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "issue_activity",
            operation:
              "open an issue, add a comment, and observe it in the activity timeline",
          },
        },
        empty_states: {
          scenario: "configured_empty",
          workspace: "reef-e2e",
          start_paths: {
            my_work: "/workspace/reef-e2e/my-work",
            inbox: "/workspace/reef-e2e/inbox",
            reports: "/workspace/reef-e2e/reports",
            planning: "/workspace/reef-e2e/planning",
          },
        },
        caught_up_states: {
          scenario: "configured_caught_up",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/my-work",
        },
      },
    });
    const discoveredLogin = contract.fixture_login as typeof fixtureLogin;
    const { username, password } = discoveredLogin;
    const loginResponse = await request.post(
      `${E2E_MOCK_URL}/akb/api/v1/auth/login`,
      {
        data: {
          username,
          password,
        },
      },
    );
    expect(loginResponse.ok()).toBeTruthy();
    expect((await loginResponse.json()).user.username).toBe(username);
    expect(contract.scenarios).toEqual(
      expect.arrayContaining([
        "configured_multi",
        "backlog_bulk_partial_failure",
        "configured_empty",
        "configured_caught_up",
        "content_search",
        "large_vault",
      ]),
    );

    await resetFixture(request, "configured_multi");
    const first = await readFixtureState(request);
    await resetFixture(request, "configured_multi");
    const second = await readFixtureState(request);
    const summarize = (state: Awaited<ReturnType<typeof readFixtureState>>) =>
      state.vaults.map((vault) => ({
        name: vault.name,
        issue_ids: vault.issue_ids,
      }));

    expect(first.scenario).toBe("configured_multi");
    expect(summarize(second)).toEqual(summarize(first));
    expect(first.vaults.map((vault) => vault.name)).toEqual(
      expect.arrayContaining(["reef-e2e", "reef-zeta"]),
    );

    await resetFixture(request, "configured_empty");
    const emptyState = await readFixtureState(request);
    const emptyVault = emptyState.vaults.find(
      (vault) => vault.name === "reef-e2e",
    );
    expect(emptyState.scenario).toBe("configured_empty");
    expect(emptyVault).toMatchObject({
      name: "reef-e2e",
      issue_ids: [],
      sprints: [],
      milestones: [],
      releases: [],
      notifications: [],
    });
    expect(emptyVault?.tables).toEqual(
      expect.arrayContaining([
        "reef_issues",
        "reef_notifications",
        "reef_sprints",
        "reef_milestones",
        "reef_releases",
      ]),
    );
  });

  test("renders the configured empty workspace across its routed surfaces", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_empty");

    const state = await readFixtureState(request);
    const vault = state.vaults.find((item) => item.name === "reef-e2e");
    expect(vault).toMatchObject({
      issue_ids: [],
      sprints: [],
      milestones: [],
      releases: [],
      notifications: [],
    });

    await openExistingWorkspace(page);
    const frameBoxes: Array<{ width: number; height: number }> = [];
    async function recordFrame(locator: Locator) {
      const box = await locator.boundingBox();
      if (!box) {
        throw new Error(
          "Expected the empty-state frame to have a bounding box",
        );
      }
      frameBoxes.push(box);
    }

    await page.goto("/workspace/reef-e2e/my-work");
    const myWorkEmpty = page.getByTestId("my-work-empty");
    await expect(myWorkEmpty).toBeVisible();
    await expect(myWorkEmpty.locator("h2")).toHaveCount(1);
    await expect(myWorkEmpty.locator("p")).toHaveCount(1);
    await expect(myWorkEmpty.getByRole("link")).toHaveCount(0);
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Issues", exact: true }),
    ).toHaveAttribute("href", "/workspace/reef-e2e/issues");
    await recordFrame(myWorkEmpty);
    await page.getByRole("link", { name: "Issues", exact: true }).click();
    await page.waitForURL(/\/workspace\/reef-e2e\/issues\/?$/);
    await expect(page.getByTestId("view-switcher-board")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/workspace/reef-e2e/inbox");
    const inboxEmpty = page.getByTestId("notification-inbox-empty");
    await expect(inboxEmpty).toBeVisible();
    await expect(inboxEmpty.locator("h2")).toHaveCount(1);
    await expect(inboxEmpty.locator("p")).toHaveCount(1);
    await expect(
      inboxEmpty.locator('[data-slot="empty-state-icon"]'),
    ).toHaveCount(0);
    await expect(inboxEmpty.getByRole("button")).toHaveCount(0);
    await recordFrame(inboxEmpty);

    await page.goto("/workspace/reef-e2e/reports");
    const reportsEmpty = page.getByTestId("reports-empty");
    await expect(reportsEmpty).toBeVisible();
    await expect(
      reportsEmpty.getByRole("heading", { name: "No active issues yet" }),
    ).toBeVisible();
    await expect(reportsEmpty.locator("p")).toHaveCount(1);
    await expect(reportsEmpty.getByRole("button")).toHaveCount(0);
    await expect(
      page
        .locator('[data-slot="page-header"]')
        .getByRole("button", { name: "New issue", exact: true }),
    ).toHaveCount(1);
    await recordFrame(reportsEmpty);

    await page.goto("/workspace/reef-e2e/planning");
    const planningEmpty = page.getByTestId("planning-empty-sprints");
    await expect(planningEmpty).toBeVisible();
    await expect(planningEmpty.locator("h2")).toHaveCount(1);
    await expect(planningEmpty.locator("p")).toHaveCount(1);
    await expect(planningEmpty.getByRole("button")).toHaveCount(0);
    await expect(
      page
        .locator('[data-slot="page-header"]')
        .getByRole("button", { name: "New sprint" }),
    ).toBeVisible();
    await recordFrame(planningEmpty);

    const reference = frameBoxes[0];
    for (const box of frameBoxes.slice(1)) {
      expect(Math.abs(box.width - reference.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - reference.height)).toBeLessThanOrEqual(1);
    }

    await page.getByRole("button", { name: "Milestones" }).click();
    await page.waitForURL(/planning\?kind=milestones$/);
    await expect(page.getByTestId("planning-empty-milestones")).toBeVisible();

    await page.getByRole("button", { name: "Releases" }).click();
    await page.waitForURL(/planning\?kind=releases$/);
    await expect(page.getByTestId("planning-empty-releases")).toBeVisible();

    await page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New release" })
      .click();
    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeHidden();
  });

  test("keeps empty frames and caught-up state aligned in narrow dark Korean viewports", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured_empty");
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await openExistingWorkspace(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    const frameBoxes: Array<{ width: number; height: number }> = [];
    async function recordFrame(locator: Locator) {
      const box = await locator.boundingBox();
      if (!box) {
        throw new Error(
          "Expected the narrow empty-state frame to have a bounding box",
        );
      }
      expect(box.width).toBeGreaterThan(250);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      frameBoxes.push({ width: box.width, height: box.height });
    }

    async function expectViewportFits() {
      const widths = await page.evaluate(() => ({
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(widths.body).toBeLessThanOrEqual(widths.viewport);
      expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    }

    const sidebar = await page.locator("aside").boundingBox();
    expect(sidebar?.width).toBe(56);

    await page.goto("/workspace/reef-e2e/my-work");
    const myWorkEmpty = page.getByTestId("my-work-empty");
    await expect(myWorkEmpty).toBeVisible();
    await recordFrame(myWorkEmpty);
    const boardAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("link");
    await expect(boardAction).toHaveCount(0);
    await expectViewportFits();

    await page.goto("/workspace/reef-e2e/inbox");
    const inboxEmpty = page.getByTestId("notification-inbox-empty");
    await expect(inboxEmpty).toBeVisible();
    await recordFrame(inboxEmpty);
    await expectViewportFits();

    await page.goto("/workspace/reef-e2e/reports");
    const reportsEmpty = page.getByTestId("reports-empty");
    await expect(reportsEmpty).toBeVisible();
    await recordFrame(reportsEmpty);
    const reportsAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "새 이슈", exact: true });
    await expect(reportsAction).toHaveCount(1);
    await expect(reportsAction).toBeVisible();
    const reportsActionBox = await reportsAction.boundingBox();
    if (!reportsActionBox)
      throw new Error("Expected the Reports New issue action to have a box");
    expect(reportsActionBox.x + reportsActionBox.width).toBeLessThanOrEqual(
      390,
    );
    await expectViewportFits();

    await page.goto("/workspace/reef-e2e/planning");
    const planningEmpty = page.getByTestId("planning-empty-sprints");
    await expect(planningEmpty).toBeVisible();
    await recordFrame(planningEmpty);
    const sprintAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("button");
    await expect(sprintAction).toHaveCount(1);
    await expect(sprintAction).toBeVisible();
    const sprintBox = await sprintAction.boundingBox();
    if (!sprintBox)
      throw new Error("Expected the New sprint action to have a box");
    expect(sprintBox.x + sprintBox.width).toBeLessThanOrEqual(390);
    await expectViewportFits();

    const reference = frameBoxes[0];
    for (const box of frameBoxes.slice(1)) {
      expect(Math.abs(box.width - reference.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - reference.height)).toBeLessThanOrEqual(1);
    }
  });

  test("keeps caught-up My Work passive in a narrow dark Korean viewport", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured_caught_up");
    const state = await readFixtureState(request);
    const vault = state.vaults.find((item) => item.name === "reef-e2e");
    expect(state.scenario).toBe("configured_caught_up");
    expect(vault?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "done", assigned_to: "alice" }),
      ]),
    );
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await openExistingWorkspace(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    await page.goto("/workspace/reef-e2e/my-work");
    const myWorkCaughtUp = page.getByTestId("my-work-caught-up");
    await expect(myWorkCaughtUp).toBeVisible();
    await expect(myWorkCaughtUp.getByRole("link")).toHaveCount(0);
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);
    const caughtUpWidths = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(caughtUpWidths.body).toBeLessThanOrEqual(caughtUpWidths.viewport);
    expect(caughtUpWidths.document).toBeLessThanOrEqual(
      caughtUpWidths.viewport,
    );
    await page.reload();
    await expect(page.getByTestId("my-work-caught-up")).toBeVisible();
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);
  });

  test("preserves the label no-match after clearing a parent report scope", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/reports");
    await expect(
      page
        .locator('[data-slot="page-header"]')
        .getByRole("button", { name: "New issue", exact: true }),
    ).toHaveCount(0);

    const milestones = page.getByRole("button", {
      name: "Milestones",
      exact: true,
    });
    const parents = page.getByRole("button", { name: "Parents", exact: true });
    await expect(milestones).toHaveAttribute("aria-pressed", "true");
    await expect(parents).toHaveAttribute("aria-pressed", "false");

    // Exercise the real pointer activation and selected-state contract before
    // relying on the parent row downstream.
    await parents.click();
    await expect(parents).toHaveAttribute("aria-pressed", "true");
    await expect(milestones).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("health-rollup-row-REEF-101")).toBeVisible();

    // Native buttons retain keyboard activation when the segmented control has
    // focus; verify both the switch away and the switch back.
    await milestones.focus();
    await page.keyboard.press("Enter");
    await expect(milestones).toHaveAttribute("aria-pressed", "true");
    await expect(parents).toHaveAttribute("aria-pressed", "false");
    await parents.focus();
    await page.keyboard.press("Space");
    await expect(parents).toHaveAttribute("aria-pressed", "true");
    await expect(milestones).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("health-rollup-row-REEF-101").click();
    const labelInput = page.getByTestId("report-label-input");
    await labelInput.fill("docs");
    await labelInput.press("Enter");
    await expect(page.getByTestId("reports-empty")).toBeVisible();
    await expect(page.getByText("No matching report data")).toBeVisible();
    await expect(page.getByText("docs")).toBeVisible();

    await page.getByTestId("reports-clear-parent-scope").click();
    await expect(page.getByTestId("reports-clear-parent-scope")).toHaveCount(0);
    await expect(page.getByText("No matching report data")).toBeVisible();
    await expect(page.getByText("docs")).toBeVisible();
  });

  test("opens the shared New issue dialog from an empty Reports header and restores focus", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/reports");

    const trigger = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New issue", exact: true });
    const reportsEmpty = page.getByTestId("reports-empty");
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(reportsEmpty).toBeVisible();
    await expect(trigger).toHaveCount(1);

    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("new-issue-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(reportsEmpty).toBeVisible();

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(reportsEmpty).toBeVisible();
  });

  test("creates and persists an issue from an empty Reports header", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/reports");

    const trigger = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New issue", exact: true });
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(page.getByTestId("reports-empty")).toBeVisible();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByTestId("new-issue-title-input")
      .fill("Created from empty Reports");
    await dialog.getByTestId("new-issue-submit").click();

    await page.waitForURL(/\/issues\/REEF-\d+/, { timeout: 10_000 });
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(
      "Created from empty Reports",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return (
          state.vaults.find((vault) => vault.name === "reef-e2e")?.issues ?? []
        );
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Created from empty Reports",
          }),
        ]),
      );
  });
});
