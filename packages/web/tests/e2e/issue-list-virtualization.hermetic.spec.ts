import { expect, test } from "@playwright/test";
import { runLargeIssueListBehavior } from "./behaviors/issue-list-virtualization.cjs";
import { createFixtureControl } from "./behaviors/runtime.cjs";
import {
  E2E_MOCK_URL,
  openExistingWorkspace,
  resetFixture,
  signInAsAlice,
} from "./harness/fixture";

test.describe("large issue list virtualization", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "large_vault");
  });

  test("runs the canonical virtualization, recovery, keyboard, edit, and layout behavior", async ({
    context,
    page,
    request,
  }) => {
    await openExistingWorkspace(page, "reef-e2e");
    await runLargeIssueListBehavior({
      page,
      context,
      expect,
      fixture: createFixtureControl(request, E2E_MOCK_URL),
      relogin: (targetPage = page) => signInAsAlice(targetPage),
      workspace: "reef-e2e",
    });
  });
});
