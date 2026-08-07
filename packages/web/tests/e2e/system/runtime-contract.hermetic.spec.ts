import { expect, test } from "@playwright/test";
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

    await page.goto("/workspace/reef-e2e/my-work");
    await expect(page.getByTestId("my-work-empty")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Go to the board/ }),
    ).toHaveAttribute("href", "/workspace/reef-e2e/issues?view=board");

    await page.goto("/workspace/reef-e2e/inbox");
    const inboxEmpty = page.getByTestId("notification-inbox-empty");
    await expect(inboxEmpty).toBeVisible();
    await expect(inboxEmpty.getByRole("button")).toHaveCount(0);

    await page.goto("/workspace/reef-e2e/reports");
    const reportsEmpty = page.getByTestId("reports-empty");
    await expect(reportsEmpty).toBeVisible();
    await expect(reportsEmpty).toContainText("No active issues yet");
    await expect(reportsEmpty.getByRole("button")).toHaveCount(0);

    await page.goto("/workspace/reef-e2e/planning");
    await expect(page.getByTestId("planning-empty-sprints")).toBeVisible();

    await page.getByRole("button", { name: "Milestones" }).click();
    await page.waitForURL(/planning\?kind=milestones$/);
    await expect(page.getByTestId("planning-empty-milestones")).toBeVisible();

    await page.getByRole("button", { name: "Releases" }).click();
    await page.waitForURL(/planning\?kind=releases$/);
    await expect(page.getByTestId("planning-empty-releases")).toBeVisible();

    await page
      .getByTestId("planning-empty-releases")
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
