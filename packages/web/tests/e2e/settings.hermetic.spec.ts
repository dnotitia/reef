import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
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
    // Drop the persisted React Query snapshot on every navigation so the
    // `/activity` mount below always fetches `['config', vault]` fresh. Without
    // this, navigating away from Settings can rehydrate a stale-but-still-fresh
    // (within the 60s staleTime) config snapshot whose `monitored_repos` is
    // empty — written before the repo we just added had flushed to localStorage.
    // That makes `/activity` render the empty-state branch (no
    // `activity-scan-target-single`) instead of the single-repo target, which
    // shows up as a flaky 15s timeout on the assertion below. (REEF-220 race)
    await clearPersistedQueryCacheOnLoad(page);
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

  test("seeds the canonical issue-type default templates from an empty workspace (REEF-256)", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/settings/workspace");

    // A workspace with no templates shows the seed-defaults call to action.
    await expect(
      page.locator('[data-testid="templates-section-empty"]'),
    ).toBeVisible();
    await page.locator('[data-testid="templates-seed-defaults"]').click();

    // All six canonical issue types land as rows; the legacy feature /
    // tech-debt templates are gone.
    for (const name of ["epic", "story", "task", "bug", "spike", "chore"]) {
      await expect(
        page.locator(`[data-testid="templates-row-${name}"]`),
      ).toBeVisible();
    }
    await expect(
      page.locator('[data-testid="templates-row-feature"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="templates-row-tech-debt"]'),
    ).toHaveCount(0);

    // The seed wrote through the real writeTemplate route into the fixture vault.
    await expect
      .poll(async () =>
        reefVault(await readFixtureState(request))
          .templates.map((template) => template.name)
          .sort(),
      )
      .toEqual(["bug", "chore", "epic", "spike", "story", "task"]);
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

  test("disconnects the browser GitHub token without signing out (REEF-247)", async ({
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

    // The PAT is removed and the page returns to the token-entry form...
    await expect(page.getByText("GitHub token removed.")).toBeVisible();
    await expect(page.getByLabel("GitHub Personal Access Token")).toBeVisible();
    await expect
      .poll(() => readIndexedDbCredential(page, "github_token"))
      .toBeUndefined();

    // ...but the akb workspace session is untouched: still on preferences, no
    // redirect to /login (REEF-247 — workspace sign-out is the sidebar menu).
    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);
  });
});
