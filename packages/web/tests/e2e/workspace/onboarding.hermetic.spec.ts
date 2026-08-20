import { expect, test, type Locator } from "@playwright/test";
import {
  readFixtureState,
  resetFixture,
  signInAsAlice,
  waitForPasswordLogin,
  writeIndexedDbConfig,
} from "../harness/fixture";

async function expectContained(container: Locator, child: Locator) {
  const [containerBox, childBox] = await Promise.all([
    container.boundingBox(),
    child.boundingBox(),
  ]);
  expect(containerBox, "container should be measurable").not.toBeNull();
  expect(childBox, "child should be measurable").not.toBeNull();
  if (!containerBox || !childBox) return;
  expect(childBox.x).toBeGreaterThanOrEqual(containerBox.x - 1);
  expect(childBox.y).toBeGreaterThanOrEqual(containerBox.y - 1);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(
    containerBox.x + containerBox.width + 1,
  );
  expect(childBox.y + childBox.height).toBeLessThanOrEqual(
    containerBox.y + containerBox.height + 1,
  );
}

async function expectWidthContained(container: Locator, child: Locator) {
  const [containerBox, childBox] = await Promise.all([
    container.boundingBox(),
    child.boundingBox(),
  ]);
  expect(containerBox, "container should be measurable").not.toBeNull();
  expect(childBox, "child should be measurable").not.toBeNull();
  if (!containerBox || !childBox) return;
  expect(childBox.x).toBeGreaterThanOrEqual(containerBox.x - 1);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(
    containerBox.x + containerBox.width + 1,
  );
}

test.describe("Hermetic onboarding flow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "empty");
  });

  test("creates a reef workspace through real Route Handlers", async ({
    page,
    request,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
    await expect(
      page.getByText("Create a project workspace to get started."),
    ).toBeVisible();
    await expect(page.getByText(/pick an existing workspace/i)).toHaveCount(0);

    await page
      .locator('[data-testid="greenfield-vault-name-input"]')
      .fill("reef-new");
    await expect(
      page.locator('[data-testid="greenfield-project-prefix-input"]'),
    ).toHaveValue("REEF");
    await page.locator('[data-testid="greenfield-create-btn"]').click();

    await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await expect(page.getByTestId("sidebar-workspace-trigger")).toContainText(
      "reef-new",
    );

    const state = await readFixtureState(request);
    const created = state.vaults.find((vault) => vault.name === "reef-new");
    expect(created?.settings.project_prefix).toBe("REEF");
    expect(created?.tables).toContain("reef_issues");
    expect(
      state.calls.some(
        (call) =>
          call.method === "POST" &&
          call.path === "/akb/api/v1/tables/reef-new/sql",
      ),
    ).toBe(true);
  });

  test("shows the create form when no vault has reef config", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "raw_only");
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await expect(
      page.locator('[data-testid="greenfield-vault-name-input"]'),
    ).toBeVisible();
  });

  test("announces required field errors and returns focus to the first error", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    const nameInput = page.getByTestId("greenfield-vault-name-input");
    const prefixInput = page.getByTestId("greenfield-project-prefix-input");
    await prefixInput.fill("");
    await page.getByTestId("greenfield-create-btn").click();

    await expect(nameInput).toHaveAttribute("required", "");
    await expect(nameInput).toHaveAttribute("aria-invalid", "true");
    await expect(nameInput).toHaveAttribute(
      "aria-describedby",
      "greenfield-vault-name-error",
    );
    await expect(page.getByTestId("greenfield-vault-name-error")).toBeVisible();
    await expect(prefixInput).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByTestId("greenfield-project-prefix-error"),
    ).toBeVisible();
    await expect(nameInput).toBeFocused();

    await nameInput.fill("reef-new");
    await expect(nameInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("greenfield-vault-name-error")).toHaveCount(
      0,
    );
  });

  test("keeps onboarding controls and repository popover inside narrow forms", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    const panel = page.getByTestId("onboarding-panel");
    const form = panel.locator("form");
    const language = page.getByTestId("greenfield-authoring-language-select");
    const repoTrigger = page.getByTestId("greenfield-monitored-repos-trigger");
    await expect(repoTrigger).toBeVisible();

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expectContained(panel, form);
      await expectContained(form, language);
      await expectContained(form, repoTrigger);

      await repoTrigger.click();
      const popover = page.getByRole("dialog", {
        name: "Search repositories",
      });
      await expect(popover).toBeVisible();
      await expectWidthContained(form, popover);
      await expect(
        page.getByTestId("greenfield-monitored-repos-search"),
      ).toBeFocused();
      await expect(
        page.locator(
          '[data-testid="greenfield-monitored-repos-option-octo/reef"]',
        ),
      ).toHaveAttribute("aria-label", "octo/reef");
      await page.keyboard.press("Escape");
      await expect(repoTrigger).toBeFocused();

      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    }
  });

  test("keeps the account menu on authenticated onboarding and signs out", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toHaveCount(0);
  });

  test("prefers a remembered configured workspace", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await page.goto("/login");
    await waitForPasswordLogin(page);
    await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
    await writeIndexedDbConfig(page, "vault", "reef-zeta");

    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("rechecks a remembered workspace after cached selection and re-login", async ({
    context,
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/, {
      timeout: 15_000,
    });
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("REACT_QUERY_OFFLINE_CACHE")),
      )
      .toContain("reef-alpha");

    await context.clearCookies();
    await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
    await writeIndexedDbConfig(page, "vault", "reef-zeta");
    await page.goto("/login");
    await waitForPasswordLogin(page);

    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("uses ASCII order for an invalid remembered workspace", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_multi");
    await page.goto("/login");
    await waitForPasswordLogin(page);
    await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
    await writeIndexedDbConfig(page, "vault", "missing");

    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/, {
      timeout: 15_000,
    });
  });

  test("auto-resumes direct onboarding and Back does not return to it", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });

    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/, {
      timeout: 15_000,
    });
    await page.goBack();
    await expect(page).not.toHaveURL(/\/onboarding\/?$/);
  });
});
