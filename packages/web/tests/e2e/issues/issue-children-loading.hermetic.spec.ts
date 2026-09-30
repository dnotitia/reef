import { expect, test, type Page } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCache,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueListFailure,
  waitForIssueListIdle,
} from "../harness/fixture";

const ROOT = "REEF-101";
const MID = "REEF-102";
const SHORT_CHILD = "REEF-112";
const FRAME_KEY = "__reef_issue_children_frames";

interface IssueChildrenFrame {
  loading: boolean;
  empty: boolean;
  childIds: string[];
  progressNow: number | null;
  progressMax: number | null;
  sectionTop: number | null;
  sectionHeight: number | null;
  linkedDocumentsTop: number | null;
}

async function recordIssueChildrenFrames(page: Page): Promise<void> {
  await page.addInitScript((frameKey) => {
    try {
      sessionStorage.setItem(`${frameKey}:recording`, "1");
      sessionStorage.setItem(frameKey, "[]");
    } catch {
      // The initial about:blank document does not have origin storage access.
    }

    const visible = (element: Element | null): boolean => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };

    const recordFrame = () => {
      if (sessionStorage.getItem(`${frameKey}:recording`) === "1") {
        const root = document.querySelector<HTMLElement>(
          '[data-testid="issue-children"]',
        );
        if (root) {
          const section = root.closest("section");
          const sectionRect = section?.getBoundingClientRect();
          const linkedDocuments = section?.nextElementSibling;
          const linkedDocumentsRect = linkedDocuments?.getBoundingClientRect();
          const loading = root.querySelector(
            '[data-testid="issue-children-loading"]',
          );
          const empty = root.querySelector(
            '[data-testid="issue-children-empty"]',
          );
          const progress = root.querySelector<HTMLElement>(
            '[role="progressbar"]',
          );
          const frame: IssueChildrenFrame = {
            loading: visible(loading),
            empty: visible(empty),
            childIds: Array.from(
              root.querySelectorAll<HTMLElement>("a[data-issue-id]"),
            ).map((link) => link.dataset.issueId ?? ""),
            progressNow: progress
              ? Number(progress.getAttribute("aria-valuenow"))
              : null,
            progressMax: progress
              ? Number(progress.getAttribute("aria-valuemax"))
              : null,
            sectionTop: sectionRect ? sectionRect.top : null,
            sectionHeight: sectionRect ? sectionRect.height : null,
            linkedDocumentsTop: linkedDocumentsRect
              ? linkedDocumentsRect.top
              : null,
          };
          try {
            const frames = JSON.parse(
              sessionStorage.getItem(frameKey) ?? "[]",
            ) as IssueChildrenFrame[];
            if (frames.length < 900) {
              frames.push(frame);
              sessionStorage.setItem(frameKey, JSON.stringify(frames));
            }
          } catch {
            // Recording must not interfere with the UI under observation.
          }
        }
      }
      requestAnimationFrame(recordFrame);
    };

    requestAnimationFrame(recordFrame);
  }, FRAME_KEY);
}

async function readIssueChildrenFrames(
  page: Page,
): Promise<IssueChildrenFrame[]> {
  return page.evaluate((frameKey) => {
    try {
      return JSON.parse(
        sessionStorage.getItem(frameKey) ?? "[]",
      ) as IssueChildrenFrame[];
    } catch {
      return [];
    }
  }, FRAME_KEY);
}

async function waitForIssueListPending(
  request: Parameters<typeof readFixtureState>[0],
): Promise<void> {
  await expect
    .poll(async () => {
      const state = await readFixtureState(request);
      return state.issue_list_pending[REEF_E2E_VAULT] ?? 0;
    })
    .toBeGreaterThan(0);
}

test.describe("Hermetic issue sub-issue loading", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("keeps the detail frame while loading, retains rows on revalidation, and scopes children to the parent", async ({
    page: initialPage,
    context,
    request,
  }) => {
    await initialPage.setViewportSize({ width: 1440, height: 900 });
    await openExistingWorkspace(initialPage);
    // Close the workspace page so its throttled query-cache persister cannot
    // rewrite the cached list between clearing storage and the detail page boot.
    await initialPage.close();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/api/healthz");
    await clearPersistedQueryCache(page);
    await clearPersistedQueryCacheOnLoad(page);
    await recordIssueChildrenFrames(page);
    await setIssueListFailure(request, false, 0, 1_200);

    const children = page.getByTestId("issue-children");
    const issueListPending = waitForIssueListPending(request);
    // Release navigation at document commit so locator polling can observe the
    // detail UI during the 1.2s list delay instead of after DOMContentLoaded.
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues/${ROOT}?view=list`, {
      waitUntil: "commit",
    });
    await Promise.all([
      issueListPending,
      expect(page.getByTestId("issue-detail")).toBeVisible(),
      expect(children.getByTestId("issue-children-loading")).toBeVisible(),
    ]);

    await expect(children.getByTestId("issue-children-empty")).toHaveCount(0);
    await expect(children.getByRole("progressbar")).toHaveCount(0);
    await expect(children.locator("a[data-issue-id]")).toHaveCount(0);
    await expect(page.getByTestId("add-sub-issue-trigger")).toBeVisible();

    await waitForIssueListIdle(request);
    const midLink = children.locator(`a[data-issue-id="${MID}"]`);
    const shortChildLink = children.locator(
      `a[data-issue-id="${SHORT_CHILD}"]`,
    );
    await expect(midLink).toBeVisible();
    await expect(shortChildLink).toBeVisible();
    await expect(children.getByText("0 of 2 done")).toBeVisible();
    await expect(children.getByRole("progressbar")).toHaveAttribute(
      "aria-valuemax",
      "2",
    );
    await expect(midLink.getByRole("img", { name: "Todo" })).toBeVisible();
    await expect(
      shortChildLink.getByRole("img", { name: "Backlog" }),
    ).toBeVisible();
    await expect(
      children.getByTestId(`issue-child-assignee-${MID}`),
    ).toBeVisible();
    await expect(
      children.getByTestId(`issue-child-assignee-${SHORT_CHILD}`),
    ).toBeVisible();

    const frames = await readIssueChildrenFrames(page);
    const loadingFrames = frames.filter((frame) => frame.loading);
    expect(loadingFrames.length).toBeGreaterThan(0);
    expect(
      loadingFrames.every(
        (frame) =>
          !frame.empty &&
          frame.childIds.length === 0 &&
          frame.progressNow === null &&
          frame.linkedDocumentsTop !== null,
      ),
    ).toBe(true);
    const lastPendingFrame = loadingFrames.at(-1);
    const firstSettledFrame = frames.find(
      (frame) =>
        !frame.loading &&
        frame.childIds.length === 2 &&
        frame.progressNow === 0 &&
        frame.progressMax === 2,
    );
    expect(lastPendingFrame).toBeDefined();
    expect(firstSettledFrame).toBeDefined();
    const linkedDocumentsTopDelta = Math.abs(
      (lastPendingFrame?.linkedDocumentsTop ?? 0) -
        (firstSettledFrame?.linkedDocumentsTop ?? 0),
    );
    process.stdout.write(
      `ISSUE_CHILDREN_LOADING_FRAME_EVIDENCE ${JSON.stringify({
        loadingFrameCount: loadingFrames.length,
        lastPendingLinkedDocumentsTop: lastPendingFrame?.linkedDocumentsTop,
        firstSettledLinkedDocumentsTop: firstSettledFrame?.linkedDocumentsTop,
        linkedDocumentsTopDelta,
        settledChildCount: firstSettledFrame?.childIds.length,
        settledProgressNow: firstSettledFrame?.progressNow,
        settledProgressMax: firstSettledFrame?.progressMax,
      })}\n`,
    );
    expect(linkedDocumentsTopDelta).toBeLessThanOrEqual(2);

    // Creating a sub-issue invalidates the whole-vault list. Existing child
    // rows stay visible while that background request is delayed.
    await setIssueListFailure(request, false, 0, 1_200);
    await page.getByTestId("add-sub-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByTestId("new-issue-title-input")
      .fill("Child created during list revalidation");
    await dialog.getByTestId("create-and-add-another").check();
    await dialog.getByTestId("new-issue-submit").click();
    await expect(dialog.getByTestId("new-issue-title-input")).toHaveValue("");
    await waitForIssueListPending(request);
    await expect(children.getByTestId("issue-children-loading")).toHaveCount(0);
    await expect(midLink).toBeVisible();
    await expect(shortChildLink).toBeVisible();
    await expect(children.getByText("0 of 3 done")).toBeVisible();
    // The create-and-add-another dialog keeps the background detail subtree
    // inert, so inspect the rendered bar directly instead of the a11y tree.
    await expect(children.locator('[role="progressbar"]')).toHaveAttribute(
      "aria-valuemax",
      "3",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        const vault = state.vaults.find(
          (candidate) => candidate.name === REEF_E2E_VAULT,
        );
        return vault?.issues.find(
          (issue) => issue.title === "Child created during list revalidation",
        )?.parent_id;
      })
      .toBe(ROOT);
    const createdState = await readFixtureState(request);
    const createdIssue = createdState.vaults
      .find((candidate) => candidate.name === REEF_E2E_VAULT)
      ?.issues.find(
        (issue) => issue.title === "Child created during list revalidation",
      );
    if (!createdIssue) throw new Error("Created sub-issue was not persisted");
    await expect(
      children.locator(`a[data-issue-id="${createdIssue.id}"]`),
    ).toBeVisible();
    await waitForIssueListIdle(request);
    await dialog.getByTestId("new-issue-cancel").click();
    await page.getByTestId("discard-draft-confirm-button").click();
    await expect(dialog).toBeHidden();

    await midLink.click();
    await expect(page).toHaveURL(new RegExp(`/issues/${MID}(?:\\?|$)`));
    const midChildren = page.getByTestId("issue-children");
    await expect(
      midChildren.locator('a[data-issue-id="REEF-103"]'),
    ).toBeVisible();
    await expect(
      midChildren.locator(`a[data-issue-id="${SHORT_CHILD}"]`),
    ).toHaveCount(0);
    await expect(midChildren.getByText("0 of 1 done")).toBeVisible();

    await page.getByTestId("issue-drill-back").click();
    await expect(page).toHaveURL(new RegExp(`/issues/${ROOT}(?:\\?|$)`));
    await expect(
      page
        .getByTestId("issue-children")
        .locator(`a[data-issue-id="${SHORT_CHILD}"]`),
    ).toBeVisible();
  });

  test("reports an initial list error and retries to show real child rows", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await clearPersistedQueryCacheOnLoad(page);
    await setIssueListFailure(request, true);

    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues/${ROOT}?view=list`);
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    const children = page.getByTestId("issue-children");
    const error = children.getByTestId("issue-children-error");
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error.getByText("Couldn't load sub-issues.")).toBeVisible();
    await expect(children.getByTestId("issue-children-empty")).toHaveCount(0);
    await expect(children.locator("a[data-issue-id]")).toHaveCount(0);
    await expect(page.getByTestId("add-sub-issue-trigger")).toBeVisible();

    await setIssueListFailure(request, false);
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(error).toHaveCount(0);
    await expect(children.locator(`a[data-issue-id="${MID}"]`)).toBeVisible();
    await expect(
      children.locator(`a[data-issue-id="${SHORT_CHILD}"]`),
    ).toBeVisible();
    await expect(children.getByText("0 of 2 done")).toBeVisible();
  });
});
