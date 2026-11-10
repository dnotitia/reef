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
    name: /Epic REEF-100 Platform foundation Open/,
  });
  const newParentLink = rail.getByRole("link", {
    name: new RegExp(`Epic REEF-101 ${childEpicTitle} Open`),
  });
  const title = page.getByTestId("issue-title-input");
  const noParent = rail.getByText("No parent issue", { exact: true });
  const saved = page.getByTestId("issue-save-status");
  const tooltip = page.getByRole("tooltip");
  const points = rail.getByRole("spinbutton", { name: "Points" });

  await page.goto(`${issues}/REEF-002?view=list`);
  await expect(rootLink).toBeVisible();
  await rootLink.hover();
  await expect(tooltip).toHaveCount(0);
  await points.focus();
  await page.keyboard.press("Tab");
  await expect(rootLink).toBeFocused();
  await expect(tooltip).toHaveCount(0);
  await rootLink.click();
  await expect(title).toHaveValue(rootTitle);
  await expect(noParent).toBeVisible();
  await expect(rail.getByRole("link", { name: /Open$/ })).toHaveCount(0);

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
  await points.focus();
  await page.keyboard.press("Tab");
  await expect(newParentLink).toBeFocused();
  await expect(tooltip).toHaveText(childEpicTitle);
  await newParentLink.press("Enter");
  await expect(title).toHaveValue(childEpicTitle);

  await page.goto(`${issues}/REEF-002?view=list`);
  await rail.getByRole("button", { name: "Clear Parent", exact: true }).click();
  await expect(saved).toHaveText("Saved");
  await expect(noParent).toBeVisible();
  await expect(newParentLink).toHaveCount(0);
  await page.reload();
  await expect(noParent).toBeVisible();
  await expect(rail.getByRole("link", { name: /Open$/ })).toHaveCount(0);
});
