import { test as workspaceTest } from "../harness/workspace-fixture";
import {
  expect,
  type APIRequestContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { DEFAULT_CONFIG, REEF_VAULT_SKILL_VERSION } from "@reef/core";
import { DEFAULT_ISSUE_TEMPLATES } from "../../../src/features/settings/lib/defaultIssueTemplates";
import {
  fixtureWriterLogin,
  fixtureReaderLogin,
  readFixtureState,
  setResponseHold,
  releaseResponseHold,
  signInAsAlice,
  signInAsUser,
  setInstallationControl,
  setInstallationExecutionFailure,
  setWorkspaceInitializationControl,
  waitForPasswordLogin,
  writeIndexedDbConfig,
} from "../harness/fixture";

const test = workspaceTest.extend({ scenario: "empty" });

// Keep the command's immediate vault refresh inactive. The status poll then
// owns initialization success/failure before onboarding can resume a workspace.
async function approveInstallation(
  page: Page,
  request: APIRequestContext,
  vault: string,
) {
  await setResponseHold(request, "installation-execution", true);
  let accepted = false;
  const command = page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/vaults/${vault}/installation`,
    )
    .then((response) => {
      accepted = true;
      return response;
    });
  const refreshedVaults = page.waitForResponse(
    (response) =>
      accepted &&
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/vaults",
  );
  await page
    .getByTestId("greenfield-approval-step")
    .getByTestId(`installation-${vault}-approve`)
    .click();
  expect((await command).status()).toBe(202);
  const refreshed = await (await refreshedVaults).json();
  expect(
    refreshed.vaults.find(
      (candidate: { name: string; installation_active: boolean | null }) =>
        candidate.name === vault,
    )?.installation_active,
  ).toBe(false);
  await releaseResponseHold(request, "installation-execution");
}

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
  test.extend({ scenario: "notifications_personal" })(
    "an active initialized reader enters the workspace without management details",
    async ({ context, page, request }) => {
      await signInAsAlice(page);

      const ownerVaults = await page.request.get("/api/vaults");
      expect(ownerVaults.ok()).toBe(true);
      expect(
        (await ownerVaults.json()).vaults.find(
          (vault: { name: string }) => vault.name === "reef-e2e",
        )?.installation_active,
      ).toBe(true);

      await context.clearCookies();
      await signInAsUser(page, fixtureReaderLogin);
      await page.waitForURL(/\/workspace\/[^/]+\/issues\/?$/, {
        timeout: 15_000,
      });
      await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();

      const readerLanding = new URL(page.url()).pathname.match(
        /^\/workspace\/([^/]+)\/issues\/?$/u,
      )?.[1];
      if (!readerLanding) {
        throw new Error("reader did not enter a workspace");
      }
      const readerVaults = await page.request.get("/api/vaults");
      expect(readerVaults.ok()).toBe(true);
      const readerVaultList = (await readerVaults.json()) as {
        vaults: Array<{ name: string; installation_active: boolean | null }>;
      };
      expect(
        readerVaultList.vaults.some(
          (vault) =>
            vault.name === readerLanding && vault.installation_active === true,
        ),
      ).toBe(true);

      await page.goto("/workspace/reef-e2e/issues");
      await expect(page).toHaveURL(/\/workspace\/reef-e2e\/issues\/?$/);
      await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();

      const statusResponse = await page.request.get(
        "/api/vaults/reef-e2e/installation",
      );
      expect(statusResponse.ok()).toBe(true);
      expect(await statusResponse.json()).toEqual({
        installation_status: "ready",
      });

      const mutationResponse = await page.request.post(
        "/api/vaults/reef-e2e/installation",
        { data: { mode: "install" } },
      );
      expect(mutationResponse.status()).toBe(403);
    },
  );

  test.extend({ scenario: "installation_drift" })(
    "onboarding keeps existing setup tasks out for owners and readers",
    async ({ context, page, request }) => {
      for (const vault of ["reef-e2e", "reef-zeta"]) {
        await setInstallationControl(request, {
          vault,
          lifecycle: "uninstalled",
          memberLookup: "healthy",
        });
      }

      for (const account of ["owner", "reader"] as const) {
        if (account === "owner") {
          await signInAsAlice(page);
        } else {
          await context.clearCookies();
          await signInAsUser(page, fixtureReaderLogin);
        }

        await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
        await expect(page.getByTestId("onboarding-panel")).toBeVisible();
        await expect(
          page.getByTestId("greenfield-vault-name-input"),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Existing workspaces" }),
        ).toHaveCount(0);
        for (const action of [
          "Set up Reef",
          "Restore installation",
          "Request fresh setup",
          "Check status",
        ]) {
          await expect(page.getByRole("button", { name: action })).toHaveCount(
            0,
          );
        }

        await expect(
          page.getByTestId("workspace-installation-reef-e2e"),
        ).toHaveCount(0);
        await expect(
          page.getByTestId("workspace-installation-reef-zeta"),
        ).toHaveCount(0);
        await expect(
          page.getByTestId("workspace-installation-raw-vault"),
        ).toHaveCount(0);
      }
    },
  );

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

    await expect(page.getByTestId("greenfield-approval-step")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
    const installResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/vaults/reef-new/installation" &&
        response.request().method() === "POST",
    );
    await approveInstallation(page, request, "reef-new");
    const installResponse = await installResponsePromise;
    expect(installResponse.status()).toBe(202);
    expect(await installResponse.json()).toMatchObject({
      installation_status: "installing",
      command_status: "accepted",
      replayed: false,
    });
    await page.waitForURL(/\/issues\/?(?:\?.*)?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await expect(page.getByTestId("sidebar-workspace-trigger")).toContainText(
      "reef-new",
    );

    const state = await readFixtureState(request);
    const created = state.vaults.find((vault) => vault.name === "reef-new");
    expect(created?.installation?.lifecycle).toBe("active");
    expect(created?.settings.project_prefix).toBe(
      DEFAULT_CONFIG.project_prefix,
    );
    expect(created?.monitored_repos).toEqual(DEFAULT_CONFIG.monitored_repos);
    const expectedTemplates = DEFAULT_ISSUE_TEMPLATES.map((template) => ({
      name: template.name,
      label: template.label,
      description: template.description,
      title_prefix: template.title_prefix ?? null,
      priority: template.priority ?? null,
      default_labels: template.default_labels ?? [],
      body: template.body,
    }));
    expect(created?.templates).toEqual(expectedTemplates);
    expect(created?.templates).toHaveLength(6);
    const documentPaths = created?.documents.map(({ path }) => path) ?? [];
    expect(documentPaths).toContain("overview/vault-skill.md");
    const rootGuide = created?.documents.find(
      ({ path }) => path === "overview/vault-skill.md",
    );
    expect(rootGuide?.title).toBe("reef-new Guide");
    expect(rootGuide?.summary).toBe(
      "> Edit this document to describe how agents should write into this vault.",
    );
    expect(rootGuide?.tags).toEqual(["akb:skill"]);
    expect(rootGuide?.content).toContain("## Document Template");
    expect(rootGuide?.content).toContain("## Relation rules");
    expect(rootGuide?.content).toContain("AKB-default template");
    expect(rootGuide?.content).toContain("## Reef PM Workspace Instructions");
    expect(
      rootGuide?.content.match(/## Reef PM Workspace Instructions/g),
    ).toHaveLength(1);
    expect(created?.settings.vault_skill).toMatchObject({
      version: REEF_VAULT_SKILL_VERSION,
    });
    expect(
      documentPaths.filter((path) => path.startsWith("reef/runbooks/")),
    ).toHaveLength(5);
    expect(
      created?.documents.find(
        ({ path }) => path === "reef/runbooks/pm-model.md",
      )?.content,
    ).toContain("reef_issues");
    const readyStatus = await page.request.get(
      "/api/vaults/reef-new/installation",
    );
    expect(readyStatus.ok()).toBe(true);
    expect(await readyStatus.json()).toMatchObject({
      installation_status: "ready",
    });
    const replayedInstall = await page.request.post(
      "/api/vaults/reef-new/installation",
      { data: { mode: "install" } },
    );
    expect(replayedInstall.status()).toBe(200);
    expect(await replayedInstall.json()).toMatchObject({
      installation_status: "ready",
      command_status: "already_applied",
      replayed: true,
    });
    expect(
      state.calls.some(
        (call) =>
          call.method === "POST" &&
          call.path === "/akb/api/v1/tables/reef-new/sql",
      ),
    ).toBe(true);
  });

  test("does not make a workspace ready when its installation execution fails", async ({
    page,
    request,
  }) => {
    await setInstallationExecutionFailure(request, "reef-failed", true);
    await signInAsAlice(page);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
    await page.getByTestId("greenfield-vault-name-input").fill("reef-failed");
    await page.getByTestId("greenfield-create-btn").click();
    await expect(page.getByTestId("greenfield-approval-step")).toBeVisible();

    const installResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/vaults/reef-failed/installation" &&
        response.request().method() === "POST",
    );
    await approveInstallation(page, request, "reef-failed");
    const installResponse = await installResponsePromise;
    expect(installResponse.status()).toBe(202);
    expect(await installResponse.json()).toMatchObject({
      installation_status: "installing",
      command_status: "accepted",
    });

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults.find((vault) => vault.name === "reef-failed")
          ?.installation?.lifecycle;
      })
      .toBe("blocked");
    await expect(page).toHaveURL(/\/onboarding$/);
    const status = await page.request.get(
      "/api/vaults/reef-failed/installation",
    );
    expect(status.ok()).toBe(true);
    expect(await status.json()).toMatchObject({
      installation_status: "blocked",
    });

    const failed = (await readFixtureState(request)).vaults.find(
      (vault) => vault.name === "reef-failed",
    );
    expect(failed?.installation?.lifecycle).toBe("blocked");
    expect(failed?.tables).toEqual([]);
    expect(failed?.templates).toEqual([]);
    expect(failed?.documents).toHaveLength(1);
    expect(failed?.documents[0]).toMatchObject({
      path: "overview/vault-skill.md",
      title: "reef-failed Guide",
      tags: ["akb:skill"],
    });
  });

  test("creates a workspace as a non-admin and can create and read an issue", async ({
    page,
    request,
  }) => {
    await signInAsUser(page, fixtureWriterLogin);
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

    await page.getByTestId("greenfield-vault-name-input").fill("reef-new");
    await page.getByTestId("greenfield-create-btn").click();
    await expect(page.getByTestId("greenfield-approval-step")).toBeVisible();
    await approveInstallation(page, request, "reef-new");
    await page.waitForURL(/\/issues\/?(?:\?.*)?$/, { timeout: 10_000 });

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
  });

  test.extend({ scenario: "workspace_recovery" })(
    "recovers an incomplete brownfield workspace without replacing user data",
    async ({ page, request }) => {
      await signInAsUser(page, fixtureWriterLogin);
      await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

      await page.getByTestId("greenfield-vault-name-input").fill("raw-vault");
      await page.getByTestId("greenfield-create-btn").click();
      await expect(page.getByTestId("greenfield-approval-step")).toBeVisible();
      await approveInstallation(page, request, "raw-vault");
      await page.waitForURL(/\/issues\/?(?:\?.*)?$/, { timeout: 10_000 });

      const state = await readFixtureState(request);
      const recovered = state.vaults.find(
        (vault) => vault.name === "raw-vault",
      );
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
        documents.find(
          (document) => document.path === "overview/vault-skill.md",
        )?.content,
      ).toBe("OUTDATED MANUAL SKILL CONTENT");
      expect(
        documents.find((document) => document.path === "docs/user-notes.md")
          ?.content,
      ).toBe("KEEP THIS USER DOCUMENT");
      expect(
        documents.find(
          (document) => document.path === "reef/runbooks/custom.md",
        )?.content,
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
        documents.some((document) =>
          document.path.startsWith("overview/reef/"),
        ),
      ).toBe(false);
    },
  );

  test.extend({ scenario: "workspace_recovery_current_stamp" })(
    "clears a current brownfield skill stamp before a failed preservation retry",
    async ({ page, request }) => {
      const initial = (await readFixtureState(request)).vaults.find(
        (vault) => vault.name === "raw-vault",
      );
      expect(initial?.settings.vault_skill).toMatchObject({
        version: REEF_VAULT_SKILL_VERSION,
      });
      await setWorkspaceInitializationControl(request, {
        operation: "document_get",
        failures: 1,
        // The owner readiness probe and initialization preflight each read the
        // existing root document and observe one missing managed document. Let
        // those four reads and the preservation root read finish, then fail on
        // the next preservation read after its old stamp has been cleared.
        successesBeforeFailure: 5,
      });
      await signInAsUser(page, fixtureWriterLogin);
      await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

      await page.getByTestId("greenfield-vault-name-input").fill("raw-vault");
      const initializationFailure = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/vaults/raw-vault/installation" &&
          response.request().method() === "GET" &&
          response.status() >= 500,
      );
      const firstInstallResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/vaults/raw-vault/installation" &&
          response.request().method() === "POST",
      );
      await page.getByTestId("greenfield-create-btn").click();
      await expect(page.getByTestId("greenfield-approval-step")).toBeVisible();
      await approveInstallation(page, request, "raw-vault");
      const installResponse = await firstInstallResponse;
      expect(installResponse.status()).toBe(202);
      expect(await installResponse.json()).toMatchObject({
        installation_status: "installing",
        command_status: "accepted",
      });
      expect((await initializationFailure).status()).toBeGreaterThanOrEqual(
        500,
      );
      await expect(
        page.getByTestId("greenfield-approval-step").getByRole("alert"),
      ).toBeVisible();
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
      await page.getByRole("button", { name: "Check status" }).click();
      await page.waitForURL(/\/issues\/?(?:\?.*)?$/, { timeout: 10_000 });

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
    },
  );

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
    const initializationFailure = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/vaults/reef-retry/installation" &&
        response.request().method() === "GET" &&
        response.status() >= 500,
    );
    const firstInstallResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/vaults/reef-retry/installation" &&
        response.request().method() === "POST",
    );
    await page.getByTestId("greenfield-create-btn").click();
    await expect(page.getByTestId("greenfield-approval-step")).toBeVisible();
    await approveInstallation(page, request, "reef-retry");
    const installResponse = await firstInstallResponse;
    expect(installResponse.status()).toBe(202);
    expect(await installResponse.json()).toMatchObject({
      installation_status: "installing",
      command_status: "accepted",
    });
    expect((await initializationFailure).status()).toBeGreaterThanOrEqual(500);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByTestId("greenfield-approval-step").getByRole("alert"),
    ).toBeVisible();

    const failedState = await readFixtureState(request);
    const partial = failedState.vaults.find(
      (vault) => vault.name === "reef-retry",
    );
    expect(partial).toBeDefined();
    expect(partial?.tables).toContain("reef_issues");
    expect(partial?.documents).toHaveLength(3);
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
    await page.getByRole("button", { name: "Check status" }).click();
    await page.waitForURL(/\/issues\/?(?:\?.*)?$/, { timeout: 10_000 });

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

  test.extend({ scenario: "raw_only" })(
    "shows the create form when no vault has reef config",
    async ({ page }) => {
      await signInAsAlice(page);
      await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });

      await expect(
        page.locator('[data-testid="greenfield-vault-name-input"]'),
      ).toBeVisible();
    },
  );

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

  test.extend({ scenario: "configured_multi" })(
    "prefers a remembered configured workspace",
    async ({ page }) => {
      await page.goto("/login");
      await waitForPasswordLogin(page);
      await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
      await writeIndexedDbConfig(page, "vault", "reef-zeta");

      await signInAsAlice(page);
      await expect(page).toHaveURL(/\/workspace\/reef-zeta\/issues\/?$/, {
        timeout: 15_000,
      });
    },
  );

  test.extend({ scenario: "configured_multi" })(
    "rechecks a remembered workspace after cached selection and re-login",
    async ({ context, page }) => {
      await signInAsAlice(page);
      await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/, {
        timeout: 15_000,
      });
      await expect
        .poll(() =>
          page.evaluate(() =>
            localStorage.getItem("REACT_QUERY_OFFLINE_CACHE"),
          ),
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
    },
  );

  test.extend({ scenario: "configured_multi" })(
    "uses ASCII order for an invalid remembered workspace",
    async ({ page }) => {
      await page.goto("/login");
      await waitForPasswordLogin(page);
      await writeIndexedDbConfig(page, "akb_user_id", "user-alice");
      await writeIndexedDbConfig(page, "vault", "missing");

      await signInAsAlice(page);
      await expect(page).toHaveURL(/\/workspace\/reef-alpha\/issues\/?$/, {
        timeout: 15_000,
      });
    },
  );

  test.extend({ scenario: "configured" })(
    "auto-resumes direct onboarding and Back does not return to it",
    async ({ page }) => {
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
    },
  );
});
