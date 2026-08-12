import { type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  readIndexedDbConfig,
  resetFixture,
} from "../harness/fixture";

const RECENTS_KEY = "assignee_recents:alice:reef-e2e";

async function openAssigneePicker(page: Page) {
  const detail = page.getByTestId("issue-detail");
  await expect(detail).toBeVisible();
  const combobox = detail.getByTestId("assignee-combobox").first();
  await expect(combobox).toBeVisible();
  await combobox.locator("button").first().click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  return listbox;
}

async function issueAssignee(
  request: Parameters<typeof readFixtureState>[0],
  issueId: string,
): Promise<string | null | undefined> {
  const state = await readFixtureState(request);
  return state.vaults
    .find((vault) => vault.name === REEF_E2E_VAULT)
    ?.issues.find((issue) => issue.id === issueId)?.assigned_to;
}

test.describe("Hermetic assignee picker", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "assignee_picker");
  });

  test("shows the complete assignable roster, keeps long-list keyboard behavior, and remembers successful selections", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues/REEF-001`);

    const listbox = await openAssigneePicker(page);
    const options = listbox.getByRole("option");
    await expect(options).toHaveCount(16);
    for (const [index, text] of [
      "Unassigned",
      "Alice Example",
      "Bob Example",
      "Candidate 01",
      "Candidate 02",
      "Candidate 03",
      "Candidate 04",
      "Candidate 05",
      "Candidate 06",
      "Candidate 07",
      "Candidate 08",
      "Candidate 09",
      "Candidate 10",
      "Carol Example",
      "same-a",
      "same-z",
    ].entries()) {
      await expect(options.nth(index)).toContainText(text);
    }
    await expect(listbox).not.toContainText("Reader Only");
    await expect(listbox).not.toContainText("Unknown Role");
    await expect(listbox.locator("[role=option]").last()).toContainText(
      "same-z",
    );

    const search = listbox.locator("..").locator('input[role="combobox"]');
    await search.fill("candidate-10");
    const candidate = page.getByRole("option", { name: /Candidate 10/ });
    await expect(candidate).toBeVisible();
    const successfulPatch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "PATCH" &&
        url.pathname === "/api/issues/REEF-001"
      );
    });
    await candidate.click();
    await successfulPatch;

    await expect
      .poll(() => issueAssignee(request, "REEF-001"))
      .toBe("candidate-10");
    await expect
      .poll(async () => {
        const raw = await readIndexedDbConfig(page, RECENTS_KEY);
        if (!raw) return undefined;
        return (JSON.parse(raw) as { logins?: string[] }).logins?.[0];
      })
      .toBe("candidate-10");

    await page.reload();
    const reloadedListbox = await openAssigneePicker(page);
    await expect(reloadedListbox.getByRole("option").nth(1)).toContainText(
      "Candidate 10",
    );
    expect(await reloadedListbox.locator('[role="option"]').count()).toBe(16);

    const reloadedSearch = reloadedListbox
      .locator("..")
      .locator('input[role="combobox"]');
    await expect(reloadedSearch).toBeFocused();
    const endPatch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        response.request().method() === "PATCH" &&
        url.pathname === "/api/issues/REEF-001"
      );
    });
    await reloadedSearch.press("End");
    await reloadedSearch.press("Enter");
    await endPatch;
    await expect.poll(() => issueAssignee(request, "REEF-001")).toBe("same-z");
  });

  test("preserves the current assignment and recent history after a failed save", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues/REEF-002`);

    const listbox = await openAssigneePicker(page);
    const candidate = listbox.getByRole("option", { name: /Candidate 10/ });
    await expect(candidate).toBeVisible();
    const [failedPatch] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "PATCH" &&
          url.pathname === "/api/issues/REEF-002"
        );
      }),
      candidate.click(),
    ]);
    expect(failedPatch.ok()).toBe(false);

    await expect(page.getByTestId("issue-save-status")).toContainText(
      "Not saved",
    );
    await expect(page.getByLabel("Assignee: alice")).toBeVisible();
    await expect.poll(() => issueAssignee(request, "REEF-002")).toBe("alice");
    expect(await readIndexedDbConfig(page, RECENTS_KEY)).toBeUndefined();

    await page.reload();
    const reloadedListbox = await openAssigneePicker(page);
    await expect(reloadedListbox.getByRole("option").nth(1)).toContainText(
      "Alice Example",
    );
  });
});
