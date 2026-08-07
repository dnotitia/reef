import { type Locator, expect, test } from "@playwright/test";
import {
  E2E_MOCK_URL,
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
        "configured_empty",
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
      page
        .locator('[data-slot="page-header"]')
        .getByRole("link", { name: /Go to the board/ }),
    ).toHaveAttribute("href", "/workspace/reef-e2e/issues?view=board");
    await recordFrame(myWorkEmpty);

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
});
