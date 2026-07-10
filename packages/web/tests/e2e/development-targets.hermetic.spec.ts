import { type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setVaultRole,
} from "./harness/fixture";

async function addMonitoredRepo(page: Page) {
  await page.goto(`/workspace/${REEF_E2E_VAULT}/settings/workspace`);
  const main = page.getByRole("main");
  await main.getByTestId("monitored-repos-trigger").click();
  await page.getByTestId("monitored-repos-option-octo/reef").click();
  await expect(main.getByTestId("monitored-repos-trigger")).toContainText(
    "1 repo(s) selected",
  );
}

test.describe("Hermetic development target settings", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("admin enables, reloads, renames, disables, and rejects an unmonitored id", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await addMonitoredRepo(page);

    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/settings/workspace/agent-execution`,
    );
    const card = page.getByTestId("development-target-1001");
    await expect(card).toContainText("octo/reef");
    await card.getByRole("switch").click();
    await card.getByRole("button", { name: "Save target" }).click();
    await expect(card).toContainText("Saved");

    await page.reload();
    await expect(card.getByRole("switch")).toBeChecked();
    await expect(card).toContainText("Available for runs");
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)
          ?.development_targets[0];
      })
      .toMatchObject({
        github_id: 1001,
        enabled: true,
        recipe_path: ".reef/agent.yml",
        runner_profile: "default",
        permission_profile: ":workspace",
        branch_template: "agent/{issue_id}/{run_id}",
      });

    const renameStatus = await page.evaluate(async (vault) => {
      const current = await fetch(`/api/config?vault=${vault}`).then((res) =>
        res.json(),
      );
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          patch: {
            monitored_repos: current.config.monitored_repos.map(
              (repo: { github_id: number }) => ({
                ...repo,
                owner: "renamed-org",
                name: "renamed-reef",
              }),
            ),
          },
        }),
      });
      return response.status;
    }, REEF_E2E_VAULT);
    expect(renameStatus).toBe(200);
    await page.reload();
    await expect(card).toContainText("renamed-org/renamed-reef");
    await expect(card.getByRole("switch")).toBeChecked();

    const craftedStatus = await page.evaluate(async (vault) => {
      const response = await fetch("/api/development-targets/999999", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          target: {
            enabled: true,
            recipe_path: ".reef/agent.yml",
            runner_profile: "default",
            permission_profile: ":workspace",
            branch_template: "agent/{issue_id}/{run_id}",
          },
        }),
      });
      return response.status;
    }, REEF_E2E_VAULT);
    expect(craftedStatus).toBe(422);

    await card.getByRole("switch").click();
    await card.getByRole("button", { name: "Save target" }).click();
    await expect(card).toContainText("Not available for runs");
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)
          ?.development_targets[0]?.enabled;
      })
      .toBe(false);
  });

  test("writer sees read-only target policy and direct mutation returns 403", async ({
    page,
    request,
  }) => {
    await setVaultRole(request, "writer");
    await openExistingWorkspace(page);
    await addMonitoredRepo(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/settings/workspace/agent-execution`,
    );
    const card = page.getByTestId("development-target-1001");
    await expect(card.getByRole("switch")).toBeDisabled();
    await expect(
      card.getByRole("button", { name: "Save target" }),
    ).toBeDisabled();

    const status = await page.evaluate(async (vault) => {
      const response = await fetch("/api/development-targets/1001", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault,
          target: {
            enabled: false,
            recipe_path: ".reef/agent.yml",
            runner_profile: "default",
            permission_profile: ":workspace",
            branch_template: "agent/{issue_id}/{run_id}",
          },
        }),
      });
      return response.status;
    }, REEF_E2E_VAULT);
    expect(status).toBe(403);
  });
});
