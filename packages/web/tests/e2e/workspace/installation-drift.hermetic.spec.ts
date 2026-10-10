import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  E2E_REEF_OLD_SCHEMA_FINGERPRINT,
  E2E_REEF_RELEASE_VERSION,
  E2E_REEF_SCHEMA_FINGERPRINT,
} from "../harness/mock-installation.mjs";
import {
  clearPersistedQueryCache,
  clearPersistedQueryCacheOnLoad,
  fixtureReaderLogin,
  fixtureWriterLogin,
  readFixtureState,
  resetFixture,
  setInstallationControl,
  signInAsAlice,
  signInAsUser,
  writeIndexedDbConfig,
} from "../harness/fixture";

const localizedInstallationActions = {
  en: {
    checkStatus: "Check status",
    setup: "Set up Reef",
    restore: "Restore installation",
    fresh: "Request fresh setup",
  },
  ko: {
    checkStatus: "상태 확인",
    setup: "Reef 설정하기",
    restore: "설치 복원하기",
    fresh: "새 설정 요청",
  },
} as const;

async function attachFullPageScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(name);
  await page.addStyleTag({
    content:
      'script[data-nextjs-dev-overlay="true"], nextjs-portal { display: none !important; }',
  });
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.describe("installation drift and readiness guidance", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "installation_drift");
  });

  test("an active workspace stays usable while owner details show observed drift", async ({
    page,
    request,
  }, testInfo) => {
    await setInstallationControl(request, {
      lifecycle: "active",
      blockedReason: "null",
      drift: { release: "mismatch", schema: "mismatch", grant: "mismatch" },
      observation: "stale",
    });
    await signInAsAlice(page);
    await page.goto("/workspace/reef-e2e/issues");
    await page.goto("/workspace/reef-e2e/settings/workspace");

    const settings = page.getByTestId("workspace-installation-section");
    await expect(settings).toBeVisible();
    await expect(
      page.getByTestId("workspace-installation-reef-e2e"),
    ).toHaveCount(0);
    const disclosure = settings.getByTestId("installation-details-disclosure");
    await expect(disclosure).not.toHaveAttribute("open");
    await attachFullPageScreenshot(page, testInfo, "owner-ready-default.png");

    const details = page.getByTestId("installation-details");
    await disclosure.locator("summary").click();
    await settings.evaluate((element) =>
      element.scrollIntoView({ block: "start", inline: "nearest" }),
    );
    await expect(details).toHaveAttribute("data-overall-drift", "drifted");
    await expect(
      details.getByTestId("installation-overall-drift"),
    ).toHaveAttribute("data-drift-status", "drifted");
    await expect(details.getByTestId("installation-overall-drift")).toHaveText(
      /Overall drift.*Drift detected/,
    );
    await expect(page.getByTestId("installation-drift-warning")).toHaveCount(0);
    await expect(
      details.getByTestId("installation-comparison-release"),
    ).toBeVisible();
    await expect(
      details.getByTestId("installation-comparison-schema"),
    ).toBeVisible();
    await expect(
      details.getByTestId("installation-comparison-grant"),
    ).toBeVisible();
    await expect(
      details.getByText(E2E_REEF_RELEASE_VERSION, { exact: true }),
    ).toHaveCount(1);
    const schema = details.getByTestId("installation-comparison-schema");
    await expect(
      schema.getByText(E2E_REEF_OLD_SCHEMA_FINGERPRINT, { exact: true }),
    ).toBeVisible();
    await expect(
      schema.getByText(E2E_REEF_SCHEMA_FINGERPRINT, { exact: true }),
    ).toHaveCount(1);
    await expect(
      schema.getByText(
        "Expected schema fingerprint · Installation snapshot fingerprint",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      schema.getByText("Observed drift fingerprint", { exact: true }),
    ).toBeVisible();
    for (const dimension of ["release", "schema"] as const) {
      const values = details
        .getByTestId(`installation-comparison-${dimension}`)
        .locator("dd");
      await expect(values).toHaveCount(2);
      const [firstValueTop, secondValueTop] = await Promise.all([
        values
          .nth(0)
          .evaluate((element) => element.getBoundingClientRect().top),
        values
          .nth(1)
          .evaluate((element) => element.getBoundingClientRect().top),
      ]);
      expect(Math.abs(firstValueTop - secondValueTop)).toBeLessThan(1);
    }
    for (const value of [
      E2E_REEF_OLD_SCHEMA_FINGERPRINT,
      E2E_REEF_SCHEMA_FINGERPRINT,
    ]) {
      const fingerprint = schema.locator("dd").filter({ hasText: value });
      await expect(fingerprint).toHaveCount(1);
      await expect(fingerprint).toHaveCSS("word-break", "break-all");
      expect(
        await fingerprint.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    await expect(
      details.getByTestId("installation-observed-at"),
    ).toHaveAttribute("datetime", "2020-01-01T00:00:00.000Z");
    await expect(
      details.getByTestId("installation-observed-at"),
    ).not.toHaveText(/T00:00:00\.000Z/);
    await attachFullPageScreenshot(
      page,
      testInfo,
      "owner-ready-technical-details.png",
    );

    const status = await page.request.get("/api/vaults/reef-e2e/installation");
    expect(status.ok()).toBe(true);
    expect((await status.json()).installation.drift.schema.status).toBe(
      "mismatch",
    );

    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
  });

  test("writer and reader responses stay minimal and role changes clear cached details", async ({
    context,
    page,
  }) => {
    await signInAsAlice(page);
    await page.goto("/workspace/reef-e2e/issues");
    await page.goto("/workspace/reef-e2e/settings/workspace");
    const ownerSettings = page.getByTestId("workspace-installation-section");
    await expect(ownerSettings).toBeVisible();
    await expect(
      page.getByTestId("workspace-installation-reef-e2e"),
    ).toHaveCount(0);
    const ownerDisclosure = ownerSettings.getByTestId(
      "installation-details-disclosure",
    );
    await expect(ownerDisclosure).not.toHaveAttribute("open");
    await ownerDisclosure.locator("summary").click();
    await expect(page.getByTestId("installation-details")).toBeVisible();

    await setInstallationControl(page.request, { roles: { alice: "writer" } });
    await page.reload();
    await expect(
      page.getByTestId("workspace-installation-section"),
    ).toHaveCount(0);
    await expect(page.getByTestId("installation-details")).toHaveCount(0);
    await expect(
      page.getByTestId("installation-details-disclosure"),
    ).toHaveCount(0);

    for (const credentials of [fixtureWriterLogin, fixtureReaderLogin]) {
      await context.clearCookies();
      await signInAsUser(page, credentials);
      await page.goto("/workspace/reef-e2e/settings/workspace");
      await expect(
        page.getByTestId("workspace-installation-section"),
      ).toHaveCount(0);
      await expect(page.getByTestId("installation-details")).toHaveCount(0);
      const status = await page.request.get(
        "/api/vaults/reef-e2e/installation",
      );
      expect(status.ok()).toBe(true);
      expect(await status.json()).toEqual({ installation_status: "ready" });
    }
  });

  test("blocked guidance permits read-only checks, owner diagnostics, and switching to another ready workspace", async ({
    context,
    page,
    request,
  }, testInfo) => {
    await setInstallationControl(request, {
      lifecycle: "blocked",
      blockedReason: "worker_timeout",
      drift: { release: "mismatch", schema: "mismatch", grant: "mismatch" },
      observation: "stale",
    });
    await signInAsAlice(page);
    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByTestId("workspace-access-denied")).toBeVisible();
    const availability = page.getByTestId("workspace-installation-reef-e2e");
    await expect(availability).toHaveAttribute(
      "data-status",
      "management_required",
    );
    await expect(
      availability.getByText("This workspace can't be used right now."),
    ).toBeVisible();
    await expect(
      availability.getByText(
        "Check the workspace status again, or open its settings to review setup details.",
      ),
    ).toBeVisible();
    await expect(
      availability.getByText(
        "Workspace owner or admin; an installation operator may need to help.",
      ),
    ).toBeVisible();
    await expect(
      availability.getByRole("button", { name: "Check status" }),
    ).toBeVisible();
    for (const action of [
      "Set up Reef",
      "Restore installation",
      "Request fresh setup",
    ]) {
      await expect(
        availability.getByRole("button", { name: action }),
      ).toHaveCount(0);
    }
    await expect(
      page.getByTestId("installation-diagnostics-link-reef-e2e"),
    ).toHaveAttribute("href", "/workspace/reef-e2e/settings/workspace");
    await expect(
      availability.getByTestId("installation-details-disclosure"),
    ).toHaveCount(0);
    await attachFullPageScreenshot(page, testInfo, "owner-blocked-access.png");
    await page.getByRole("button", { name: "Check status" }).click();
    await expect(
      page.getByRole("button", { name: "Check status" }),
    ).toBeEnabled();

    const ownerState = await readFixtureState(request);
    expect(
      ownerState.calls.some(
        (call) =>
          ["POST", "PUT", "DELETE"].includes(call.method) &&
          call.path.includes("/installations/"),
      ),
    ).toBe(false);

    await page.getByTestId("installation-diagnostics-link-reef-e2e").click();
    await expect(page).toHaveURL(/\/workspace\/reef-e2e\/settings\/workspace$/);
    await expect(
      page.getByTestId("workspace-installation-diagnostics"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
    const diagnostics = page.getByTestId("workspace-installation-section");
    await expect(
      diagnostics.getByTestId("workspace-installation-reef-e2e"),
    ).toHaveAttribute("data-status", "blocked");
    await expect(diagnostics.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(diagnostics.getByRole("heading", { level: 3 })).toHaveCount(1);
    await expect(page.getByTestId("settings-tabs")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set up Reef" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Restore installation" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Request fresh setup" }),
    ).toHaveCount(0);
    await expect(diagnostics).toBeVisible();
    await expect(
      diagnostics.getByText("People can't use this workspace right now."),
    ).toBeVisible();
    const details = diagnostics.getByTestId("installation-details-disclosure");
    await details.locator("summary").click();
    await expect(page.getByTestId("installation-details")).toHaveAttribute(
      "data-overall-drift",
      "drifted",
    );
    const release = diagnostics.getByTestId("installation-comparison-release");
    await expect(
      release.getByText(E2E_REEF_RELEASE_VERSION, { exact: true }),
    ).toHaveCount(1);
    await expect(release.getByText("0.15.0", { exact: true })).toBeVisible();
    await expect(
      release.getByText(
        "Desired release · Current release · Installation snapshot release",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      release.getByText("Drift comparison observed release", { exact: true }),
    ).toBeVisible();
    await expect(
      diagnostics
        .getByTestId("installation-comparison-release")
        .locator("[data-drift-status]"),
    ).toHaveAttribute("data-drift-status", "mismatch");
    await expect(page.getByText(/Workspace remains available/)).toHaveCount(0);
    await expect(
      page.getByTestId("installation-blocked-guidance"),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("installation-blocked-guidance")
        .getByText("Run the exact Transition Plan preflight."),
    ).toBeVisible();
    await expect(
      diagnostics.getByRole("button", { name: "Check status" }),
    ).toBeVisible();

    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByTestId("workspace-access-denied")).toBeVisible();
    await expect(
      page.getByTestId("access-denied-workspace-reef-zeta"),
    ).toBeVisible();

    await context.clearCookies();
    await signInAsUser(page, fixtureReaderLogin);
    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByTestId("workspace-access-denied")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "This workspace is unavailable.",
      }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("workspace-installation-reef-e2e")
        .getByText(
          "Check the workspace status again. If it remains unavailable, ask a workspace owner or admin to check it.",
        ),
    ).toBeVisible();
    await expect(
      page.getByText("The installation worker timed out."),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("installation-details-disclosure"),
    ).toHaveCount(0);
    await attachFullPageScreenshot(page, testInfo, "member-blocked.png");
    const memberStatus = await page.request.get(
      "/api/vaults/reef-e2e/installation",
    );
    expect(memberStatus.ok()).toBe(true);
    expect(await memberStatus.json()).toEqual({
      installation_status: "management_required",
    });
    await expect(
      page.getByTestId("access-denied-workspace-reef-zeta"),
    ).toBeVisible();
  });

  test("installation status surfaces render across role, locale, theme, and viewport", async ({
    context,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(900_000);
    const roles = ["owner", "admin", "writer", "reader"] as const;
    const locales = ["en", "ko"] as const;
    const themes = ["light", "dark"] as const;
    const viewports = [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ] as const;
    const surfacePaths = {
      settings: "/workspace/reef-e2e/settings/workspace",
      access: "/workspace/reef-e2e/issues",
    } as const;

    for (const role of roles) {
      for (const locale of locales) {
        for (const theme of themes) {
          for (const viewport of viewports) {
            const canManage = role === "owner" || role === "admin";
            const appearance = `${role}--${locale}--${theme}--${viewport.name}`;
            await context.clearCookies();
            await page.setViewportSize({
              width: viewport.width,
              height: viewport.height,
            });
            await page.emulateMedia({
              colorScheme: theme === "dark" ? "dark" : "light",
            });
            await page.goto("/login?redirect=%2Fonboarding");
            await context.addCookies([
              {
                name: "NEXT_LOCALE",
                value: locale,
                url: new URL(page.url()).origin,
              },
            ]);
            await page.reload({ waitUntil: "domcontentloaded" });
            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            if (canManage) {
              await setInstallationControl(request, {
                roles: { alice: role, bob: "reader", writer: "writer" },
              });
              await signInAsAlice(page);
            } else {
              await signInAsUser(
                page,
                role === "writer" ? fixtureWriterLogin : fixtureReaderLogin,
              );
            }
            await writeIndexedDbConfig(page, "locale", locale);
            await writeIndexedDbConfig(page, "theme", theme);
            await page.evaluate((selectedTheme) => {
              window.localStorage.setItem("reef.theme", selectedTheme);
            }, theme);
            await page.reload({ waitUntil: "domcontentloaded" });
            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            await expect
              .poll(() =>
                page
                  .locator("html")
                  .evaluate((element) => element.classList.contains("dark")),
              )
              .toBe(theme === "dark");

            await setInstallationControl(request, {
              lifecycle: "active",
              blockedReason: "null",
              drift: {
                release: "mismatch",
                schema: "mismatch",
                grant: "mismatch",
              },
              observation: "stale",
            });
            await clearPersistedQueryCache(page);
            await clearPersistedQueryCacheOnLoad(page);
            await page.goto("/workspace/reef-e2e/issues");
            await page.goto(surfacePaths.settings);
            const settingsSection = page.getByTestId(
              "workspace-installation-section",
            );
            if (canManage) {
              await expect(settingsSection).toBeVisible();
              await expect(
                page.getByTestId("workspace-installation-reef-e2e"),
              ).toHaveCount(0);
              await expect(
                settingsSection.getByTestId("installation-details-disclosure"),
              ).not.toHaveAttribute("open");
            } else {
              await expect(settingsSection).toHaveCount(0);
            }
            await attachFullPageScreenshot(
              page,
              testInfo,
              `settings--${appearance}--default.png`,
            );
            if (canManage) {
              await settingsSection
                .getByTestId("installation-details-disclosure")
                .locator("summary")
                .click();
              await expect(
                settingsSection.getByTestId("installation-details"),
              ).toBeVisible();
              await settingsSection.evaluate((element) =>
                element.scrollIntoView({ block: "start", inline: "nearest" }),
              );
              await attachFullPageScreenshot(
                page,
                testInfo,
                `settings--${appearance}--details.png`,
              );
              if (viewport.name === "mobile") {
                const observedAt = settingsSection.getByTestId(
                  "installation-observed-at",
                );
                await observedAt.scrollIntoViewIfNeeded();
                const observedBounds = await observedAt.boundingBox();
                expect(observedBounds?.y).toBeGreaterThanOrEqual(0);
                expect(
                  (observedBounds?.y ?? viewport.height) +
                    (observedBounds?.height ?? viewport.height),
                ).toBeLessThanOrEqual(viewport.height);
                await attachFullPageScreenshot(
                  page,
                  testInfo,
                  `settings--${appearance}--details-bottom.png`,
                );
              }
            }

            await setInstallationControl(request, {
              vault: "reef-e2e",
              lifecycle: "blocked",
              blockedReason: "worker_timeout",
            });
            await setInstallationControl(request, {
              vault: "reef-zeta",
              lifecycle: "blocked",
              blockedReason: "worker_timeout",
            });
            const blockedVaultsResponse = await page.request.get("/api/vaults");
            expect(blockedVaultsResponse.ok()).toBe(true);
            const blockedVaultsPayload =
              (await blockedVaultsResponse.json()) as {
                vaults: Array<{
                  name: string;
                  installation_active: boolean | null;
                }>;
              };
            expect(
              blockedVaultsPayload.vaults
                .filter((vault) =>
                  ["reef-e2e", "reef-zeta"].includes(vault.name),
                )
                .every((vault) => vault.installation_active !== true),
            ).toBe(true);
            await setInstallationControl(request, {
              vault: "reef-e2e",
              lifecycle: "blocked",
              blockedReason: "worker_timeout",
            });
            await setInstallationControl(request, {
              vault: "reef-zeta",
              lifecycle: "active",
              blockedReason: "null",
            });
            await clearPersistedQueryCache(page);
            await clearPersistedQueryCacheOnLoad(page);
            await page.goto(surfacePaths.access);
            await expect(
              page.getByTestId("workspace-access-denied"),
            ).toBeVisible();
            await expect(
              page.getByRole("heading", {
                name: /This workspace is unavailable\.|지금 이 워크스페이스를 이용할 수 없습니다/,
              }),
            ).toBeVisible();
            const accessCard = page.getByTestId(
              "workspace-installation-reef-e2e",
            );
            const actions = localizedInstallationActions[locale];
            await expect(accessCard).toHaveAttribute(
              "data-status",
              "management_required",
            );
            await expect(
              accessCard.getByRole("button", { name: actions.checkStatus }),
            ).toBeVisible();
            for (const action of [
              actions.setup,
              actions.restore,
              actions.fresh,
            ]) {
              await expect(
                accessCard.getByRole("button", { name: action }),
              ).toHaveCount(0);
            }
            if (canManage) {
              await expect(
                page.getByTestId("installation-diagnostics-link-reef-e2e"),
              ).toHaveAttribute(
                "href",
                "/workspace/reef-e2e/settings/workspace",
              );
            } else {
              await expect(
                page.getByTestId("installation-diagnostics-link-reef-e2e"),
              ).toHaveCount(0);
            }
            await attachFullPageScreenshot(
              page,
              testInfo,
              `access--${appearance}--default.png`,
            );
            await expect(
              accessCard.getByTestId("installation-details-disclosure"),
            ).toHaveCount(0);
            await expect(
              accessCard.getByTestId("installation-blocked-guidance"),
            ).toHaveCount(0);
            const accessHeading = page.getByRole("heading", {
              name: /This workspace is unavailable\.|지금 이 워크스페이스를 이용할 수 없습니다/,
            });
            const headingBounds = await accessHeading.boundingBox();
            expect(headingBounds?.y).toBeGreaterThanOrEqual(0);
            expect(headingBounds?.y).toBeLessThan(viewport.height);
          }
        }
      }
    }
  });

  test("installation detail lookup outcomes are isolated to the selected vault", async ({
    page,
    request,
  }) => {
    await signInAsAlice(page);

    for (const mode of ["unavailable", "forbidden", "invalid"] as const) {
      await setInstallationControl(request, {
        vault: "reef-e2e",
        memberLookup: "healthy",
        detailLookup: mode,
      });
      const affected = await page.request.get(
        "/api/vaults/reef-e2e/installation",
      );
      expect(affected.status()).toBe(mode === "forbidden" ? 403 : 503);

      const healthy = await page.request.get(
        "/api/vaults/reef-zeta/installation",
      );
      expect(healthy.ok()).toBe(true);
      expect((await healthy.json()).installation_status).toBe("ready");

      const state = await readFixtureState(request);
      expect(state.installation_drift.lookup_modes["reef-e2e"]).toEqual({
        member_lookup: "healthy",
        detail_lookup: mode,
      });
      expect(state.installation_drift.lookup_modes["reef-zeta"]).toEqual({
        member_lookup: "healthy",
        detail_lookup: "healthy",
      });
    }
  });

  test("reader and writer lookup failures stay minimal and recover when healthy", async ({
    context,
    page,
    request,
  }) => {
    for (const credentials of [fixtureWriterLogin, fixtureReaderLogin]) {
      await context.clearCookies();
      await signInAsUser(page, credentials);

      for (const mode of ["unavailable", "forbidden", "invalid"] as const) {
        await setInstallationControl(request, {
          vault: "reef-e2e",
          memberLookup: mode,
        });
        const affected = await page.request.get(
          "/api/vaults/reef-e2e/installation",
        );
        expect(affected.status()).toBe(mode === "forbidden" ? 403 : 503);

        const healthyOtherVault = await page.request.get(
          "/api/vaults/reef-zeta/installation",
        );
        expect(healthyOtherVault.ok()).toBe(true);
        expect((await healthyOtherVault.json()).installation_status).toBe(
          "ready",
        );
      }

      await setInstallationControl(request, {
        vault: "reef-e2e",
        memberLookup: "healthy",
      });
      const recovered = await page.request.get(
        "/api/vaults/reef-e2e/installation",
      );
      expect(recovered.ok()).toBe(true);
      expect(await recovered.json()).toEqual({
        installation_status: "ready",
      });

      await setInstallationControl(request, {
        vault: "reef-e2e",
        lifecycle: "uninstalled",
        memberLookup: "healthy",
      });
      const inactive = await page.request.get(
        "/api/vaults/reef-e2e/installation",
      );
      expect(inactive.ok()).toBe(true);
      expect(await inactive.json()).toEqual({
        installation_status: "management_required",
      });

      await setInstallationControl(request, {
        vault: "reef-e2e",
        lifecycle: "active",
      });
      const activeAgain = await page.request.get(
        "/api/vaults/reef-e2e/installation",
      );
      expect(activeAgain.ok()).toBe(true);
      expect(await activeAgain.json()).toEqual({
        installation_status: "ready",
      });
    }
  });
});
