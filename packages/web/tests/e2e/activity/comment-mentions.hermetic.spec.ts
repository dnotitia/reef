import { type Page, expect, test } from "../harness/test";
import { openExistingWorkspace, resetFixture } from "../harness/fixture";

async function exerciseCommentMention(page: Page) {
  const composer = page.getByRole("textbox", {
    name: "Add a comment",
    exact: true,
  });
  await expect(composer).toBeVisible();
  await composer.fill("@B");

  const option = page.getByRole("option", {
    name: "Mention @Bob Smith",
    exact: true,
  });
  await expect(option).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("@Bob Smith ");
  expect(await composer.inputValue()).not.toMatch(/[{}\\]/u);

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/comments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Comment", exact: true })
    .last()
    .click();
  const created = await createResponse;
  expect(created.ok()).toBeTruthy();
  expect((await created.json()).comment.body).toBe("@{Bob Smith}");

  const mention = page.locator("[data-reef-mention]").last();
  await expect(mention).toBeVisible();
  await expect(mention).toHaveText("@Bob Smith");
  const rendered = await mention.evaluate((element) => ({
    tag: element.tagName,
    link: element.closest("a") !== null,
    mentionValue: element.getAttribute("data-reef-mention"),
  }));
  expect(rendered.tag).toBe("SPAN");
  expect(rendered.link).toBe(false);
  expect(rendered.mentionValue).toBe("Bob Smith");
  const style = await mention.evaluate((element) => {
    const computed = getComputedStyle(element);
    const root = element.closest(".comment-mention-renderer");
    const probe = document.createElement("span");
    probe.style.color = "var(--brand-text)";
    root?.append(probe);
    const brandColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      fontWeight: Number.parseInt(computed.fontWeight, 10),
      color: computed.color,
      brandColor,
    };
  });
  expect(style.fontWeight).toBeGreaterThanOrEqual(500);
  expect(style.color).toBe(style.brandColor);

  const editButton = page
    .getByRole("button", { name: "Edit comment", exact: true })
    .last();
  await editButton.click();
  const editDraft = page.getByRole("textbox", {
    name: "Comment draft",
    exact: true,
  });
  await expect(editDraft).toBeVisible();
  await expect(editDraft).toHaveValue("@Bob Smith");
  expect(await editDraft.inputValue()).not.toMatch(/[{}\\]/u);

  await editDraft.fill("@B");
  await expect(
    page.getByRole("option", { name: "Mention @Bob Smith", exact: true }),
  ).toBeVisible();
  await editDraft.press("Enter");
  await expect(editDraft).toHaveValue("@Bob Smith ");

  const updateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.includes("/comments/") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const updated = await updateResponse;
  expect(updated.ok()).toBeTruthy();
  expect((await updated.json()).comment.body).toBe("@{Bob Smith}");

  const editedMention = page.locator("[data-reef-mention]").last();
  await expect(editedMention).toBeVisible();
  const thread = editedMention
    .locator("xpath=ancestor::*[@data-testid='comment-thread']")
    .first();
  return thread.ariaSnapshot();
}

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

    const accessibleText = await exerciseCommentMention(page);

    expect(accessibleText).toContain("@Bob Smith");
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
    await expect(composer).toHaveValue("@Bob Smith ");
    await expect(composer).toBeFocused();
    await composer.press("End");
    await expect
      .poll(() =>
        composer.evaluate((element) => {
          const textarea = element as HTMLTextAreaElement;
          return {
            end: textarea.value.length,
            selectionEnd: textarea.selectionEnd,
            selectionStart: textarea.selectionStart,
          };
        }),
      )
      .toEqual({
        end: "@Bob Smith ".length,
        selectionEnd: "@Bob Smith ".length,
        selectionStart: "@Bob Smith ".length,
      });
    for (const [index, character] of [..."hello"].entries()) {
      await composer.press(character);
      await expect(composer).toHaveValue(
        `@Bob Smith ${"hello".slice(0, index + 1)}`,
      );
    }

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

  test("deletes only the author's comment subtree after confirmation and persists after reload (REEF-520)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");

    const otherAuthorThread = page.getByTestId("comment-thread").first();
    await expect(
      otherAuthorThread.getByRole("button", { name: "Delete comment" }),
    ).toHaveCount(0);

    const composer = page.getByRole("textbox", {
      name: "Add a comment",
      exact: true,
    });
    await composer.fill("cascade root");
    await page
      .getByRole("button", { name: "Comment", exact: true })
      .last()
      .click();
    const rootThread = page
      .getByTestId("comment-thread")
      .filter({ hasText: "cascade root" })
      .last();
    await expect(rootThread).toBeVisible();

    await rootThread.getByRole("button", { name: "Reply" }).click();
    const replyComposer = rootThread.getByRole("textbox", {
      name: "Reply to alice",
      exact: true,
    });
    await replyComposer.fill("cascade reply");
    await replyComposer
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    await expect(
      rootThread.getByText("cascade reply", { exact: true }),
    ).toBeVisible();

    const replyRow = rootThread
      .getByTestId("comment-reply")
      .filter({ hasText: "cascade reply" });
    await replyRow.getByRole("button", { name: "Reply" }).click();
    const nestedComposer = rootThread.getByRole("textbox", {
      name: "Reply to alice",
      exact: true,
    });
    await nestedComposer.fill("cascade nested");
    await nestedComposer
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    await expect(
      rootThread.getByText("cascade nested", { exact: true }),
    ).toBeVisible();

    const rootCommentId = (
      await rootThread.getByTestId("comment-card").first().getAttribute("id")
    )?.replace(/^comment-/u, "");
    expect(rootCommentId).toBeTruthy();

    await rootThread
      .getByRole("button", { name: "Delete comment" })
      .first()
      .click();
    await expect(page.getByTestId("comment-delete-confirm")).toBeVisible();
    await page.getByTestId("comment-delete-cancel").click();
    await expect(
      rootThread.getByText("cascade root", { exact: true }),
    ).toBeVisible();

    await rootThread
      .getByRole("button", { name: "Delete comment" })
      .first()
      .click();
    const deleteResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes(
          `/comments/${rootCommentId}`,
        ) && response.request().method() === "DELETE",
    );
    await page.getByTestId("comment-delete-confirm-btn").click();
    const deleted = await deleteResponse;
    expect(deleted.ok()).toBeTruthy();
    expect((await deleted.json()).deleted_comment_ids).toHaveLength(3);

    await expect(page.getByText("cascade root", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText("cascade reply", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText("cascade nested", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText(/Kicking this off/, { exact: false }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByText("cascade root", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText("cascade reply", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText("cascade nested", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText(/Kicking this off/, { exact: false }),
    ).toBeVisible();
  });
});
