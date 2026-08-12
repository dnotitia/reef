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

test.describe("Hermetic Backlog quick edit", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("uses the shared trigger and field anchor for Status, Priority, and Assignee", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=backlog`);

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
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=backlog`);

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
    await page.keyboard.press("Escape");
    await expect(anchor).toHaveCount(0);
  });

  test("keeps the Backlog keyboard scope to triage fields and omits Labels", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=backlog`);

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
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=backlog`);

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
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=backlog`);

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
