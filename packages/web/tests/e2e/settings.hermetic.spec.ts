import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  readIndexedDbCredential,
  resetFixture,
} from "./harness/fixture";

function reefVault(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): Awaited<ReturnType<typeof readFixtureState>>["vaults"][number] {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

test.describe("Hermetic settings workflows", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("saves a browser GitHub token and persists monitored repositories through real config routes", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await expect(
      page.locator('[data-testid="settings-group-personal"]'),
    ).toBeVisible();
    await page
      .getByLabel("GitHub Personal Access Token")
      .fill("ghp_hermetic_fixture_token");
    await page.locator('[data-testid="save-token-btn"]').click();
    await expect(page.getByText("Token saved.")).toBeVisible();
    await expect
      .poll(() => readIndexedDbCredential(page, "github_token"))
      .toBe("ghp_hermetic_fixture_token");

    await page.goto("/settings/workspace");
    await expect(
      page.locator('[data-testid="settings-group-workspace"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="monitored-repos-trigger"]'),
    ).toBeVisible();
    await page.locator('[data-testid="monitored-repos-trigger"]').click();
    await expect(
      page.getByTestId("monitored-repos-option-octo/reef"),
    ).toBeVisible();
    await page.getByTestId("monitored-repos-option-octo/reef").click();

    await expect(
      page.locator('[data-testid="monitored-repos-trigger"]'),
    ).toContainText("1 repo(s) selected");
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).monitored_repos.map(
          (repo) => `${repo.owner}/${repo.name}`,
        );
      })
      .toContain("octo/reef");

    await page.goto("/activity");
    await expect(
      page.locator('[data-testid="activity-scan-target-single"]'),
    ).toHaveText("octo/reef");
    await page.locator('[data-testid="activity-refresh"]').click();
    await expect(
      page.locator('[data-testid="activity-last-scan"]'),
    ).toContainText("Scanned");
  });

  test("updates workspace project prefix and authoring language through real config routes", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/settings/workspace");

    await page.locator('[data-testid="project-prefix-input"]').fill("QA");
    await page.locator('[data-testid="project-prefix-save"]').click();
    await expect(
      page.locator('[data-testid="project-prefix-input"]'),
    ).toHaveValue("QA");
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).settings)
      .toMatchObject({ project_prefix: "QA" });

    await page.locator('[data-testid="authoring-language-select"]').click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(
      page.locator('[data-testid="authoring-language-select"]'),
    ).toContainText("English");
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).settings)
      .toMatchObject({ authoring_language: "en" });
  });

  test("creates, updates, and deletes an issue template from workspace settings", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/settings/workspace");

    await expect(
      page.locator('[data-testid="templates-section"]'),
    ).toBeVisible();
    await page.locator('[data-testid="templates-new-button"]').click();
    await expect(
      page.locator('[data-testid="templates-editor"]'),
    ).toBeVisible();
    await page
      .locator('[data-testid="templates-name-input"]')
      .fill("e2e-template");
    await page
      .locator('[data-testid="templates-label-input"]')
      .fill("E2E Template");
    await page
      .locator('[data-testid="templates-description-input"]')
      .fill("Created by the hermetic settings workflow.");
    await page.locator('[data-testid="templates-editor-save"]').click();

    await expect(
      page.locator('[data-testid="templates-row-e2e-template"]'),
    ).toBeVisible();
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).templates)
      .toContainEqual(expect.objectContaining({ name: "e2e-template" }));

    await page.locator('[data-testid="templates-edit-e2e-template"]').click();
    await page
      .locator('[data-testid="templates-label-input"]')
      .fill("E2E Template Edited");
    await page.locator('[data-testid="templates-editor-save"]').click();
    await expect(
      page.locator('[data-testid="templates-row-e2e-template"]'),
    ).toContainText("E2E Template Edited");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-testid="templates-delete-e2e-template"]').click();
    await expect(
      page.locator('[data-testid="templates-row-e2e-template"]'),
    ).toBeHidden();
    await expect
      .poll(async () =>
        reefVault(await readFixtureState(request)).templates.map(
          (template) => template.name,
        ),
      )
      .not.toContain("e2e-template");
  });

  test("routes settings root to workspace, then renders members and deployment subpages", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings");
    await page.waitForURL(/\/settings\/workspace$/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="settings-group-workspace"]'),
    ).toBeVisible();

    await page.goto("/settings/workspace/members");
    await expect(
      page.locator('[data-testid="settings-group-members"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="members-section"]')).toBeVisible();

    await page.goto("/settings/deployment");
    await expect(
      page.locator('[data-testid="settings-group-deployment"]'),
    ).toBeVisible();
    await expect(page.getByText("AI Configuration")).toBeVisible();
  });

  test("disconnects the browser GitHub token and signs out from preferences", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/settings/preferences");

    await page
      .getByLabel("GitHub Personal Access Token")
      .fill("ghp_disconnect_fixture_token");
    await page.locator('[data-testid="save-token-btn"]').click();
    await expect(page.getByText("Token saved.")).toBeVisible();
    await expect
      .poll(() => readIndexedDbCredential(page, "github_token"))
      .toBe("ghp_disconnect_fixture_token");

    await page.locator('[data-testid="disconnect-btn"]').click();
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="akb-login-form"]')).toBeVisible();
    await expect
      .poll(() => readIndexedDbCredential(page, "github_token"))
      .toBeUndefined();
  });
});
