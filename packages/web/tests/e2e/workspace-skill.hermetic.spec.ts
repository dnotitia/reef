import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "./harness/fixture";

type FixtureState = Awaited<ReturnType<typeof readFixtureState>>;

function reefVault(state: FixtureState): FixtureState["vaults"][number] {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

test.describe("Hermetic workspace skill update workflow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "skill_outdated");
  });

  test("applies the workspace AI instruction update, stamps the version, and reflects drift in the sidebar Settings badge (REEF-257)", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

    // REEF-257 AC1: the drift lights the sidebar Settings badge on the landing
    // route (/issues), so it is discoverable without opening settings.
    await expect(page.getByTestId("workspace-skill-badge")).toBeVisible();

    const before = reefVault(await readFixtureState(request));
    expect(before.settings.vault_skill).toMatchObject({ version: 9 });
    expect(
      before.documents.find((doc) => doc.path === "overview/vault-skill.md")
        ?.content,
    ).toBe("OUTDATED MANUAL SKILL CONTENT");

    await page.goto("/settings/workspace");
    await expect(
      page.getByText("Newer AI instructions are available."),
    ).toBeVisible();
    // The badge yields once Settings is active — the page now owns the drift
    // detail, so the sidebar dot would be redundant.
    await expect(page.getByTestId("workspace-skill-badge")).toHaveCount(0);
    await page.locator('[data-testid="update-skill-btn"]').click();
    await expect(
      page.locator('[data-testid="confirm-skill-update"]'),
    ).toBeVisible();

    await page.locator('[data-testid="confirm-skill-update"]').click();
    await expect(
      page.getByText("This workspace runs the current AI playbooks."),
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => reefVault(await readFixtureState(request)).settings)
      .toMatchObject({
        vault_skill: { version: 14 },
      });
    await expect
      .poll(async () => {
        const doc = reefVault(await readFixtureState(request)).documents.find(
          (candidate) => candidate.path === "overview/vault-skill.md",
        );
        return doc?.content;
      })
      .toContain("# reef-e2e Reef PM Workspace Skill");
    await expect
      .poll(async () =>
        reefVault(await readFixtureState(request)).documents.map(
          (doc) => doc.path,
        ),
      )
      .toEqual(
        expect.arrayContaining([
          "overview/vault-skill.md",
          "overview/reef/activity-inbox-workflows.md",
        ]),
      );

    // REEF-257 AC2: once the workspace is up to date, the sidebar badge is gone.
    // Checked off the settings route (where the active state would hide it
    // regardless) — the vault is now stamped current, so even a fresh load
    // resolves up_to_date and the badge stays dark.
    await page.goto("/issues");
    await expect(page.getByTestId("workspace-skill-badge")).toHaveCount(0);
  });
});
