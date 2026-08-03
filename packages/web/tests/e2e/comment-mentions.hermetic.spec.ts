import { expect, test } from "@playwright/test";
import { observeCommentMentions } from "../../scripts/e2e-user-behavior-runner.cjs";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

test.describe("Comment mentions (REEF-452)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "comment_mentions");
  });

  test("selects an exact-case roster token and renders a non-clickable mention", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");

    const observation = await observeCommentMentions(page, {
      schema_version: 1,
      scenario: "comment-mentions",
      clause_id: "comment-mentions-user-visible",
      target_url: "http://localhost:7353",
      workspace: "reef-e2e",
      issue_id: "REEF-001",
      composer_label: "Add a comment",
      trigger: "@{B",
      submit_label: "Comment",
      credentials: {
        username_env: "REEF_E2E_USERNAME",
        password_env: "REEF_E2E_PASSWORD",
      },
      expected: {
        option_label: "Mention @{Bob Smith}",
        token: "@{Bob Smith}",
        body: "@{Bob Smith} ",
        visible_label: "@Bob Smith",
      },
    });

    expect(observation.accessibleText).toContain("@Bob Smith");
  });
});
