import { expect, test, type Locator } from "@playwright/test";
import {
  E2E_MOCK_URL,
  fixtureWriterLogin,
  readFixtureState,
  resetFixture,
  signInAsAlice,
  signInAsUser,
  setWorkspaceInitializationControl,
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

  test("creates a workspace as a non-admin and can create and read an issue", async ({
    page,
    request,
  }) => {
    await signInAsUser(page, fixtureWriterLogin);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.getByTestId("greenfield-vault-name-input").fill("reef-new");
    await page.getByTestId("greenfield-create-btn").click();
    await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });

    const createdIssueResponse = await page.request.post("/api/issues", {
      data: {
        vault: "reef-new",
        prefix: "REEF",
        create: {
          fields: { title: "Writer-created issue" },
          content: "Created by a non-admin workspace owner.",
        },
      },
    });
    expect(createdIssueResponse.status()).toBe(201);
    const createdIssue = (await createdIssueResponse.json()) as {
      issue: { id: string; title: string };
    };
    expect(createdIssue.issue.title).toBe("Writer-created issue");

    const readIssueResponse = await page.request.get(
      `/api/issues/${createdIssue.issue.id}?vault=reef-new`,
    );
    expect(readIssueResponse.status()).toBe(200);
    const readIssue = (await readIssueResponse.json()) as {
      issue: { id: string; title: string };
    };
    expect(readIssue.issue).toMatchObject({
      id: createdIssue.issue.id,
      title: "Writer-created issue",
    });

    const state = await readFixtureState(request);
    const created = state.vaults.find((vault) => vault.name === "reef-new");
    const paths = created?.documents.map((document) => document.path) ?? [];
    expect(paths).toContain("overview/vault-skill.md");
    expect(
      paths.filter((path) => path.startsWith("reef/runbooks/")),
    ).toHaveLength(5);
    expect(paths.some((path) => path.startsWith("overview/reef/"))).toBe(false);

    const loginResponse = await request.post(
      `${E2E_MOCK_URL}/akb/api/v1/auth/login`,
      { data: fixtureWriterLogin },
    );
    expect(loginResponse.ok()).toBe(true);
    const login = (await loginResponse.json()) as { token: string };
    const reservedDocumentResponse = await request.post(
      `${E2E_MOCK_URL}/akb/api/v1/documents`,
      {
        headers: { Authorization: `Bearer ${login.token}` },
        data: {
          vault: "reef-new",
          collection: "overview/reef",
          slug: "legacy",
          title: "Legacy reserved document",
          type: "reference",
          content: "must be rejected",
        },
      },
    );
    expect(reservedDocumentResponse.status()).toBe(403);
    expect(await reservedDocumentResponse.json()).toMatchObject({
      code: "reserved_system_path",
      detail: { code: "reserved_system_path" },
    });
  });

  test("recovers an incomplete brownfield workspace without replacing user data", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "workspace_recovery");
    await signInAsUser(page, fixtureWriterLogin);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.getByTestId("greenfield-vault-name-input").fill("raw-vault");
    await page.getByTestId("greenfield-create-btn").click();
    await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });

    const state = await readFixtureState(request);
    const recovered = state.vaults.find((vault) => vault.name === "raw-vault");
    expect(recovered).toBeDefined();
    expect(recovered?.settings).toMatchObject({
      custom_setting: "keep-me",
      project_prefix: "REEF",
    });
    expect(recovered?.settings.vault_skill).toBeUndefined();
    expect(recovered?.tables).toContain("reef_issues");
    expect(recovered?.issue_ids).toContain("REEF-001");

    const documents = recovered?.documents ?? [];
    expect(
      documents.find((document) => document.path === "overview/vault-skill.md")
        ?.content,
    ).toBe("OUTDATED MANUAL SKILL CONTENT");
    expect(
      documents.find((document) => document.path === "docs/user-notes.md")
        ?.content,
    ).toBe("KEEP THIS USER DOCUMENT");
    expect(
      documents.find((document) => document.path === "reef/runbooks/custom.md")
        ?.content,
    ).toBe("KEEP THIS CUSTOM RUNBOOK");
    expect(
      documents.find((document) => document.path === "issues/reef-001.md")
        ?.content,
    ).toBe("Alpha description from fixture.");
    expect(
      documents.filter((document) =>
        document.path.startsWith("reef/runbooks/"),
      ),
    ).toHaveLength(6);
    expect(
      documents.some((document) => document.path.startsWith("overview/reef/")),
    ).toBe(false);
  });

  test("clears a current brownfield skill stamp before a failed preservation retry", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "workspace_recovery_current_stamp");
    await setWorkspaceInitializationControl(request, {
      operation: "document_get",
      failures: 1,
      successesBeforeFailure: 1,
    });
    await signInAsUser(page, fixtureWriterLogin);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.getByTestId("greenfield-vault-name-input").fill("raw-vault");
    const firstCreateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/vaults" &&
        response.request().method() === "POST",
    );
    await page.getByTestId("greenfield-create-btn").click();
    expect((await firstCreateResponse).ok()).toBe(false);
    await expect(page).toHaveURL(/\/onboarding$/);

    const failedState = await readFixtureState(request);
    const failed = failedState.vaults.find(
      (vault) => vault.name === "raw-vault",
    );
    expect(failed?.settings.custom_setting).toBe("keep-me");
    expect(failed?.settings.vault_skill).toBeUndefined();
    expect(
      failed?.documents.find(
        (document) => document.path === "overview/vault-skill.md",
      )?.content,
    ).toBe("OUTDATED MANUAL SKILL CONTENT");
    expect(
      failed?.documents.find(
        (document) => document.path === "docs/user-notes.md",
      )?.content,
    ).toBe("KEEP THIS USER DOCUMENT");
    expect(
      failed?.documents.find(
        (document) => document.path === "issues/reef-001.md",
      )?.content,
    ).toBe("Alpha description from fixture.");

    await setWorkspaceInitializationControl(request, {
      operation: null,
      failures: 0,
      successesBeforeFailure: null,
    });
    await page.getByTestId("greenfield-create-btn").click();
    await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });

    const retriedState = await readFixtureState(request);
    const retried = retriedState.vaults.find(
      (vault) => vault.name === "raw-vault",
    );
    expect(retried?.settings.custom_setting).toBe("keep-me");
    expect(retried?.settings.vault_skill).toBeUndefined();
    expect(retried?.tables).toContain("reef_issues");
    expect(
      retried?.documents.find(
        (document) => document.path === "overview/vault-skill.md",
      )?.content,
    ).toBe("OUTDATED MANUAL SKILL CONTENT");
  });

  test("keeps a failed initialization retryable after a document failure", async ({
    page,
    request,
  }) => {
    await setWorkspaceInitializationControl(request, {
      operation: "document",
      failures: 1,
      successesBeforeFailure: 2,
    });
    await signInAsUser(page, fixtureWriterLogin);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.getByTestId("greenfield-vault-name-input").fill("reef-retry");
    const firstCreateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/vaults" &&
        response.request().method() === "POST",
    );
    await page.getByTestId("greenfield-create-btn").click();
    expect((await firstCreateResponse).ok()).toBe(false);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByTestId("greenfield-create-error")).toBeVisible();

    const failedState = await readFixtureState(request);
    const partial = failedState.vaults.find(
      (vault) => vault.name === "reef-retry",
    );
    expect(partial).toBeDefined();
    expect(partial?.tables).not.toContain("reef_issues");
    expect(partial?.documents).toHaveLength(2);
    const partialDocuments = partial?.documents ?? [];
    const partialRootContent = partialDocuments.find(
      (document) => document.path === "overview/vault-skill.md",
    )?.content;
    const partialModelContent = partialDocuments.find(
      (document) => document.path === "reef/runbooks/pm-model.md",
    )?.content;
    expect(partialRootContent).toBeTruthy();
    expect(partialModelContent).toBeTruthy();

    await setWorkspaceInitializationControl(request, {
      operation: null,
      failures: 0,
      successesBeforeFailure: null,
    });
    await page.getByTestId("greenfield-create-btn").click();
    await page.waitForURL(/\/issues\/?$/, { timeout: 10_000 });

    const retriedState = await readFixtureState(request);
    const retried = retriedState.vaults.filter(
      (vault) => vault.name === "reef-retry",
    );
    expect(retried).toHaveLength(1);
    expect(retried[0]?.settings.project_prefix).toBe("REEF");
    expect(retried[0]?.tables).toContain("reef_issues");
    expect(
      retried[0]?.documents.find(
        (document) => document.path === "overview/vault-skill.md",
      )?.content,
    ).toBe(partialRootContent);
    expect(
      retried[0]?.documents.find(
        (document) => document.path === "reef/runbooks/pm-model.md",
      )?.content,
    ).toBe(partialModelContent);
    expect(
      retried[0]?.documents.some(
        (document) => document.path === "overview/vault-skill.md",
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

  test("closes the repository popover and restores trigger focus after keyboard selection", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    const trigger = page.getByTestId("greenfield-monitored-repos-trigger");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Search repositories" });
    const search = page.getByTestId("greenfield-monitored-repos-search");
    await expect(dialog).toBeVisible();
    await expect(search).toBeFocused();

    await page.keyboard.press("Tab");
    const option = page.locator(
      '[data-testid="greenfield-monitored-repos-option-octo/reef"]',
    );
    await expect(option).toBeFocused();
    await page.keyboard.press("Space");

    await expect(option).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-label", "1 repo(s) selected");
    await expect(
      page.getByRole("button", { name: "Remove octo/reef" }),
    ).toBeVisible();
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
