import { type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  removeFixtureIssue,
  resetFixture,
  setIssueUpdateFailure,
} from "./harness/fixture";

async function openList(page: Page) {
  await openExistingWorkspace(page);
  await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
  await expect(page.getByTestId("issue-list-row").first()).toBeVisible({
    timeout: 15_000,
  });
}

async function selectRow(page: Page, id: string) {
  const row = page.getByTestId("issue-list-row").filter({ hasText: id });
  await row.getByRole("checkbox", { name: `Select ${id}` }).click();
}

async function chooseBulkStatus(page: Page, label: string) {
  await page.getByTestId("bulk-status").click();
  await page.getByRole("option", { name: label }).click();
}

function reefVault(state: Awaited<ReturnType<typeof readFixtureState>>) {
  const vault = state.vaults.find((item) => item.name === REEF_E2E_VAULT);
  if (!vault) throw new Error("missing reef-e2e vault");
  return vault;
}

test.describe("Hermetic issue multi-select and bulk edit", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
  });

  test("selects loaded rows and applies one sequential bulk action through Route Handlers", async ({
    page,
    request,
  }) => {
    await openList(page);
    const patchIds: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let listGets = 0;
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (req.method() === "PATCH" && url.pathname.startsWith("/api/issues/")) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        patchIds.push(url.pathname.split("/").at(-1) ?? "");
      }
      if (req.method() === "GET" && url.pathname === "/api/issues")
        listGets += 1;
    });
    page.on("response", (res) => {
      const url = new URL(res.url());
      if (
        res.request().method() === "PATCH" &&
        url.pathname.startsWith("/api/issues/")
      ) {
        inFlight -= 1;
      }
    });

    await selectRow(page, "REEF-101");
    await selectRow(page, "REEF-102");
    await selectRow(page, "REEF-103");
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "3 selected",
    );
    await expect(page.getByTestId("bulk-sprint")).toBeVisible();
    await expect(page.getByTestId("bulk-add-labels")).toBeVisible();
    await expect(page.getByTestId("bulk-remove-labels")).toBeVisible();
    await expect(page.getByTestId("bulk-more")).toHaveCount(0);
    const getsBefore = listGets;
    await chooseBulkStatus(page, "In Review");
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    expect(patchIds).toEqual(["REEF-101", "REEF-102", "REEF-103"]);
    expect(maxInFlight).toBe(1);
    expect(listGets - getsBefore).toBeLessThanOrEqual(1);
    const vault = reefVault(await readFixtureState(request));
    for (const id of patchIds) {
      expect(vault.issues.find((issue) => issue.id === id)?.status).toBe(
        "in_review",
      );
      expect(
        vault.activity.some(
          (event) =>
            event.reef_id === id &&
            event.event_type === "status_change" &&
            (event.payload as { to?: string }).to === "in_review",
        ),
      ).toBe(true);
    }
  });

  test("keeps Board free of selection controls and hands bulk work to filtered List", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?view=board&status=todo&priority=high`,
    );
    const first = page
      .getByTestId("kanban-card")
      .filter({ hasText: "REEF-102" });
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(
      first.getByRole("checkbox", { name: "Select REEF-102" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    await page.getByTestId("board-bulk-edit-shortcut").click();
    await page.waitForURL(/\/issues\?.*view=list/, {
      timeout: 10_000,
    });
    const params = new URL(page.url()).searchParams;
    expect(params.get("view")).toBe("list");
    expect(params.get("status")).toBe("todo");
    expect(params.get("priority")).toBe("high");
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible();
  });

  test("applies the typed label draft without requiring Enter", async ({
    page,
    request,
  }) => {
    await openList(page);
    await selectRow(page, "REEF-101");
    await page.getByTestId("bulk-add-labels").click();
    await page.getByTestId("bulk-add-labels-input").fill("frontend");
    await page.getByRole("button", { name: "Add labels" }).last().click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    const vault = reefVault(await readFixtureState(request));
    expect(
      vault.issues.find((issue) => issue.id === "REEF-101")?.labels,
    ).toContain("frontend");
  });

  test("preserves successes on a middle failure and retries only the failed item", async ({
    page,
    request,
  }) => {
    await setIssueUpdateFailure(request, "REEF-102", "once");
    await openList(page);
    await selectRow(page, "REEF-101");
    await selectRow(page, "REEF-102");
    await selectRow(page, "REEF-103");
    await chooseBulkStatus(page, "In Review");

    const tray = page.getByRole("button", { name: "1 failed" });
    await expect(tray).toBeVisible();
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "1 selected",
    );
    await expect(
      page.getByTestId("issue-list-row").filter({ hasText: "REEF-102" }),
    ).toHaveAttribute("aria-selected", "true");
    const beforeRetry = reefVault(await readFixtureState(request));
    expect(
      beforeRetry.issues.find((issue) => issue.id === "REEF-101")?.status,
    ).toBe("in_review");
    expect(
      beforeRetry.issues.find((issue) => issue.id === "REEF-102")?.status,
    ).toBe("todo");
    expect(
      beforeRetry.issues.find((issue) => issue.id === "REEF-103")?.status,
    ).toBe("in_review");
    await tray.click();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);
    await expect
      .poll(async () => {
        const vault = reefVault(await readFixtureState(request));
        return vault.issues.find((issue) => issue.id === "REEF-102")?.status;
      })
      .toBe("in_review");
  });

  test("uses one close reason, reports a stale id, and clears idle selection on view change", async ({
    page,
    request,
  }) => {
    await openList(page);
    await selectRow(page, "REEF-101");
    await selectRow(page, "REEF-102");
    await chooseBulkStatus(page, "Closed");
    await expect(page.getByTestId("close-issue-dialog")).toHaveCount(1);
    await page.getByTestId("close-issue-confirm").click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);

    const closed = reefVault(await readFixtureState(request));
    for (const id of ["REEF-101", "REEF-102"]) {
      expect(closed.issues.find((issue) => issue.id === id)?.status).toBe(
        "closed",
      );
    }

    await page.reload();
    await expect(page.getByTestId("issue-list-row").first()).toBeVisible();
    await selectRow(page, "REEF-103");
    await selectRow(page, "REEF-104");
    await removeFixtureIssue(request, "REEF-103");
    await chooseBulkStatus(page, "Done");
    await expect(page.getByRole("button", { name: "1 failed" })).toBeVisible();
    await expect(page.getByTestId("issue-bulk-action-bar")).toContainText(
      "1 selected",
    );

    await page.getByTestId("view-switcher-board").click();
    await expect(page.getByTestId("issue-bulk-action-bar")).toHaveCount(0);
  });
});
