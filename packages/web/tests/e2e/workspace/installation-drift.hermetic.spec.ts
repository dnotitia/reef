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

    const installation = page.getByTestId("workspace-installation-reef-e2e");
    await expect(installation).toHaveAttribute("data-status", "ready");
    await expect(
      installation.getByRole("heading", { name: "Workspace status" }),
    ).toBeVisible();
    await expect(
      installation.getByText(/People can continue working/),
    ).toBeVisible();
    await expect(
      installation.getByTestId("installation-check-status-note"),
    ).toBeVisible();
    const disclosure = installation.getByTestId(
      "installation-details-disclosure",
    );
    await expect(disclosure).not.toHaveAttribute("open");
    await attachFullPageScreenshot(page, testInfo, "owner-ready-default.png");

    const details = page.getByTestId("installation-details");
    await disclosure.locator("summary").click();
    await installation.evaluate((element) =>
      element.scrollIntoView({ block: "start", inline: "nearest" }),
    );
    await expect(details).toHaveAttribute("data-overall-drift", "drifted");
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
    ).toHaveCount(3);
    await expect(
      details.getByTestId("installation-schema-observed-value"),
    ).toHaveText(E2E_REEF_OLD_SCHEMA_FINGERPRINT);
    await expect(
      details.getByTestId("installation-snapshot-fingerprint"),
    ).toHaveText(E2E_REEF_SCHEMA_FINGERPRINT);
    for (const id of [
      "installation-schema-expected",
      "installation-schema-observed-value",
      "installation-snapshot-fingerprint",
    ]) {
      const fingerprint = details.getByTestId(id);
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
    const ownerDisclosure = page.getByTestId("installation-details-disclosure");
    await expect(ownerDisclosure).not.toHaveAttribute("open");
    await ownerDisclosure.locator("summary").click();
    await expect(page.getByTestId("installation-details")).toBeVisible();

    await setInstallationControl(page.request, { roles: { alice: "writer" } });
    await page.reload();
    await expect(
      page.getByTestId("workspace-installation-reef-e2e"),
    ).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("installation-details")).toHaveCount(0);
    await expect(
      page.getByTestId("installation-details-disclosure"),
    ).toHaveCount(0);

    for (const credentials of [fixtureWriterLogin, fixtureReaderLogin]) {
      await context.clearCookies();
      await signInAsUser(page, credentials);
      await page.goto("/workspace/reef-e2e/settings/workspace");
      await expect(
        page.getByTestId("workspace-installation-reef-e2e"),
      ).toHaveAttribute("data-status", "ready");
      await expect(page.getByTestId("installation-details")).toHaveCount(0);
      const status = await page.request.get(
        "/api/vaults/reef-e2e/installation",
      );
      expect(status.ok()).toBe(true);
      expect(await status.json()).toEqual({ installation_status: "ready" });
    }
  });

  test("blocked guidance permits a read-only recheck and switching to another ready workspace", async ({
    context,
    page,
    request,
  }, testInfo) => {
    await setInstallationControl(request, {
      lifecycle: "blocked",
      blockedReason: "worker_timeout",
    });
    await signInAsAlice(page);
    await page.goto("/workspace/reef-e2e/issues");
    const installation = page.getByTestId("workspace-installation-reef-e2e");
    await expect(installation).toHaveAttribute("data-status", "blocked");
    await expect(
      installation.getByText(/People can't use this workspace/),
    ).toBeVisible();
    await expect(
      installation.getByTestId("installation-check-status-note"),
    ).toBeVisible();
    const disclosure = installation.getByTestId(
      "installation-details-disclosure",
    );
    await expect(disclosure).not.toHaveAttribute("open");
    await attachFullPageScreenshot(page, testInfo, "owner-blocked-default.png");
    await disclosure.locator("summary").click();
    await expect(
      page.getByText("The installation worker timed out."),
    ).toBeVisible();
    await attachFullPageScreenshot(
      page,
      testInfo,
      "owner-blocked-technical-details.png",
    );
    await page.getByRole("button", { name: "Check status" }).click();
    await expect(
      page.getByRole("button", { name: "Check status" }),
    ).toBeEnabled();

    const ownerState = await readFixtureState(request);
    expect(
      ownerState.calls.some(
        (call) =>
          ["PUT", "DELETE"].includes(call.method) &&
          call.path.includes("/installations/"),
      ),
    ).toBe(false);
    await expect(
      page.getByTestId("access-denied-workspace-reef-zeta"),
    ).toBeVisible();

    await context.clearCookies();
    await signInAsUser(page, fixtureReaderLogin);
    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.getByTestId("workspace-access-denied")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Workspace availability" }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("workspace-installation-reef-e2e")
        .getByText(/ask a workspace owner or admin/i),
    ).toBeVisible();
    await expect(
      page.getByText("The installation worker timed out."),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("installation-check-status-note"),
    ).toBeVisible();
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
      onboarding: "/onboarding",
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
            const settingsCard = page.getByTestId(
              "workspace-installation-reef-e2e",
            );
            await expect(settingsCard).toHaveAttribute("data-status", "ready");
            await expect(settingsCard).toHaveCSS("text-align", "left");
            await attachFullPageScreenshot(
              page,
              testInfo,
              `settings--${appearance}--default.png`,
            );
            if (canManage) {
              await settingsCard
                .getByTestId("installation-details-disclosure")
                .locator("summary")
                .click();
              await expect(
                settingsCard.getByTestId("installation-details"),
              ).toBeVisible();
              await settingsCard.evaluate((element) =>
                element.scrollIntoView({ block: "start", inline: "nearest" }),
              );
              await attachFullPageScreenshot(
                page,
                testInfo,
                `settings--${appearance}--details.png`,
              );
              if (viewport.name === "mobile") {
                const statusNote = settingsCard.getByTestId(
                  "installation-check-status-note",
                );
                await statusNote.scrollIntoViewIfNeeded();
                const statusNoteBounds = await statusNote.boundingBox();
                expect(statusNoteBounds?.y).toBeGreaterThanOrEqual(0);
                expect(
                  (statusNoteBounds?.y ?? viewport.height) +
                    (statusNoteBounds?.height ?? viewport.height),
                ).toBeLessThanOrEqual(viewport.height);
                await attachFullPageScreenshot(
                  page,
                  testInfo,
                  `settings--${appearance}--details-bottom.png`,
                );
              }
            } else {
              await expect(
                settingsCard.getByTestId("installation-details-disclosure"),
              ).toHaveCount(0);
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
                vaults: Array<{ name: string; installation_status: string }>;
              };
            expect(
              blockedVaultsPayload.vaults
                .filter((vault) =>
                  ["reef-e2e", "reef-zeta"].includes(vault.name),
                )
                .every((vault) => vault.installation_status !== "ready"),
            ).toBe(true);
            await clearPersistedQueryCache(page);
            await clearPersistedQueryCacheOnLoad(page);
            await page.goto(surfacePaths.onboarding);
            await expect(page.getByTestId("onboarding-panel")).toBeVisible();
            const onboardingCard = page.getByTestId(
              "workspace-installation-reef-e2e",
            );
            await expect(onboardingCard).toHaveAttribute(
              "data-status",
              canManage ? "blocked" : "management_required",
            );
            await attachFullPageScreenshot(
              page,
              testInfo,
              `onboarding--${appearance}--default.png`,
            );
            if (canManage) {
              await onboardingCard
                .getByTestId("installation-details-disclosure")
                .locator("summary")
                .click();
              await expect(
                onboardingCard.getByTestId("installation-blocked-guidance"),
              ).toBeVisible();
              await attachFullPageScreenshot(
                page,
                testInfo,
                `onboarding--${appearance}--details.png`,
              );
            } else {
              await expect(
                onboardingCard.getByTestId("installation-details-disclosure"),
              ).toHaveCount(0);
            }

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
                name: /Workspace availability|워크스페이스 이용 상태/,
              }),
            ).toBeVisible();
            const accessCard = page.getByTestId(
              "workspace-installation-reef-e2e",
            );
            await expect(accessCard).toHaveAttribute(
              "data-status",
              canManage ? "blocked" : "management_required",
            );
            await attachFullPageScreenshot(
              page,
              testInfo,
              `access--${appearance}--default.png`,
            );
            if (canManage) {
              await accessCard
                .getByTestId("installation-details-disclosure")
                .locator("summary")
                .click();
              await expect(
                accessCard.getByTestId("installation-blocked-guidance"),
              ).toBeVisible();
              const documentHeight = await page.evaluate(
                () => document.documentElement.scrollHeight,
              );
              expect(documentHeight).toBeGreaterThanOrEqual(viewport.height);
              await expect(
                page.getByRole("heading", {
                  name: /Workspace availability|워크스페이스 이용 상태/,
                }),
              ).toBeVisible();
              const headingBounds = await page
                .getByRole("heading", {
                  name: /Workspace availability|워크스페이스 이용 상태/,
                })
                .boundingBox();
              expect(headingBounds?.y).toBeGreaterThanOrEqual(0);
              expect(headingBounds?.y).toBeLessThan(viewport.height);
              await attachFullPageScreenshot(
                page,
                testInfo,
                `access--${appearance}--details.png`,
              );
            } else {
              await expect(
                accessCard.getByTestId("installation-details-disclosure"),
              ).toHaveCount(0);
            }
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
