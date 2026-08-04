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

  test("escapes an edited or unresolved ordinary label at the save boundary", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");

    const composer = page.getByRole("textbox", {
      name: "Add a comment",
      exact: true,
    });
    await composer.fill("@B");
    await page
      .getByRole("option", { name: "Mention @Bob Smith", exact: true })
      .waitFor({ state: "visible" });
    await composer.press("Enter");
    await composer.press("End");
    await composer.type("hello");

    const createResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/comments") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const created = await createResponse;
    expect(created.ok()).toBeTruthy();
    expect((await created.json()).comment.body).toBe("@{Bob Smith} hello");

    const thread = page.getByTestId("comment-thread").last();
    await expect(
      thread.getByRole("button", { name: "Edit comment", exact: true }),
    ).toBeVisible();
    await thread
      .getByRole("button", { name: "Edit comment", exact: true })
      .click();
    const editDraft = page.getByRole("textbox", {
      name: "Comment draft",
      exact: true,
    });
    await expect(editDraft).toHaveValue("@Bob Smith hello");
    expect(await editDraft.inputValue()).not.toMatch(/[{}\\]/u);

    await editDraft.press("Home");
    for (let index = 0; index < 7; index += 1) {
      await editDraft.press("ArrowRight");
    }
    await editDraft.press("Delete");
    await editDraft.type("y");
    await expect(editDraft).toHaveValue("@Bob Smyth hello");
    expect(await editDraft.inputValue()).not.toMatch(/[{}\\]/u);

    const updateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes("/comments/") &&
        response.request().method() === "PATCH",
    );
    await thread.getByRole("button", { name: "Save", exact: true }).click();
    const updated = await updateResponse;
    expect(updated.ok()).toBeTruthy();
    expect((await updated.json()).comment.body).toBe("\\@Bob Smyth hello");
    await expect(thread.locator("[data-reef-mention]")).toHaveCount(0);
    await expect(
      thread.getByText("@Bob Smyth hello", { exact: true }),
    ).toBeVisible();

    await composer.fill("@Nobody");
    const unresolvedCreateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/comments") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const unresolvedCreated = await unresolvedCreateResponse;
    expect(unresolvedCreated.ok()).toBeTruthy();
    expect((await unresolvedCreated.json()).comment.body).toBe("\\@Nobody");

    const unresolvedThread = page.getByTestId("comment-thread").last();
    await expect(
      unresolvedThread.getByText("@Nobody", { exact: true }),
    ).toBeVisible();
    await expect(unresolvedThread.locator("[data-reef-mention]")).toHaveCount(
      0,
    );
  });
});
