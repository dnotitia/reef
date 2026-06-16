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

  test("applies the workspace AI instruction update and stamps the current skill version", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

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
        vault_skill: { version: 10 },
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
  });
});
