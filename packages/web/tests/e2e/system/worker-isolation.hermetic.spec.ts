import { expect, test } from "../harness/test";
import {
  openExistingWorkspace,
  resetFixture,
  signInAsAlice,
} from "../harness/fixture";

test.describe.configure({ mode: "parallel" });

test("keeps an empty fixture isolated from a configured worker", async ({
  page,
  request,
}) => {
  await resetFixture(request, "empty");
  await signInAsAlice(page);
  await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
  await expect(
    page.getByText("Create a project workspace to get started."),
  ).toBeVisible();
});

test("keeps a configured fixture isolated from an empty worker", async ({
  page,
  request,
}) => {
  await resetFixture(request, "configured");
  await openExistingWorkspace(page);
  await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
});
