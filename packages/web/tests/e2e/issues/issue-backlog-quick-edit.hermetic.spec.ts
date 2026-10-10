import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

async function fixtureIssue(
  request: Parameters<typeof readFixtureState>[0],
  issueId: string,
) {
  const state = await readFixtureState(request);
  const issue = state.vaults
    .find((vault) => vault.name === REEF_E2E_VAULT)
    ?.issues.find((candidate) => candidate.id === issueId);
  if (!issue) throw new Error(`Missing fixture issue: ${issueId}`);
  return issue;
}

async function closeQuickEditor(
  page: Parameters<typeof openExistingWorkspace>[0],
  field: "status" | "priority" | "assignee",
) {
  const editor =
    field === "assignee"
      ? page.getByTestId("assignee-combobox").locator("button").first()
      : page.getByTestId(`issue-quick-edit-${field}`);
  await editor.press("Escape");
  await expect(page.getByTestId("issue-quick-edit-anchor")).toHaveCount(0);
}

type ResizeObservation = {
  listenerTarget: "window" | "document";
  type: "resize" | "focusin" | "keydown";
  timestamp: number;
  targetRole: string | null;
  targetTestId: string | null;
  viewportWidth: number;
  viewportHeight: number;
  defaultPrevented: boolean;
};

type ResizeObserverWindow = Window & {
  __reef636BacklogPriorityResizeObserver?: {
    observations: ResizeObservation[];
    cleanup: () => void;
  };
};

function installBacklogPriorityResizeObserver() {
  const observations: ResizeObservation[] = [];
  const listeners: Array<
    [Window | Document, ResizeObservation["type"], EventListener]
  > = [];

  for (const [target, listenerTarget] of [
    [window, "window"],
    [document, "document"],
  ] as const) {
    for (const type of ["resize", "focusin", "keydown"] as const) {
      const listener: EventListener = (event) => {
        if (
          type === "keydown" &&
          (!(event instanceof KeyboardEvent) || event.key !== "Escape")
        ) {
          return;
        }
        const element =
          event.target instanceof HTMLElement ? event.target : null;
        observations.push({
          listenerTarget,
          type,
          timestamp: performance.now(),
          targetRole: element?.getAttribute("role") ?? null,
          targetTestId: element?.getAttribute("data-testid") ?? null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          defaultPrevented: event.defaultPrevented,
        });
      };
      target.addEventListener(type, listener, { capture: true, passive: true });
      listeners.push([target, type, listener]);
    }
  }

  (window as ResizeObserverWindow).__reef636BacklogPriorityResizeObserver = {
    observations,
    cleanup: () => {
      for (const [target, type, listener] of listeners) {
        target.removeEventListener(type, listener, true);
      }
    },
  };
}

function disposeBacklogPriorityResizeObserver(
  page: Parameters<typeof openExistingWorkspace>[0],
  includeObservations: boolean,
) {
  return page.evaluate((include) => {
    const observerWindow = window as ResizeObserverWindow;
    const observer = observerWindow.__reef636BacklogPriorityResizeObserver;
    if (!observer) return null;
    observer.cleanup();
    delete observerWindow.__reef636BacklogPriorityResizeObserver;
    return include ? observer.observations : null;
  }, includeObservations);
}

test.describe("Hermetic Backlog quick edit", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("uses the shared trigger and field anchor for Status, Priority, and Assignee", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );

    const row = page.getByTestId("backlog-row").filter({
      hasText: "REEF-003",
    });
    await expect(row).toBeVisible();

    for (const field of ["status", "priority", "assignee"] as const) {
      const trigger = row.getByTestId(`issue-inline-edit-${field}`);
      await expect(trigger).toHaveAttribute(
        "aria-label",
        {
          status: "Status",
          priority: "Priority",
          assignee: "Assignee",
        }[field],
      );
      await trigger.click();

      const anchor = page.getByTestId("issue-quick-edit-anchor");
      await expect(anchor).toBeVisible();
      await expect(page.getByTestId("issue-detail")).toHaveCount(0);

      const geometry = await page.evaluate((fieldName) => {
        const trigger = document.querySelector<HTMLElement>(
          `[data-testid="issue-inline-edit-${fieldName}"]`,
        );
        const editor = document.querySelector<HTMLElement>(
          '[data-testid="issue-quick-edit-anchor"]',
        );
        if (!trigger || !editor) throw new Error("quick-edit geometry missing");
        const triggerRect = trigger.getBoundingClientRect();
        return {
          triggerLeft: triggerRect.left,
          triggerCenter: triggerRect.top + triggerRect.height / 2,
          editorLeft: Number.parseFloat(editor.style.left),
          editorCenter: Number.parseFloat(editor.style.top),
        };
      }, field);

      expect(geometry.editorLeft).toBeCloseTo(geometry.triggerLeft, 0);
      expect(geometry.editorCenter).toBeCloseTo(geometry.triggerCenter, 0);

      const widths = await page.evaluate((fieldName) => {
        const editor = document.querySelector<HTMLElement>(
          '[data-testid="issue-quick-edit-anchor"]',
        );
        const content =
          fieldName === "assignee"
            ? document
                .querySelector<HTMLElement>(
                  '[data-testid="assignee-combobox"] [role="listbox"]',
                )
                ?.closest<HTMLElement>('[role="dialog"]')
            : document.querySelector<HTMLElement>(
                '[data-slot="select-content"]',
              );
        if (!editor || !content) throw new Error("quick-edit width missing");
        return {
          editor: editor.getBoundingClientRect().width,
          content: content.getBoundingClientRect().width,
        };
      }, field);

      if (field === "assignee") {
        expect(widths.editor).toBe(224);
        expect(widths.content).toBeGreaterThanOrEqual(256);
      } else {
        expect(widths.editor).toBe(192);
        expect(widths.content).toBe(192);
      }

      await closeQuickEditor(page, field);
    }

    await expect(row.getByTestId("issue-inline-edit-labels")).toHaveCount(0);
    await expect(row.getByTestId("issue-inline-edit-sprint")).toHaveCount(0);
    await expect(row.getByTestId("issue-inline-edit-release")).toHaveCount(0);
  });

  test("keeps the Priority editor open and attached after a viewport resize", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.addInitScript(installBacklogPriorityResizeObserver);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );

    let observerDisposed = false;
    try {
      const row = page.getByTestId("backlog-row").first();
      await expect(row).toBeVisible();
      await row.getByTestId("issue-inline-edit-priority").click();

      const anchor = page.getByTestId("issue-quick-edit-anchor");
      await expect(anchor).toBeVisible();
      await expect(page.getByTestId("issue-quick-edit-priority")).toBeVisible();
      await expect(page.getByRole("listbox")).toBeVisible();

      await page.setViewportSize({ width: 1280, height: 900 });

      await expect(anchor).toBeVisible();
      await expect(page.getByTestId("issue-quick-edit-priority")).toBeVisible();
      await expect(page.getByRole("listbox")).toBeVisible();
      await closeQuickEditor(page, "priority");
    } catch (error) {
      observerDisposed = true;
      let observations: ResizeObservation[] = [];
      try {
        observations =
          (await disposeBacklogPriorityResizeObserver(page, true)) ?? [];
      } catch {
        // Preserve the original Playwright failure if the page has closed.
      }
      console.log(
        `BACKLOG_PRIORITY_RESIZE_FAILURE ${JSON.stringify({ observations })}`,
      );
      throw error;
    } finally {
      if (!observerDisposed) {
        observerDisposed = true;
        try {
          await disposeBacklogPriorityResizeObserver(page, false);
        } catch {
          // Observer cleanup must not change the test result.
        }
      }
    }
  });

  test("collision-places the narrow Backlog Priority editor inside a 640px viewport", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );
    await page.setViewportSize({ width: 640, height: 360 });

    const row = page.getByTestId("backlog-row").filter({
      hasText: "REEF-003",
    });
    await expect(row).toBeVisible();
    await row.getByTestId("issue-inline-edit-priority").click();

    const content = page.locator('[data-slot="select-content"]');
    await expect(content).toBeVisible();
    const geometry = await content.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const anchor = document.querySelector<HTMLElement>(
        '[data-testid="issue-quick-edit-anchor"]',
      );
      const anchorRect = anchor?.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        anchorLeft: anchorRect?.left,
        anchorRight: anchorRect?.right,
      };
    });

    expect(geometry.width).toBe(192);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(640);
    expect(geometry.anchorLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.anchorRight).toBeLessThanOrEqual(640);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("issue-quick-edit-anchor")).toHaveCount(0);
  });

  test("keeps the Backlog keyboard scope to triage fields and omits Labels", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );

    const row = page.getByTestId("backlog-row").filter({
      hasText: "REEF-003",
    });
    await expect(row).toBeVisible();
    await row.focus();

    await page.keyboard.press("l");
    await expect(page.getByTestId("issue-quick-edit-anchor")).toHaveCount(0);

    for (const [key, field] of [
      ["s", "status"],
      ["p", "priority"],
      ["a", "assignee"],
    ] as const) {
      await page.keyboard.press(key);
      const editor =
        field === "assignee"
          ? page.getByTestId("assignee-combobox")
          : page.getByTestId(`issue-quick-edit-${field}`);
      await expect(editor).toBeVisible();
      await closeQuickEditor(page, field);
    }

    await expect(page.getByTestId("issue-detail")).toHaveCount(0);
  });

  test("promotes a Backlog issue through the shared mutation and removes it from the view", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );

    const row = page.getByTestId("backlog-row").filter({
      hasText: "REEF-003",
    });
    await expect(row).toBeVisible();

    const patch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "PATCH" &&
        url.pathname === "/api/issues/REEF-003"
      );
    });
    await row.getByTestId("issue-inline-edit-status").click();
    await page.getByRole("option", { name: "Todo" }).click();
    await patch;

    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-003")).status)
      .toBe("todo");
    await expect(row).toHaveCount(0);
  });

  test("keeps the shared close-reason confirmation when closing from Backlog", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );

    const row = page.getByTestId("backlog-row").filter({
      hasText: "REEF-003",
    });
    await expect(row).toBeVisible();

    await row.getByTestId("issue-inline-edit-status").click();
    await page.getByRole("option", { name: "Closed" }).click();
    await expect(page.getByTestId("close-issue-dialog")).toBeVisible();
    await expect(page.getByTestId("issue-quick-edit-anchor")).toHaveCount(0);
    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-003")).status)
      .toBe("backlog");

    const patch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "PATCH" &&
        url.pathname === "/api/issues/REEF-003"
      );
    });
    await page.getByTestId("close-issue-confirm").click();
    await patch;

    await expect
      .poll(async () => (await fixtureIssue(request, "REEF-003")).status)
      .toBe("closed");
    await expect(row).toHaveCount(0);
  });
});
