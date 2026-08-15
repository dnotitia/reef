import { type APIRequestContext, expect, test } from "@playwright/test";
import {
  E2E_MOCK_URL,
  openExistingWorkspace,
  resetFixture,
} from "../harness/fixture";

const HEIGHT_KEY = "reef:issue-description-height:v1";
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 960;
const VIEWPORT_RESERVATION = 160;
const DESKTOP_MIN_WIDTH = 1280;
const KEYBOARD_STEP = 32;

interface MarkdownFixtureTask {
  scenario?: string;
  workspace?: string;
  start_path?: string;
  interaction?: { type?: string; operation?: string };
}

async function readMarkdownFixtureTask(
  request: APIRequestContext,
): Promise<MarkdownFixtureTask> {
  const response = await request.get(`${E2E_MOCK_URL}/__e2e/runtime`);
  expect(response.ok()).toBeTruthy();
  const contract = (await response.json()) as {
    tasks?: Record<string, MarkdownFixtureTask>;
  };
  const task = contract.tasks?.markdown_fixture;
  if (!task?.start_path) {
    throw new Error("Runtime discovery did not publish the Markdown fixture");
  }
  return task;
}

function getMaxHeight(viewportHeight: number) {
  return Math.max(
    MIN_HEIGHT,
    Math.min(MAX_HEIGHT, viewportHeight - VIEWPORT_RESERVATION),
  );
}

test.describe("Hermetic issue description height resize", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "markdown_fixture");
  });

  test("supports pointer, keyboard, mode sharing, session restore, and narrow opt-out", async ({
    page,
    request,
  }) => {
    const viewport = { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    const task = await readMarkdownFixtureTask(request);
    expect(task).toMatchObject({
      scenario: "markdown_fixture",
      interaction: { type: "markdown_editor" },
    });
    const startPath = task.start_path;
    if (!startPath) throw new Error("Missing Markdown fixture start path");

    await openExistingWorkspace(page);
    await page.goto(startPath);
    await expect(page.getByTestId("issue-detail")).toBeVisible();

    const frame = page.getByTestId("markdown-editor-body-frame");
    const handle = page.getByTestId("markdown-editor-resize-handle");
    await expect(frame).toBeVisible();
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute("role", "separator");
    await expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    await expect(handle).toHaveAttribute("aria-valuemin", String(MIN_HEIGHT));
    await expect(handle).toHaveAttribute(
      "aria-valuemax",
      String(getMaxHeight(viewport.height)),
    );
    await expect(handle).toHaveAttribute(
      "aria-controls",
      "markdown-editor-body-frame",
    );
    await expect(handle).toHaveAttribute(
      "aria-describedby",
      "markdown-editor-resize-description",
    );

    await expect
      .poll(async () => Number(await handle.getAttribute("aria-valuenow")))
      .toBeGreaterThan(MIN_HEIGHT);
    const initialHeight = Number(await handle.getAttribute("aria-valuenow"));
    expect(initialHeight).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(initialHeight).toBeLessThanOrEqual(getMaxHeight(viewport.height));

    await handle.focus();
    await page.keyboard.press("ArrowDown");
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(
        Math.min(initialHeight + KEYBOARD_STEP, getMaxHeight(viewport.height)),
      ),
    );
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", String(MIN_HEIGHT));
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(getMaxHeight(viewport.height)),
    );
    await expect(handle).toBeFocused();

    const sourceToggle = page
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await sourceToggle.click();
    await expect(page.getByTestId("markdown-source-textarea")).toHaveClass(
      /resize-none/,
    );
    await expect(frame).toHaveAttribute("style", /height: 740px/);
    await sourceToggle.click();
    await expect(page.locator(".reef-markdown-editor")).toBeVisible();
    await expect(handle).toHaveAttribute("aria-valuenow", "740");

    await handle.focus();
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", String(MIN_HEIGHT));
    await expect(frame).toHaveAttribute(
      "style",
      new RegExp(`height: ${MIN_HEIGHT}px`),
    );
    const box = await handle.boundingBox();
    if (!box) throw new Error("Description resize handle is not laid out");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 96, {
      steps: 3,
    });
    await page.mouse.up();
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(MIN_HEIGHT + 96),
    );
    await expect(handle).toHaveAttribute("data-resizing", "false");
    await expect(
      page.locator("[data-testid='markdown-editor-resize-handle']"),
    ).toBeFocused();

    await page.evaluate((key) => {
      window.sessionStorage.setItem(key, "420");
    }, HEIGHT_KEY);
    await page.reload();
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(
      page.getByTestId("markdown-editor-resize-handle"),
    ).toHaveAttribute("aria-valuenow", "420");

    await page.setViewportSize({ width: DESKTOP_MIN_WIDTH - 1, height: 900 });
    await expect(page.getByTestId("markdown-editor-resize-handle")).toHaveCount(
      0,
    );
    await expect(frame).not.toHaveAttribute("style", /height:/);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.setViewportSize(viewport);
    await expect(
      page.getByTestId("markdown-editor-resize-handle"),
    ).toBeVisible();
    await expect(
      page.getByTestId("markdown-editor-resize-handle"),
    ).toHaveAttribute("aria-valuenow", "420");
  });
});
