import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

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

  test("contains the active-workspace selector and keyboard focus ring at narrow widths", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const viewport of [
      { width: 320, height: 844 },
      { width: 375, height: 844 },
      { width: 414, height: 844 },
      { width: 768, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${REEF_E2E_VAULT}/settings/workspace`);

      const selector = page.getByTestId("active-vault-trigger");
      await expect(selector).toBeVisible();
      await selector.focus();
      const geometry = await selector.evaluate((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        const styles = getComputedStyle(node);
        const outlineWidth = Number.parseFloat(styles.outlineWidth) || 0;
        const outlineOffset = Number.parseFloat(styles.outlineOffset) || 0;
        const outline = outlineWidth + outlineOffset;
        return {
          left: rect.left - outline,
          right: rect.right + outline,
          viewportWidth: window.innerWidth,
          documentOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });

      expect(geometry.left, `${viewport.width}px left`).toBeGreaterThanOrEqual(
        -1,
      );
      expect(
        geometry.right,
        `${viewport.width}px focus right`,
      ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.documentOverflow, `${viewport.width}px document`).toBe(
        false,
      );
    }
  });

  test("keeps every Settings scope tab visible and inside the viewport at narrow widths", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const viewport of [
      { width: 320, height: 844 },
      { width: 375, height: 844 },
      { width: 414, height: 844 },
      { width: 768, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${REEF_E2E_VAULT}/settings/workspace`);

      const tabs = page.getByRole("navigation", {
        name: "Settings sections",
        exact: true,
      });
      await expect(tabs).toBeVisible();
      for (const label of ["Workspace", "Preferences", "Deployment"]) {
        const tab = tabs.getByRole("link", { name: label });
        await expect(tab).toBeVisible();
        const geometry = await tab.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            viewportWidth: window.innerWidth,
          };
        });
        expect(
          geometry.left,
          `${viewport.width}px ${label} left`,
        ).toBeGreaterThanOrEqual(-1);
        expect(
          geometry.right,
          `${viewport.width}px ${label} right`,
        ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
        `${viewport.width}px document`,
      ).toBe(false);
    }
  });

  test("persists monitored repositories through GitHub App-backed config routes", async ({
    page,
    request,
  }) => {
    // Drop the persisted React Query snapshot so the settings page observes
    // the repository written by the config route immediately.
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/settings/preferences");
    await expect(
      page.getByRole("main").locator('[data-testid="settings-group-personal"]'),
    ).toBeVisible();
    await expect(page.getByLabel("GitHub Personal Access Token")).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid="disconnect-btn"]')).toHaveCount(0);

    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");
    await expect(
      main.locator('[data-testid="settings-group-workspace"]'),
    ).toBeVisible();
    await expect(
      main.locator('[data-testid="monitored-repos-trigger"]'),
    ).toBeVisible();
    await main.locator('[data-testid="monitored-repos-trigger"]').click();
    await expect(
      page.getByTestId("monitored-repos-option-octo/reef"),
    ).toBeVisible();
    await page.getByTestId("monitored-repos-option-octo/reef").click();

    await expect(
      main.locator('[data-testid="monitored-repos-trigger"]'),
    ).toContainText("1 repo(s) selected");
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).monitored_repos.map(
          (repo) => `${repo.owner}/${repo.name}`,
        );
      })
      .toContain("octo/reef");
  });

  test("restores the repository trigger focus after pointer and keyboard saves", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/settings/workspace`);
    const main = page.getByRole("main");
    const trigger = main.locator('[data-testid="monitored-repos-trigger"]');

    for (const interaction of ["pointer", "Enter", "Space"] as const) {
      await trigger.click();
      const option = page.getByTestId("monitored-repos-option-octo/reef");
      if (interaction === "pointer") {
        await option.click();
      } else {
        await option.focus();
        await page.keyboard.press(interaction);
      }

      await expect(
        page.getByRole("dialog", { name: "Search repositories" }),
      ).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(
        main.locator('[data-testid="repo-picker-save-message"]'),
      ).toContainText("saved", { timeout: 10_000 });
      await expect(trigger).not.toHaveAttribute("aria-busy", "true");
    }
  });

  test("updates workspace project prefix and authoring language through real config routes", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");

    await main.locator('[data-testid="project-prefix-input"]').fill("QA");
    await main.locator('[data-testid="project-prefix-save"]').click();
    await expect(
      main.locator('[data-testid="project-prefix-input"]'),
    ).toHaveValue("QA");
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).settings)
      .toMatchObject({ project_prefix: "QA" });

    await main.locator('[data-testid="authoring-language-select"]').click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(
      main.locator('[data-testid="authoring-language-select"]'),
    ).toContainText("English");
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).settings)
      .toMatchObject({ authoring_language: "en" });

    await main.getByLabel("Hide completed after N days").fill("14");
    await main.getByLabel("Hide canceled after N days").fill("3");
    await main.locator('[data-testid="resolved-auto-hide-save"]').click();
    await expect(main.getByLabel("Hide completed after N days")).toHaveValue(
      "14",
    );
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).settings)
      .toMatchObject({
        stale_hide_completed_days: 14,
        stale_hide_canceled_days: 3,
      });
  });

  test("creates, updates, and deletes an issue template from workspace settings", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");

    await expect(
      main.locator('[data-testid="templates-section"]'),
    ).toBeVisible();
    await main.locator('[data-testid="templates-new-button"]').click();
    await expect(
      main.locator('[data-testid="templates-editor"]'),
    ).toBeVisible();
    await main
      .locator('[data-testid="templates-name-input"]')
      .fill("e2e-template");
    await main
      .locator('[data-testid="templates-label-input"]')
      .fill("E2E Template");
    await main
      .locator('[data-testid="templates-description-input"]')
      .fill("Created by the hermetic settings workflow.");
    await main.locator('[data-testid="templates-editor-save"]').click();

    await expect(
      main.locator('[data-testid="templates-row-e2e-template"]'),
    ).toBeVisible();
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).templates)
      .toContainEqual(expect.objectContaining({ name: "e2e-template" }));

    await main.locator('[data-testid="templates-edit-e2e-template"]').click();
    await main
      .locator('[data-testid="templates-label-input"]')
      .fill("E2E Template Edited");
    await main.locator('[data-testid="templates-editor-save"]').click();
    await expect(
      main.locator('[data-testid="templates-row-e2e-template"]'),
    ).toContainText("E2E Template Edited");

    page.once("dialog", (dialog) => dialog.accept());
    await main.locator('[data-testid="templates-delete-e2e-template"]').click();
    await expect(
      main.locator('[data-testid="templates-row-e2e-template"]'),
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
    await page.goto("/workspace/reef-e2e/settings/workspace");
    const main = page.getByRole("main");

    // A workspace with no templates shows the seed-defaults call to action.
    await expect(
      main.locator('[data-testid="templates-section-empty"]'),
    ).toBeVisible();
    await main.locator('[data-testid="templates-seed-defaults"]').click();

    // All six canonical issue types land as rows; the legacy feature /
    // tech-debt templates are gone.
    for (const name of ["epic", "story", "task", "bug", "spike", "chore"]) {
      await expect(
        main.locator(`[data-testid="templates-row-${name}"]`),
      ).toBeVisible();
    }
    await expect(
      main.locator('[data-testid="templates-row-feature"]'),
    ).toHaveCount(0);
    await expect(
      main.locator('[data-testid="templates-row-tech-debt"]'),
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
    test.setTimeout(45_000);
    await openExistingWorkspace(page);
    const main = page.getByRole("main");

    await page.goto("/workspace/reef-e2e/settings");
    await page.waitForURL(/\/settings\/workspace$/, { timeout: 10_000 });
    await expect(
      main.locator('[data-testid="settings-group-workspace"]'),
    ).toBeVisible();

    await page.goto("/workspace/reef-e2e/settings/workspace/members");
    await page.waitForURL(/\/settings\/workspace\/members$/, {
      timeout: 10_000,
    });
    await expect(
      main.locator('[data-testid="settings-group-members"]'),
    ).toBeVisible();
    await expect(main.locator('[data-testid="members-section"]')).toBeVisible();
    await main
      .locator('[data-testid="member-directory-combobox"]')
      .getByRole("button")
      .click();
    await expect(page.getByTestId("directory-option-bob")).toContainText(
      "Bob Example",
    );

    await page.goto("/workspace/reef-e2e/settings/deployment");
    await expect(
      main.locator('[data-testid="settings-group-deployment"]'),
    ).toBeVisible();
    await expect(main.getByText("AI Configuration")).toBeVisible();
  });

  test("does not expose browser GitHub token controls in preferences (REEF-244)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/settings/preferences");

    await expect(
      page.getByRole("main").locator('[data-testid="settings-group-personal"]'),
    ).toBeVisible();
    await expect(page.getByLabel("GitHub Personal Access Token")).toHaveCount(
      0,
    );
    const main = page.getByRole("main");
    await expect(main.locator('[data-testid="save-token-btn"]')).toHaveCount(0);
    await expect(main.locator('[data-testid="disconnect-btn"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.locator('[data-testid="akb-login-form"]')).toHaveCount(0);
  });
});
