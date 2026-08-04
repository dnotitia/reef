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
      trigger: "@B",
      submit_label: "Comment",
      edit_label: "Edit comment",
      edit_draft_label: "Comment draft",
      edit_submit_label: "Save",
      credentials: {
        username_env: "REEF_E2E_USERNAME",
        password_env: "REEF_E2E_PASSWORD",
      },
      expected: {
        option_label: "Mention @Bob Smith",
        token: "@{Bob Smith}",
        body: "@Bob Smith ",
        canonical_body: "@{Bob Smith}",
        visible_label: "@Bob Smith",
      },
    });

    expect(observation.accessibleText).toContain("@Bob Smith");
  });

  test("Escape closes autocomplete without dismissing the composer or issue", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");

    let createRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/comments")
      ) {
        createRequests += 1;
      }
    });

    const composer = page.getByRole("textbox", {
      name: "Add a comment",
      exact: true,
    });
    await composer.fill("@B");
    await expect(
      page.getByRole("option", { name: "Mention @Bob Smith", exact: true }),
    ).toBeVisible();

    await composer.press("Escape");

    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue("@B");
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/REEF-001\/?$/);
    expect(createRequests).toBe(0);
  });
});
