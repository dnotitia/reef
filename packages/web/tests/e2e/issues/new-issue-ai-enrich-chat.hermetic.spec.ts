import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setLlmControl,
} from "../harness/fixture";

async function openNewIssue(page: Page): Promise<Locator> {
  await openExistingWorkspace(page);
  await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
  await page.getByTestId("new-issue-trigger").click();
  const dialog = page.getByTestId("new-issue-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillSourceBody(dialog: Locator, body: string) {
  const source = dialog.getByTestId("markdown-source-textarea");
  if (!(await source.isVisible())) {
    await dialog
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
  }
  await source.fill(body);
}

function runRequestBody(request: { postDataJSON(): unknown }) {
  return request.postDataJSON() as {
    task_id: string;
    input: {
      messages: Array<{ role: string; parts: Array<{ text: string }> }>;
      draft?: {
        fields: { title?: string };
        content: string;
      };
    };
  };
}

test.describe("Hermetic New Issue AI enrich chat", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("sends the latest draft and full conversation, then creates independently", async ({
    page,
    request,
  }) => {
    const dialog = await openNewIssue(page);
    await dialog.getByTestId("new-issue-title-input").fill("First draft title");
    await fillSourceBody(dialog, "First draft body");
    await dialog.getByTestId("new-issue-chat-trigger").click();
    await expect(dialog.getByTestId("new-issue-chat-panel")).toBeVisible();

    const firstRequest = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/agents/runs",
    );
    await dialog
      .getByTestId("new-issue-chat-input")
      .fill("What should I improve?");
    await dialog.getByTestId("new-issue-chat-send").click();
    const firstBody = runRequestBody(await firstRequest);
    expect(firstBody.task_id).toBe("chat.workspace");
    expect(firstBody.input.messages).toHaveLength(1);
    expect(firstBody.input.draft).toMatchObject({
      fields: { title: "First draft title" },
      content: "First draft body",
    });
    await expect(dialog.getByTestId("assistant-message")).toContainText(
      "Request: What should I improve?",
    );

    await dialog
      .getByTestId("new-issue-title-input")
      .fill("Edited draft title");
    await fillSourceBody(dialog, "Edited draft body");
    const secondRequest = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/agents/runs",
    );
    await dialog.getByTestId("new-issue-chat-input").fill("And now?");
    await dialog.getByTestId("new-issue-chat-send").click();
    const secondBody = runRequestBody(await secondRequest);
    expect(secondBody.task_id).toBe("chat.workspace");
    expect(secondBody.input.messages).toHaveLength(3);
    expect(secondBody.input.draft).toMatchObject({
      fields: { title: "Edited draft title" },
      content: "Edited draft body",
    });
    await expect(dialog.getByTestId("assistant-message").last()).toContainText(
      "Request: And now?",
    );

    await dialog.getByTestId("new-issue-submit").click();
    await page.waitForURL(/\/issues\/REEF-004$/, { timeout: 10_000 });
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const state = await readFixtureState(request);
    const vault = state.vaults.find(
      (candidate) => candidate.name === REEF_E2E_VAULT,
    );
    expect(
      vault?.issues.find((issue) => issue.id === "REEF-004"),
    ).toMatchObject({
      id: "REEF-004",
      title: "Edited draft title",
    });
    expect(
      vault?.documents.find((document) => document.path.endsWith("reef-004.md"))
        ?.content,
    ).toBe("Edited draft body");
    expect(state.calls.some((call) => call.path === "/api/chat")).toBe(false);
  });

  test("suppresses overlapping sends while the canonical run is busy", async ({
    page,
    request,
  }) => {
    await setLlmControl(request, { delayMs: 600 });
    const dialog = await openNewIssue(page);
    await dialog.getByTestId("new-issue-chat-trigger").click();
    const runBodies: unknown[] = [];
    const onRequest = (candidate: Request) => {
      if (
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/agents/runs"
      ) {
        runBodies.push(candidate.postDataJSON());
      }
    };
    page.on("request", onRequest);
    const input = dialog.getByTestId("new-issue-chat-input");
    const send = dialog.getByTestId("new-issue-chat-send");
    await input.fill("Only one run");
    await send.click();
    await expect.poll(() => runBodies.length).toBe(1);
    await expect(send).toHaveAttribute("aria-label", "Stop");
    await input.evaluate((element) => {
      element.closest("form")?.requestSubmit();
    });
    await expect.poll(() => runBodies.length).toBe(1);
    await expect(dialog.getByTestId("assistant-message")).toContainText(
      "Request: Only one run",
      { timeout: 15_000 },
    );
    page.off("request", onRequest);
  });

  test("keeps the form intact on an AI failure and retries the same turn", async ({
    page,
    request,
  }) => {
    await setLlmControl(request, { failures: 1 });
    const dialog = await openNewIssue(page);
    await dialog
      .getByTestId("new-issue-title-input")
      .fill("Manual title survives");
    await fillSourceBody(dialog, "Manual body survives");
    await dialog.getByTestId("new-issue-chat-trigger").click();

    const failedRequest = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/agents/runs",
    );
    await dialog.getByTestId("new-issue-chat-input").fill("Please advise");
    await dialog.getByTestId("new-issue-chat-send").click();
    await failedRequest;
    await expect(dialog.getByTestId("new-issue-chat-retry")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByTestId("new-issue-title-input")).toHaveValue(
      "Manual title survives",
    );
    await expect(dialog.getByTestId("markdown-source-textarea")).toHaveValue(
      "Manual body survives",
    );

    const retryRequest = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/agents/runs",
    );
    await dialog.getByTestId("new-issue-chat-retry").click();
    const retryBody = runRequestBody(await retryRequest);
    expect(retryBody.task_id).toBe("chat.workspace");
    expect(retryBody.input.messages).toHaveLength(1);
    expect(retryBody.input.draft).toMatchObject({
      fields: { title: "Manual title survives" },
      content: "Manual body survives",
    });
    await expect(dialog.getByTestId("assistant-message")).toContainText(
      "Request: Please advise",
      { timeout: 15_000 },
    );
  });
});
