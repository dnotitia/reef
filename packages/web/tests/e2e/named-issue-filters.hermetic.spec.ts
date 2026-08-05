import { type Page, expect, test } from "@playwright/test";
import { runNamedIssueFiltersBehavior } from "./behaviors/named-issue-filters.cjs";
import {
  continueToWorkspace,
  resetFixture,
  signInAsAlice,
} from "./harness/fixture";

async function openMultiVaultWorkspace(
  page: Page,
  vault: string,
): Promise<void> {
  await signInAsAlice(page);
  await page.goto(`/workspace/${vault}/issues`);
  await continueToWorkspace(page, vault);
}

test.describe("Hermetic named issue filters", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_multi");
  });

  test("runs the canonical named-filter persistence and isolation behavior", async ({
    page,
  }) => {
    await openMultiVaultWorkspace(page, "reef-e2e");
    await runNamedIssueFiltersBehavior({
      page,
      expect,
      relogin: async () => {
        await signInAsAlice(page);
        await page.goto("/workspace/reef-e2e/issues");
        await continueToWorkspace(page, "reef-e2e");
      },
    });
  });
});
