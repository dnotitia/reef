import { expect } from "@playwright/test";
import { openWorkspaceThroughLogin } from "../harness/fixture";
import { test as workspaceTest } from "../harness/workspace-fixture";

const test = workspaceTest.extend({ scenario: "epic_grouping" });
const issues = "/workspace/reef-e2e/issues";
const rootTitle = "Platform foundation";
const childEpicTitle =
  "A very long product outcome title that should remain readable inside a compact Epic group header";

test("opens the saved parent from the property rail and reflects edits after reopening", async ({
  page,
}) => {
  await openWorkspaceThroughLogin(page);
  const rail = page.getByTestId("issue-detail-sidebar");
  const parentPicker = rail.getByRole("combobox", {
    name: "Parent",
    exact: true,
  });
  const rootLink = rail.getByRole("link", {
    name: `Open parent Epic REEF-100: ${rootTitle}`,
    exact: true,
  });
  const newParentLink = rail.getByRole("link", {
    name: `Open parent Epic REEF-101: ${childEpicTitle}`,
    exact: true,
  });
  const parentLinks = rail.getByRole("link", { name: /^Open parent / });
  const title = page.getByTestId("issue-title-input");
  const noParent = rail.getByText("No parent issue", { exact: true });
  const saved = page.getByTestId("issue-save-status");
  const tooltip = page.getByRole("tooltip");
  const parentOptions = page.getByTestId("relation-dropdown-panel");
  const clearParent = rail.getByRole("button", {
    name: "Clear Parent",
    exact: true,
  });

  await page.goto(`${issues}/REEF-002?view=list`);
  await expect(rootLink).toBeVisible();
  await rootLink.hover();
  await expect(tooltip).toHaveCount(0);
  await parentPicker.focus();
  await expect(parentOptions).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(clearParent).toBeFocused();
  await expect(parentOptions).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(parentPicker).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(rootLink).toBeFocused();
  await expect(parentOptions).toHaveCount(0);
  await expect(tooltip).toHaveCount(0);
  await rootLink.click();
  await expect(title).toHaveValue(rootTitle);
  await expect(noParent).toBeVisible();
  await expect(parentLinks).toHaveCount(0);

  await page.goto(`${issues}/REEF-101?view=list`);
  await parentPicker.fill("REEF-100");
  await parentPicker.press("Enter");
  await expect(saved).toHaveText("Saved");
  await page.reload();
  await expect(rootLink).toBeVisible();
  await rootLink.press("Enter");
  await expect(title).toHaveValue(rootTitle);

  await page.goto(`${issues}/REEF-002?view=list`);
  await parentPicker.fill("REEF-101");
  await parentPicker.press("Enter");
  await expect(saved).toHaveText("Saved");
  await expect(newParentLink).toBeVisible();
  await expect(rootLink).toHaveCount(0);
  await page.reload();
  await expect(
    newParentLink.getByText(childEpicTitle, { exact: true }),
  ).toHaveCSS("text-overflow", "ellipsis");
  await newParentLink.hover();
  await expect(tooltip).toHaveText(childEpicTitle);
  await rail.getByRole("heading", { name: "Parent", exact: true }).hover();
  await expect(tooltip).toHaveCount(0);
  await parentPicker.focus();
  await expect(parentOptions).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(newParentLink).toBeFocused();
  await expect(parentOptions).toHaveCount(0);
  await expect(tooltip).toHaveText(childEpicTitle);
  await newParentLink.press("Enter");
  await expect(title).toHaveValue(childEpicTitle);

  await page.goto(`${issues}/REEF-002?view=list`);
  await clearParent.click();
  await expect(saved).toHaveText("Saved");
  await expect(noParent).toBeVisible();
  await expect(newParentLink).toHaveCount(0);
  await page.reload();
  await expect(noParent).toBeVisible();
  await expect(parentLinks).toHaveCount(0);
});
