import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  resetFixture,
} from "../harness/fixture";

test.describe("Hermetic New Issue draft conversation", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("opens beside the draft, sends the latest draft with conversation history, and folds without losing edits", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await page.getByTestId("new-issue-trigger").click();

    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    const closedBox = await dialog.boundingBox();
    if (!closedBox) throw new Error("New Issue dialog has no closed geometry");

    const agentRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/agents/runs") {
        agentRequests.push(request.url());
      }
    });

    await dialog.getByTestId("new-issue-title-input").fill("Draft title");
    await dialog
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await dialog.getByTestId("markdown-source-textarea").fill("First body");

    await expect(
      dialog.getByTestId("draft-conversation-toggle"),
    ).toHaveAttribute("aria-controls", "draft-conversation-panel");
    await dialog.getByTestId("draft-conversation-toggle").click();
    const panel = dialog.getByTestId("draft-conversation-panel");
    const conversationToggle = dialog.getByTestId("draft-conversation-toggle");
    await expect(panel).toBeVisible();
    await expect(dialog.getByTestId("new-issue-chat-input")).toBeVisible();
    await expect(conversationToggle).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "AI chat" })).toBeVisible();
    await expect(panel.getByTestId("draft-conversation-close")).toHaveCount(1);
    expect(await panel.getAttribute("class")).not.toMatch(
      /rounded-lg|border-ai-border|bg-surface-elevated/,
    );
    await expect(dialog.getByTestId("enrich-trigger")).not.toHaveClass(/bg-ai/);
    await expect(
      dialog.getByTestId("enrich-trigger").locator("svg"),
    ).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "AI chat" })).toBeVisible();
    await expect(panel.getByTestId("draft-conversation-context")).toHaveCount(
      0,
    );
    await expect(
      panel.getByText(
        "Ask for suggestions while you shape this issue. Nothing is applied automatically.",
      ),
    ).toHaveCount(0);
    await expect(panel).toHaveAttribute("id", "draft-conversation-panel");
    expect(agentRequests).toHaveLength(0);

    await expect
      .poll(async () => (await dialog.boundingBox())?.width ?? 0, {
        timeout: 2_000,
      })
      .toBeGreaterThan(closedBox.width);
    const openBox = await dialog.boundingBox();
    if (!openBox) throw new Error("New Issue dialog has no chat geometry");
    expect(openBox.width).toBeGreaterThan(closedBox.width);
    expect(openBox.x + openBox.width).toBeLessThanOrEqual(1920);

    const descriptionBox = await dialog
      .getByText("Description", { exact: true })
      .boundingBox();
    const planningBox = await dialog
      .getByText("Planning", { exact: true })
      .boundingBox();
    const chatBox = await dialog
      .getByTestId("draft-conversation-panel")
      .boundingBox();
    if (!descriptionBox || !planningBox || !chatBox) {
      throw new Error("Draft conversation columns did not render");
    }
    // The wide canvas keeps authoring, the 400px property rail, and AI in
    // separate left-to-right columns.
    expect(descriptionBox.x).toBeLessThan(planningBox.x);
    expect(planningBox.x).toBeLessThan(chatBox.x);

    const firstRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/agents/runs",
    );
    await dialog.getByTestId("new-issue-chat-input").fill("Clarify this");
    await dialog.getByTestId("new-issue-chat-send").dblclick();
    const firstBody = (await firstRequest).postDataJSON();
    expect(firstBody).toMatchObject({
      task_id: "chat.workspace",
      input: {
        draft: {
          fields: { title: "Draft title", issue_type: "task" },
          content: "First body",
        },
      },
    });
    await expect(
      dialog
        .getByTestId("assistant-message")
        .last()
        .filter({ hasText: "Request: Clarify this" }),
    ).toBeVisible();
    await expect(dialog.getByTestId("user-message")).toHaveCount(1);

    await dialog.getByTestId("new-issue-title-input").fill("Updated title");
    await dialog.getByTestId("markdown-source-textarea").fill("Updated body");

    const secondRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/agents/runs",
    );
    await dialog
      .getByTestId("new-issue-chat-input")
      .fill("Use the latest draft");
    await dialog.getByTestId("new-issue-chat-send").click();
    const secondBody = (await secondRequest).postDataJSON();
    expect(secondBody.input.draft).toMatchObject({
      fields: { title: "Updated title" },
      content: "Updated body",
    });
    expect(secondBody.input.messages).toEqual([
      expect.objectContaining({
        role: "user",
        parts: [{ type: "text", text: "Clarify this" }],
      }),
      expect.objectContaining({
        role: "assistant",
        parts: [
          { type: "text", text: expect.stringContaining("Clarify this") },
        ],
      }),
      expect.objectContaining({
        role: "user",
        parts: [{ type: "text", text: "Use the latest draft" }],
      }),
    ]);
    await expect(
      dialog
        .getByTestId("assistant-message")
        .last()
        .filter({ hasText: "Request: Use the latest draft" }),
    ).toBeVisible();

    const unsentQuestion = dialog.getByTestId("new-issue-chat-input");
    await unsentQuestion.fill("Keep this unsent question");
    const panelClose = dialog.getByTestId("draft-conversation-close");
    await panelClose.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeHidden();
    await expect(conversationToggle).toBeFocused();
    await conversationToggle.click();
    await expect(unsentQuestion).toHaveValue("Keep this unsent question");
    await panelClose.click();
    await expect(panel).toBeHidden();
    await expect(dialog.getByTestId("new-issue-title-input")).toHaveValue(
      "Updated title",
    );
    await expect(dialog.getByTestId("markdown-source-textarea")).toHaveValue(
      "Updated body",
    );

    await dialog.getByTestId("new-issue-cancel").click();
    await page.getByTestId("discard-draft-confirm-button").click();
    await expect(dialog).toBeHidden();
  });

  test("keeps authoring and AI as a two-column surface, then switches views on a narrow screen", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");

    await page.setViewportSize({ width: 1280, height: 720 });
    await dialog.getByTestId("draft-conversation-toggle").click();
    await expect(dialog.getByTestId("draft-conversation-panel")).toBeVisible();
    await expect(
      dialog.getByTestId("draft-conversation-authoring"),
    ).toBeVisible();
    const twoColumnGeometry = await dialog.evaluate((root) => {
      const authoring = root.querySelector(
        '[data-testid="draft-conversation-authoring"]',
      );
      const chat = root.querySelector(
        '[data-testid="draft-conversation-panel"]',
      );
      if (
        !(authoring instanceof HTMLElement) ||
        !(chat instanceof HTMLElement)
      ) {
        throw new Error("Two-column draft layout is missing");
      }
      return {
        authoring: authoring.getBoundingClientRect(),
        chat: chat.getBoundingClientRect(),
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(twoColumnGeometry.authoring.right).toBeLessThanOrEqual(
      twoColumnGeometry.chat.left,
    );
    expect(twoColumnGeometry.documentOverflow).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    const panel = dialog.getByTestId("draft-conversation-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("draft-conversation-close")).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "AI chat" })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByTestId("draft-conversation-authoring"),
    ).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.setViewportSize({ width: 375, height: 844 });
    const narrowInput = dialog.getByTestId("new-issue-chat-input");
    await narrowInput.fill("Unsent narrow question");
    await dialog.getByTestId("draft-view-draft").click();
    await expect(panel).toBeHidden();
    await expect(dialog.getByTestId("draft-view-draft")).toBeFocused();
    await dialog.getByTestId("draft-view-conversation").click();
    await expect(narrowInput).toHaveValue("Unsent narrow question");

    await dialog.getByTestId("draft-view-draft").click();
    await dialog.getByTestId("new-issue-cancel").click();
    await expect(page.getByTestId("discard-draft-confirm")).toBeVisible();
    await page.getByTestId("discard-draft-cancel").click();
    await dialog.getByTestId("draft-view-conversation").click();
    await expect(narrowInput).toHaveValue("Unsent narrow question");

    await dialog.getByTestId("draft-view-draft").click();
    await expect(dialog.getByTestId("draft-conversation-panel")).toBeHidden();
    await expect(dialog.getByTestId("draft-view-draft")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await dialog.getByTestId("draft-view-conversation").click();
    await expect(dialog.getByTestId("draft-conversation-panel")).toBeVisible();
    await expect(dialog.getByTestId("new-issue-chat-input")).toBeVisible();
  });

  test("keeps narrow draft controls and the chat input inside the viewport", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
      await page.getByTestId("new-issue-trigger").click();

      const dialog = page.getByTestId("new-issue-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("new-issue-title-input")).toBeVisible();
      await expect(dialog.getByTestId("new-issue-dialog-footer")).toBeVisible();
      await expect(dialog.getByTestId("draft-view-draft")).toBeVisible();
      await expect(dialog.getByTestId("draft-view-conversation")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);

      await dialog.getByTestId("draft-view-conversation").click();
      await expect(dialog.getByTestId("new-issue-chat-input")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await dialog.getByTestId("draft-view-draft").click();
      await dialog.getByTestId("new-issue-cancel").click();
      await expect(dialog).toBeHidden();
    }
  });

  test("keeps global and draft conversations isolated", async ({ page }) => {
    await openExistingWorkspace(page);

    await page.getByTestId("ask-ai-fab").click();
    const globalDialog = page.getByTestId("ask-ai-dialog");
    await globalDialog.getByTestId("ask-ai-input").fill("Global question");
    await globalDialog.getByTestId("ask-ai-send").click();
    await expect(
      globalDialog.getByTestId("assistant-message").last(),
    ).toContainText("Request: Global question", { timeout: 15_000 });
    await globalDialog.getByTestId("ask-ai-close").click();

    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await dialog.getByTestId("draft-conversation-toggle").click();
    const draftPanel = dialog.getByTestId("draft-conversation-panel");
    await draftPanel.getByTestId("new-issue-chat-input").fill("Draft question");
    await draftPanel.getByTestId("new-issue-chat-send").click();
    await expect(
      draftPanel.getByTestId("assistant-message").last(),
    ).toContainText("Request: Draft question", { timeout: 15_000 });
    await expect(
      draftPanel.getByTestId("assistant-message").last(),
    ).not.toContainText("Global question");

    await dialog.getByTestId("new-issue-cancel").click();
    await expect(dialog).toBeHidden();
    await page.getByTestId("ask-ai-fab").click();
    await expect(globalDialog).toHaveAttribute("aria-hidden", "false");
    await expect(
      globalDialog.getByTestId("assistant-message").last(),
    ).toContainText("Request: Global question");
    await expect(globalDialog).not.toContainText("Draft question");
  });
});
