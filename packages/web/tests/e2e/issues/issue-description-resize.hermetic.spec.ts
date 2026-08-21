import { type APIRequestContext, expect, test } from "@playwright/test";
import {
  E2E_MOCK_URL,
  openExistingWorkspace,
  resetFixture,
} from "../harness/fixture";

const HEIGHT_KEY = "reef:issue-description-height:v1";
const MIN_HEIGHT = 200;
const DEFAULT_HEIGHT = 320;
const MAX_HEIGHT = 960;
const VIEWPORT_RESERVATION = 160;
const RESIZE_MIN_WIDTH = 1024;
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
    const editor = page.getByTestId("markdown-editor");
    await expect(frame).toBeVisible();
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(DEFAULT_HEIGHT),
    );
    await expect(frame).toHaveAttribute(
      "style",
      new RegExp(`height: ${DEFAULT_HEIGHT}px`),
    );

    // The New Issue Description opts into the same editor contract. With no
    // saved value it starts at 320px, and a user adjustment is visible when
    // the same tab returns to the existing issue.
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByTestId("new-issue-trigger").click();
    const createDialog = page.getByTestId("new-issue-dialog");
    const createFrame = createDialog.getByTestId("markdown-editor-body-frame");
    const createHandle = createDialog.getByTestId(
      "markdown-editor-resize-handle",
    );
    await expect(createHandle).toBeVisible();
    await expect(createHandle).toHaveAttribute(
      "aria-valuenow",
      String(DEFAULT_HEIGHT),
    );
    await expect(createFrame).toHaveAttribute(
      "style",
      new RegExp(`height: ${DEFAULT_HEIGHT}px`),
    );
    await createHandle.focus();
    await page.keyboard.press("ArrowDown");
    await expect(createHandle).toHaveAttribute(
      "aria-valuenow",
      String(DEFAULT_HEIGHT + KEYBOARD_STEP),
    );
    await createDialog.getByTestId("new-issue-cancel").click();

    await page.goto(startPath);
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(DEFAULT_HEIGHT + KEYBOARD_STEP),
    );

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

    const handleBeforeBodyScroll = await handle.boundingBox();
    if (!handleBeforeBodyScroll) {
      throw new Error("Description resize handle is not laid out");
    }
    const bodyScroll = await frame.evaluate((frame) => {
      const editable = frame.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      );
      const contentSurface = editable?.parentElement;
      const scrollOwner = [contentSurface, editable, frame].find(
        (candidate) => {
          if (!candidate) return false;
          const { overflow, overflowY } = getComputedStyle(candidate);
          const canScroll =
            overflow === "auto" ||
            overflow === "scroll" ||
            overflowY === "auto" ||
            overflowY === "scroll";
          return canScroll && candidate.scrollHeight > candidate.clientHeight;
        },
      );
      if (!scrollOwner) {
        throw new Error("Markdown editor body has no scroll owner");
      }
      const maxScrollTop = Math.max(
        0,
        scrollOwner.scrollHeight - scrollOwner.clientHeight,
      );
      scrollOwner.scrollTop = Math.min(160, maxScrollTop);
      return {
        scrollTop: scrollOwner.scrollTop,
        scrollHeight: scrollOwner.scrollHeight,
        clientHeight: scrollOwner.clientHeight,
      };
    });
    expect(bodyScroll.scrollHeight).toBeGreaterThan(bodyScroll.clientHeight);
    expect(bodyScroll.scrollTop).toBeGreaterThan(0);
    const handleAfterBodyScroll = await handle.boundingBox();
    if (!handleAfterBodyScroll) {
      throw new Error("Description resize handle disappeared after scrolling");
    }
    expect(handleAfterBodyScroll.x).toBeCloseTo(handleBeforeBodyScroll.x, 1);
    expect(handleAfterBodyScroll.y).toBeCloseTo(handleBeforeBodyScroll.y, 1);

    const edgeGeometry = await editor.evaluate((root) => {
      const frame = root.querySelector<HTMLElement>(
        '[data-testid="markdown-editor-body-frame"]',
      );
      const handle = root.querySelector<HTMLElement>(
        '[data-testid="markdown-editor-resize-handle"]',
      );
      if (!frame || !handle) {
        throw new Error("Markdown editor resize geometry is not mounted");
      }
      const rootRect = root.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      return {
        rootRightGap: rootRect.right - frameRect.right,
        rootBottomGap: rootRect.bottom - frameRect.bottom,
        verticalScrollbarWidth: frame.offsetWidth - frame.clientWidth,
        horizontalScrollbarHeight: frame.offsetHeight - frame.clientHeight,
        handleRight: handleRect.right,
        handleBottom: handleRect.bottom,
        frameRight: frameRect.right,
        frameBottom: frameRect.bottom,
        handleWidth: handleRect.width,
        handleHeight: handleRect.height,
      };
    });
    // The fixed frame keeps the resize chrome aligned with its bottom-right
    // edge while the editor body owns scrolling inside the frame.
    expect(edgeGeometry.rootRightGap).toBeGreaterThanOrEqual(4);
    expect(edgeGeometry.rootBottomGap).toBeGreaterThanOrEqual(4);
    expect(edgeGeometry.handleRight).toBeLessThanOrEqual(
      edgeGeometry.frameRight - edgeGeometry.verticalScrollbarWidth + 0.5,
    );
    expect(edgeGeometry.handleBottom).toBeLessThanOrEqual(
      edgeGeometry.frameBottom - edgeGeometry.horizontalScrollbarHeight + 0.5,
    );
    expect(edgeGeometry.handleWidth).toBeGreaterThanOrEqual(32);
    expect(edgeGeometry.handleHeight).toBeGreaterThanOrEqual(32);
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
    await handle.scrollIntoViewIfNeeded();
    await handle.hover();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Description resize handle is not laid out");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await expect(handle).toHaveAttribute("data-resizing", "true");
    await page.mouse.move(startX, startY + 96, { steps: 3 });
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

    // A Retina/zoomed desktop can expose a CSS viewport below the sheet's
    // 1280px breakpoint while still leaving the description editor wide enough
    // for a mouse resize affordance.
    await page.setViewportSize({ width: 1237, height: 900 });
    await expect(
      page.getByTestId("markdown-editor-resize-handle"),
    ).toBeVisible();

    await page.setViewportSize({ width: RESIZE_MIN_WIDTH - 1, height: 900 });
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
