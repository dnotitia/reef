import { Buffer } from "node:buffer";
import {
  type Locator,
  type Page,
  type TestInfo,
  expect,
  test,
} from "@playwright/test";
import {
  E2E_MOCK_URL,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  signInAsAlice,
  writeIndexedDbConfig,
} from "../harness/fixture";
import fixtureLogin from "../harness/fixture-login.json";

const IMAGE_UPLOAD_FIXTURE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAYAAADuFn/PAAAAs0lEQVR42u3ZsQmAQBAEQHMTezA3sQfLEmxEEGzC0D5sQ9O3g/vgeUSYYMNNbqLlmmlLKUo/P2FK++O1h+mOJUxpP51DmHttw5T2GwAAAAAAAAAAAAAAPgCofeBcv/aBc/3aB871AQAAAAAAAAAAAAD4AsAQs4QBAAAAAAAAAAAA+AcYYpYwAAAAAAAAAAAAAP8AQ8wSBgAAAAAAAAAAAOAfYIhZwgAAAAAAAAAAAAB+D/ACWn8C0ZKjwsMAAAAASUVORK5CYII=",
  "base64",
);

async function expectNamedEmptyRegion(locator: Locator) {
  const heading = locator.locator("h2");
  const description = locator.locator("p");
  await expect(locator).toBeVisible();
  await expect(heading).toHaveCount(1);
  await expect(description).toHaveCount(1);

  const headingText = await heading.innerText();
  const descriptionText = await description.innerText();
  await expect(locator).toHaveAccessibleName(headingText);
  await expect(locator).toHaveAccessibleDescription(descriptionText);

  const references = await locator.evaluate((element) => {
    const headingId = element.getAttribute("aria-labelledby");
    const descriptionId = element.getAttribute("aria-describedby");
    return {
      tagName: element.tagName,
      headingId,
      descriptionId,
      headingText: headingId
        ? document.getElementById(headingId)?.textContent
        : null,
      descriptionText: descriptionId
        ? document.getElementById(descriptionId)?.textContent
        : null,
    };
  });

  expect(references.tagName).toBe("SECTION");
  expect(references.headingId).toBeTruthy();
  expect(references.descriptionId).toBeTruthy();
  expect(references.headingId).not.toBe(references.descriptionId);
  expect(references.headingText?.trim()).toBe(headingText.trim());
  expect(references.descriptionText?.trim()).toBe(descriptionText.trim());
}

async function expectVisibleFocus(
  page: Page,
  locator: Locator,
  testInfo: TestInfo,
  screenshotName: string,
) {
  await locator.focus();
  await expect(locator).toBeFocused();

  const expectedForeground = await locator.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(
      document.documentElement,
    ).getPropertyValue("--foreground");
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect
    .poll(() =>
      locator.evaluate((element) => getComputedStyle(element).outlineColor),
    )
    .toBe(expectedForeground);

  const proof = await locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    const rootStyles = getComputedStyle(document.documentElement);
    const foregroundProbe = document.createElement("span");
    foregroundProbe.style.color = rootStyles.getPropertyValue("--foreground");
    document.body.append(foregroundProbe);
    const foregroundColor = getComputedStyle(foregroundProbe).color;
    foregroundProbe.remove();

    const rect = element.getBoundingClientRect();
    return {
      foregroundColor,
      outlineColor: styles.outlineColor,
      outlineOffset: styles.outlineOffset,
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
      rect: {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      },
      viewport: { height: innerHeight, width: innerWidth },
    };
  });

  expect(proof.outlineStyle).toBe("solid");
  expect(Number.parseFloat(proof.outlineWidth)).toBeGreaterThanOrEqual(2);
  expect(proof.outlineOffset).toBe("1px");
  expect(proof.outlineColor).not.toBe("transparent");
  expect(proof.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(proof.outlineColor).toBe(proof.foregroundColor);
  expect(proof.rect.width).toBeGreaterThan(0);
  expect(proof.rect.height).toBeGreaterThan(0);
  expect(proof.rect.x).toBeGreaterThanOrEqual(0);
  expect(proof.rect.y).toBeGreaterThanOrEqual(0);
  expect(proof.rect.x + proof.rect.width).toBeLessThanOrEqual(
    proof.viewport.width,
  );
  expect(proof.rect.y + proof.rect.height).toBeLessThanOrEqual(
    proof.viewport.height,
  );

  const screenshot = await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath(`${screenshotName}-focus.png`),
  });
  expect(screenshot.byteLength).toBeGreaterThan(0);
}

const RUNTIME_VISUAL_VIEWPORTS = [
  { name: "320", width: 320, height: 844 },
  { name: "375", width: 375, height: 844 },
  { name: "414", width: 414, height: 844 },
  { name: "768", width: 768, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const RUNTIME_SURFACE_ROLES = [
  "page",
  "subtle",
  "card",
  "elevated",
  "popover",
] as const;

type RuntimeSurfaceRole = (typeof RUNTIME_SURFACE_ROLES)[number];

type RuntimeSurfaceObservation = {
  roleCounts: Record<RuntimeSurfaceRole, number>;
  roleTokenColors: Record<RuntimeSurfaceRole, string>;
  unresolvedSurfaceFills: Array<{
    role: RuntimeSurfaceRole;
    className: string;
  }>;
  clippedText: Array<{ tag: string; text: string; className: string }>;
  outOfViewportControls: Array<{ tag: string; text: string }>;
  documentOverflow: boolean;
  bodyOverflow: boolean;
  mainOverflow: boolean;
};

async function setRuntimeTheme(page: Page, theme: "light" | "dark") {
  await writeIndexedDbConfig(page, "theme", theme);
  await page.evaluate((nextTheme) => {
    window.localStorage.setItem("reef.theme", nextTheme);
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) => element.classList.contains("dark")),
    )
    .toBe(theme === "dark");
}

async function setPublicRuntimeTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((nextTheme) => {
    window.localStorage.setItem("reef.theme", nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  }, theme);
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) => element.classList.contains("dark")),
    )
    .toBe(theme === "dark");
}

async function observeRuntimeSurface(
  page: Page,
): Promise<RuntimeSurfaceObservation> {
  return page.evaluate((roles) => {
    const rolePattern =
      /^bg-surface-(page|subtle|card|elevated|popover)(?:\/.*)?$/u;
    const roleCounts = Object.fromEntries(
      roles.map((role) => [role, 0]),
    ) as Record<RuntimeSurfaceRole, number>;
    const unresolvedSurfaceFills: RuntimeSurfaceObservation["unresolvedSurfaceFills"] =
      [];
    const roleTokenColors = Object.fromEntries(
      roles.map((role) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = `var(--surface-${role})`;
        probe.style.position = "fixed";
        probe.style.visibility = "hidden";
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return [role, color];
      }),
    ) as Record<RuntimeSurfaceRole, string>;

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>("*"),
    )) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      for (const className of Array.from(element.classList)) {
        const match = className.match(rolePattern);
        if (!match) continue;
        const role = match[1] as RuntimeSurfaceRole;
        roleCounts[role] += 1;
        const background = getComputedStyle(element).backgroundColor;
        if (
          background === "transparent" ||
          background === "rgba(0, 0, 0, 0)" ||
          background === ""
        ) {
          unresolvedSurfaceFills.push({ role, className });
        }
      }
    }

    const isVisible = (element: HTMLElement) => {
      const styles = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        styles.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0 &&
        element.getAttribute("aria-hidden") !== "true"
      );
    };
    const hasHorizontalScrollOwner = (element: HTMLElement) => {
      let owner = element.parentElement;
      while (owner) {
        const styles = getComputedStyle(owner);
        const scrollable = [styles.overflowX, styles.overflow].some(
          (value) => value === "auto" || value === "scroll",
        );
        if (scrollable && owner.scrollWidth > owner.clientWidth + 1) {
          return true;
        }
        owner = owner.parentElement;
      }
      return false;
    };
    const outOfViewportControls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button,a,input,textarea,select,[role=button],[role=link]",
      ),
    )
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.left >= -1 && rect.right <= window.innerWidth + 1) {
          return false;
        }
        return !hasHorizontalScrollOwner(element);
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? element.getAttribute("aria-label") ?? "")
          .trim()
          .slice(0, 80),
        rect: element.getBoundingClientRect(),
      }))
      .map(({ tag, text }) => ({ tag, text }));

    const clippedText = Array.from(
      document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p,button,a,label"),
    )
      .filter(isVisible)
      .filter((element) => {
        if (element.classList.contains("sr-only")) return false;
        const styles = getComputedStyle(element);
        if (element.scrollWidth <= element.clientWidth + 1) return false;
        if (
          styles.textOverflow === "ellipsis" ||
          element.hasAttribute("title") ||
          /(?:truncate|line-clamp)/u.test(element.className)
        ) {
          return false;
        }
        if (hasHorizontalScrollOwner(element)) return false;
        return true;
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").trim().slice(0, 80),
        className: element.className,
      }));

    const main = document.querySelector<HTMLElement>("main");
    return {
      roleCounts,
      roleTokenColors,
      unresolvedSurfaceFills,
      clippedText,
      outOfViewportControls,
      documentOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth > document.body.clientWidth,
      mainOverflow: main ? main.scrollWidth > main.clientWidth : false,
    };
  }, RUNTIME_SURFACE_ROLES);
}

async function expectRuntimeFocus(locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  const viewport = locator.page().viewportSize();
  if (!viewport) throw new Error("Missing Playwright viewport size");
  const focus = await locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    const outlineWidth = Number.parseFloat(styles.outlineWidth) || 0;
    return {
      ring:
        (styles.outlineStyle !== "none" &&
          outlineWidth >= 2 &&
          styles.outlineColor !== "transparent" &&
          styles.outlineColor !== "rgba(0, 0, 0, 0)") ||
        styles.boxShadow !== "none",
      rect: element.getBoundingClientRect(),
    };
  });
  expect(focus.ring).toBe(true);
  expect(focus.rect.left).toBeGreaterThanOrEqual(-1);
  expect(focus.rect.top).toBeGreaterThanOrEqual(-1);
  expect(focus.rect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(focus.rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
}

test.describe("Hermetic runtime discovery", () => {
  test("exposes loaded issue detail content for a cold deep-link readiness probe", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "assignee_picker");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");

    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-close")).toBeVisible();
    await expect(
      page.locator('[data-testid="issue-detail-modal"]'),
    ).toHaveCount(1);
  });

  test("publishes runtime controls and resets My View fixtures idempotently", async ({
    request,
  }) => {
    const response = await request.get(`${E2E_MOCK_URL}/__e2e/runtime`);
    expect(response.ok()).toBeTruthy();
    const contract = await response.json();

    expect(contract).toMatchObject({
      schema_version: 2,
      status: "ready",
      operations: {
        health: { method: "GET", path: "/__e2e/health" },
        reset: {
          method: "POST",
          path: "/__e2e/reset",
          content_type: "application/json",
          body: { scenario: "<supported_scenario>" },
        },
        account_denial: {
          method: "POST",
          path: "/__e2e/account-denial",
          content_type: "application/json",
          body: {
            code: "membership_required|account_suspended|identity_conflict|null",
          },
        },
      },
      fixture_login: {
        ...fixtureLogin,
      },
      fixture_inputs: {
        image_upload: {
          method: "GET",
          path: "/__e2e/assets/reef-markdown-editor-image.png",
          file_name: "reef-markdown-editor-image.png",
          content_type: "image/png",
        },
      },
      tasks: {
        auth_soft_navigation: {
          scenario: "configured",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          controls: {
            auth_control: [
              "session revoke",
              "bounded probe delay (including one-shot) or hang",
              "healthy, plain 401, or resource 403 protected responses",
            ],
            account_denial: [
              "membership_required|account_suspended|identity_conflict|null",
            ],
            protected_response: [
              "forbidden on an ordinary user-directory or member-search interaction (for example assignee or settings) to observe the resource access-denied surface",
            ],
          },
          interaction: {
            type: "auth_soft_navigation",
            operation:
              "verify cold and warm protected destinations stay behind the auth conclusion, revoked sessions converge to same-origin login, stale delayed probes do not win, cross-tab auth changes redirect, and valid slow probes preserve the destination",
          },
        },
        status_quick_edit: {
          scenario: "status_quick_edit",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues?view=list",
          interaction: {
            type: "status_quick_edit",
            operation:
              "configure delayed status updates for two issues, observe optimistic status changes and per-row pending state, repeat the same activation while pending, and verify independent delayed success or failure with retry",
          },
        },
        planning_overflow: {
          scenario: "planning_overflow",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues?view=list",
          interaction: {
            type: "planning_overflow_tooltip",
            operation: expect.stringContaining("adjacent short option"),
          },
        },
        assignee_picker: {
          scenario: "assignee_picker",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues/REEF-001",
          interaction: {
            type: "assignee_picker",
            operation:
              "open issue detail, browse the complete writer/admin/owner roster, search by display name or login, select a candidate, reload to verify recent-first ordering, and verify a failed save leaves the existing assignment and recent history unchanged",
          },
        },
        issue_drill_navigation: {
          scenario: "demo_board",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues?view=list",
        },
        named_issue_filters: {
          scenario: "configured_multi",
          workspace: "reef-e2e",
          secondary_workspace: "reef-zeta",
          start_path: "/workspace/reef-e2e/issues?view=list",
        },
        backlog_bulk_partial_failure: {
          scenario: "backlog_bulk_partial_failure",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues?scope=backlog&view=list",
          interaction: {
            type: "bulk_status_update",
            operation:
              "select the visible Backlog issues, choose In Review from the bulk Status control, observe one successful issue leave Backlog while one failed issue keeps its original Backlog state and selection, then open the failure tray and retry the failed update",
          },
        },
        content_search: {
          scenario: "content_search",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "global_search",
            shortcut: "Mod+K",
            platform_shortcuts: {
              macos: "Meta+K",
              other: "Control+K",
            },
            query: "issue title, body, or comment phrase",
          },
        },
        chat: {
          scenario: "configured",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "workspace_chat",
            operation:
              "open Ask AI, submit distinct questions, and observe each assistant response",
          },
        },
        notifications: {
          scenario: "notifications",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/inbox",
          interaction: {
            type: "notification_inbox",
            operation:
              "open a comment mention notification, confirm it becomes read, and observe the source comment location in the issue activity timeline",
          },
        },
        comments: {
          scenario: "comment_mentions",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/issues",
          interaction: {
            type: "issue_activity",
            operation:
              "open an issue, add a comment, and observe it in the activity timeline",
          },
        },
        markdown_fixture: {
          scenario: "markdown_fixture",
          workspace: "reef-e2e",
          start_path: expect.stringMatching(
            /^\/workspace\/reef-e2e\/issues\/[^/]+$/u,
          ),
          interaction: {
            type: "markdown_editor",
            operation: expect.stringContaining("Source"),
          },
        },
        issue_change_review: {
          scenario: "issue_change_review",
          workspace: "reef-e2e",
          start_path: expect.stringContaining(
            "/workspace/reef-e2e/issues/changes?start_at=",
          ),
          fixture_facts: {
            review_period: {
              start_at: "2026-06-15T00:00:00.000Z",
              end_at: "2026-06-19T00:00:00.000Z",
              timezone: "UTC",
            },
            retained_history_entries: 105,
          },
          interaction: {
            type: "issue_change_review",
            operation: expect.stringContaining("fixed UTC period"),
          },
        },
        empty_states: {
          scenario: "configured_empty",
          workspace: "reef-e2e",
          start_paths: {
            my_work: "/workspace/reef-e2e/my-work",
            inbox: "/workspace/reef-e2e/inbox",
            reports: "/workspace/reef-e2e/reports",
            planning: "/workspace/reef-e2e/planning",
          },
        },
        caught_up_states: {
          scenario: "configured_caught_up",
          workspace: "reef-e2e",
          start_path: "/workspace/reef-e2e/my-work",
        },
      },
    });
    const imageInput = contract.fixture_inputs?.image_upload;
    expect(imageInput).toMatchObject({
      method: "GET",
      path: "/__e2e/assets/reef-markdown-editor-image.png",
      file_name: "reef-markdown-editor-image.png",
      content_type: "image/png",
    });
    if (!imageInput?.path || !imageInput.file_name) {
      throw new Error("missing discovered image upload fixture");
    }
    const imageUrl = new URL(imageInput.path, E2E_MOCK_URL);
    expect(imageUrl.origin).toBe(new URL(E2E_MOCK_URL).origin);
    expect(imageUrl.search).toBe("");
    expect(imageUrl.hash).toBe("");
    const imageResponse = await request.get(imageUrl.toString());
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()["content-type"]).toBe("image/png");
    expect(imageResponse.headers()["content-disposition"]).toContain(
      `filename="${imageInput.file_name}"`,
    );
    expect(await imageResponse.body()).toEqual(IMAGE_UPLOAD_FIXTURE_BYTES);
    const discoveredLogin = contract.fixture_login as typeof fixtureLogin;
    const { username, password } = discoveredLogin;
    const loginResponse = await request.post(
      `${E2E_MOCK_URL}/akb/api/v1/auth/login`,
      {
        data: {
          username,
          password,
        },
      },
    );
    expect(loginResponse.ok()).toBeTruthy();
    expect((await loginResponse.json()).user.username).toBe(username);
    expect(contract.scenarios).toEqual(
      expect.arrayContaining([
        "configured_multi",
        "assignee_picker",
        "backlog_bulk_partial_failure",
        "demo_board",
        "configured_empty",
        "configured_caught_up",
        "content_search",
        "large_vault",
        "markdown_fixture",
        "issue_change_review",
        "status_quick_edit",
        "planning_overflow",
      ]),
    );

    await resetFixture(request, "configured_multi");
    const first = await readFixtureState(request);
    await resetFixture(request, "configured_multi");
    const second = await readFixtureState(request);
    const summarize = (state: Awaited<ReturnType<typeof readFixtureState>>) =>
      state.vaults.map((vault) => ({
        name: vault.name,
        issue_ids: vault.issue_ids,
      }));

    expect(first.scenario).toBe("configured_multi");
    expect(summarize(second)).toEqual(summarize(first));
    expect(first.vaults.map((vault) => vault.name)).toEqual(
      expect.arrayContaining(["reef-e2e", "reef-zeta"]),
    );

    await resetFixture(request, "configured_empty");
    const emptyState = await readFixtureState(request);
    const emptyVault = emptyState.vaults.find(
      (vault) => vault.name === "reef-e2e",
    );
    expect(emptyState.scenario).toBe("configured_empty");
    expect(emptyVault).toMatchObject({
      name: "reef-e2e",
      issue_ids: [],
      sprints: [],
      milestones: [],
      releases: [],
      notifications: [],
    });
    expect(emptyVault?.tables).toEqual(
      expect.arrayContaining([
        "reef_issues",
        "reef_notifications",
        "reef_sprints",
        "reef_milestones",
        "reef_releases",
      ]),
    );
  });

  test("keeps representative empty-state controls visibly focused in both themes", async ({
    context,
    page,
    request,
  }, testInfo) => {
    await context.clearCookies();
    await page.setViewportSize({ width: 1280, height: 900 });
    await clearPersistedQueryCacheOnLoad(page);

    for (const colorScheme of ["light", "dark"] as const) {
      await resetFixture(request, "configured_empty");
      await openExistingWorkspace(page);
      await writeIndexedDbConfig(page, "theme", colorScheme);
      await page.evaluate((theme) => {
        window.localStorage.setItem("reef.theme", theme);
      }, colorScheme);
      await page.emulateMedia({ colorScheme });

      await page.goto("/workspace/reef-e2e/reports");
      await expect
        .poll(() =>
          page
            .locator("html")
            .evaluate((element) => element.classList.contains("dark")),
        )
        .toBe(colorScheme === "dark");
      await expectVisibleFocus(
        page,
        page
          .locator('[data-slot="page-header"]')
          .getByRole("button", { name: "New issue", exact: true }),
        testInfo,
        `${colorScheme}-true-empty`,
      );

      await resetFixture(request, "configured");
      await openExistingWorkspace(page);
      await page.goto("/workspace/reef-e2e/issues?view=board");
      await page.getByTestId("search-input").fill("nothing matches");
      const clearFilters = page.getByRole("button", {
        name: "Clear filters",
        exact: true,
      });
      await expect(clearFilters).toBeVisible({ timeout: 15_000 });
      await expectVisibleFocus(
        page,
        clearFilters,
        testInfo,
        `${colorScheme}-no-match-recovery`,
      );
    }
  });

  test("renders the configured empty workspace across its routed surfaces", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    await resetFixture(request, "configured_empty");

    const state = await readFixtureState(request);
    const vault = state.vaults.find((item) => item.name === "reef-e2e");
    expect(vault).toMatchObject({
      issue_ids: [],
      sprints: [],
      milestones: [],
      releases: [],
      notifications: [],
    });

    await openExistingWorkspace(page);
    const frameBoxes: Array<{ width: number; height: number }> = [];
    async function recordFrame(locator: Locator) {
      const box = await locator.boundingBox();
      if (!box) {
        throw new Error(
          "Expected the empty-state frame to have a bounding box",
        );
      }
      frameBoxes.push(box);
    }

    await page.goto("/workspace/reef-e2e/my-work");
    const myWorkEmpty = page.getByTestId("my-work-empty");
    await expect(myWorkEmpty).toBeVisible();
    await expectNamedEmptyRegion(myWorkEmpty);
    await expect(myWorkEmpty.getByRole("link")).toHaveCount(0);
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Issues", exact: true }),
    ).toHaveAttribute("href", "/workspace/reef-e2e/issues");
    await recordFrame(myWorkEmpty);
    await page.getByRole("link", { name: "Issues", exact: true }).click();
    await page.waitForURL(/\/workspace\/reef-e2e\/issues\/?$/);
    await expect(page.getByTestId("view-switcher-board")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/workspace/reef-e2e/inbox");
    const inboxEmpty = page.getByTestId("notification-inbox-empty");
    await expect(inboxEmpty).toBeVisible();
    await expectNamedEmptyRegion(inboxEmpty);
    await expect(
      inboxEmpty.locator('[data-slot="empty-state-icon"]'),
    ).toHaveCount(0);
    await expect(inboxEmpty.getByRole("button")).toHaveCount(0);
    await recordFrame(inboxEmpty);

    await page.goto("/workspace/reef-e2e/reports");
    const reportsEmpty = page.getByTestId("reports-empty");
    await expect(reportsEmpty).toBeVisible();
    await expectNamedEmptyRegion(reportsEmpty);
    await expect(reportsEmpty.getByRole("button")).toHaveCount(0);
    await expect(
      page
        .locator('[data-slot="page-header"]')
        .getByRole("button", { name: "New issue", exact: true }),
    ).toHaveCount(1);
    await recordFrame(reportsEmpty);

    await page.goto("/workspace/reef-e2e/planning");
    const planningEmpty = page.getByTestId("planning-empty-sprints");
    await expect(planningEmpty).toBeVisible();
    await expectNamedEmptyRegion(planningEmpty);
    await expect(planningEmpty.getByRole("button")).toHaveCount(0);
    await expect(
      page
        .locator('[data-slot="page-header"]')
        .getByRole("button", { name: "New sprint" }),
    ).toBeVisible();
    await recordFrame(planningEmpty);

    const newSprint = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New sprint" });
    await newSprint.focus();
    await page.keyboard.press("Enter");
    const planningDialog = page.locator(
      '[data-testid="planning-editor-dialog"]',
    );
    await expect(planningDialog).toBeVisible();
    await planningDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(planningDialog).toBeHidden();
    await expect(newSprint).toBeFocused();

    const reference = frameBoxes[0];
    for (const box of frameBoxes.slice(1)) {
      expect(Math.abs(box.width - reference.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - reference.height)).toBeLessThanOrEqual(1);
    }

    const milestones = page.getByRole("button", { name: "Milestones" });
    await milestones.focus();
    await page.keyboard.press("Space");
    await page.waitForURL(/planning\?kind=milestones$/);
    await expectNamedEmptyRegion(page.getByTestId("planning-empty-milestones"));

    await page.getByRole("button", { name: "Releases" }).click();
    await page.waitForURL(/planning\?kind=releases$/);
    await expectNamedEmptyRegion(page.getByTestId("planning-empty-releases"));

    const newRelease = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New release" });
    await newRelease.click();
    await expect(planningDialog).toBeVisible();
    await planningDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(planningDialog).toBeHidden();
    await expect(newRelease).toBeFocused();
  });

  test("keeps empty frames and caught-up state aligned in narrow dark Korean viewports", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    const viewportWidth = 375;
    await page.setViewportSize({ width: viewportWidth, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured_empty");
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await openExistingWorkspace(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    const frameBoxes: Array<{ width: number; height: number }> = [];
    async function recordFrame(locator: Locator) {
      const box = await locator.boundingBox();
      if (!box) {
        throw new Error(
          "Expected the narrow empty-state frame to have a bounding box",
        );
      }
      expect(box.width).toBeGreaterThan(250);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
      frameBoxes.push({ width: box.width, height: box.height });
    }

    async function expectViewportFits() {
      const widths = await page.evaluate(() => ({
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(widths.body).toBeLessThanOrEqual(widths.viewport);
      expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    }

    const sidebar = await page.locator("aside").boundingBox();
    expect(sidebar?.width).toBe(56);

    await page.goto("/workspace/reef-e2e/my-work");
    const myWorkEmpty = page.getByTestId("my-work-empty");
    await expect(myWorkEmpty).toBeVisible();
    await recordFrame(myWorkEmpty);
    const boardAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("link");
    await expect(boardAction).toHaveCount(0);
    await expectViewportFits();

    await page.goto("/workspace/reef-e2e/inbox");
    const inboxEmpty = page.getByTestId("notification-inbox-empty");
    await expect(inboxEmpty).toBeVisible();
    await recordFrame(inboxEmpty);
    await expectViewportFits();

    await page.goto("/workspace/reef-e2e/reports");
    const reportsEmpty = page.getByTestId("reports-empty");
    await expect(reportsEmpty).toBeVisible();
    await recordFrame(reportsEmpty);
    const reportsAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "새 이슈", exact: true });
    await expect(reportsAction).toHaveCount(1);
    await expect(reportsAction).toBeVisible();
    const reportsActionBox = await reportsAction.boundingBox();
    if (!reportsActionBox)
      throw new Error("Expected the Reports New issue action to have a box");
    expect(reportsActionBox.x + reportsActionBox.width).toBeLessThanOrEqual(
      viewportWidth,
    );
    await expectViewportFits();

    await page.goto("/workspace/reef-e2e/planning");
    const planningEmpty = page.getByTestId("planning-empty-sprints");
    await expect(planningEmpty).toBeVisible();
    await recordFrame(planningEmpty);
    const sprintAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("button");
    await expect(sprintAction).toHaveCount(1);
    await expect(sprintAction).toBeVisible();
    const sprintBox = await sprintAction.boundingBox();
    if (!sprintBox)
      throw new Error("Expected the New sprint action to have a box");
    expect(sprintBox.x + sprintBox.width).toBeLessThanOrEqual(viewportWidth);
    await expectViewportFits();

    const reference = frameBoxes[0];
    for (const box of frameBoxes.slice(1)) {
      expect(Math.abs(box.width - reference.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - reference.height)).toBeLessThanOrEqual(1);
    }
  });

  test("keeps caught-up My Work passive in a narrow dark Korean viewport", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    const viewportWidth = 375;
    await page.setViewportSize({ width: viewportWidth, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured_caught_up");
    const state = await readFixtureState(request);
    const vault = state.vaults.find((item) => item.name === "reef-e2e");
    expect(state.scenario).toBe("configured_caught_up");
    expect(vault?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "done", assigned_to: "alice" }),
      ]),
    );
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await openExistingWorkspace(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    await page.goto("/workspace/reef-e2e/my-work");
    const myWorkCaughtUp = page.getByTestId("my-work-caught-up");
    await expect(myWorkCaughtUp).toBeVisible();
    await expect(myWorkCaughtUp.getByRole("link")).toHaveCount(0);
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);
    const caughtUpWidths = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(caughtUpWidths.body).toBeLessThanOrEqual(caughtUpWidths.viewport);
    expect(caughtUpWidths.document).toBeLessThanOrEqual(
      caughtUpWidths.viewport,
    );
    await page.reload();
    await expect(page.getByTestId("my-work-caught-up")).toBeVisible();
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);
  });

  test("keeps empty and caught-up states inside a 320px dark Korean viewport", async ({
    context,
    page,
    request,
  }) => {
    const viewportWidth = 320;
    await context.clearCookies();
    await page.setViewportSize({ width: viewportWidth, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured_empty");
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ko", domain: "localhost", path: "/" },
    ]);
    await openExistingWorkspace(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    async function expectViewportFits() {
      const widths = await page.evaluate(() => ({
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(widths.body).toBeLessThanOrEqual(widths.viewport);
      expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    }

    async function expectFrameFits(locator: Locator) {
      await expectNamedEmptyRegion(locator);
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        viewportWidth,
      );
      await expectViewportFits();
    }

    await page.goto("/workspace/reef-e2e/my-work");
    await expectFrameFits(page.getByTestId("my-work-empty"));
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);

    await page.goto("/workspace/reef-e2e/inbox");
    await expectFrameFits(page.getByTestId("notification-inbox-empty"));

    await page.goto("/workspace/reef-e2e/reports");
    await expectFrameFits(page.getByTestId("reports-empty"));
    const reportsAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "새 이슈", exact: true });
    await expect(reportsAction).toBeVisible();
    const reportsBox = await reportsAction.boundingBox();
    expect(reportsBox).not.toBeNull();
    expect((reportsBox?.x ?? 0) + (reportsBox?.width ?? 0)).toBeLessThanOrEqual(
      viewportWidth,
    );

    await page.goto("/workspace/reef-e2e/planning");
    await expectFrameFits(page.getByTestId("planning-empty-sprints"));
    const planningAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("button");
    await expect(planningAction).toBeVisible();
    const planningBox = await planningAction.boundingBox();
    expect(planningBox).not.toBeNull();
    expect(
      (planningBox?.x ?? 0) + (planningBox?.width ?? 0),
    ).toBeLessThanOrEqual(viewportWidth);

    await resetFixture(request, "configured_caught_up");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/my-work");
    const caughtUp = page.getByTestId("my-work-caught-up");
    await expectFrameFits(caughtUp);
    await expect(
      page.locator('[data-slot="page-header"]').getByRole("link"),
    ).toHaveCount(0);
  });

  test("keeps empty copy, primary action, and focus usable at an effective 200% zoom", async ({
    context,
    page,
    request,
  }) => {
    // A 720px CSS viewport is the equivalent reflow width for 200% browser
    // zoom from the required 1440px desktop proof size.
    await context.clearCookies();
    await page.setViewportSize({ width: 720, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await clearPersistedQueryCacheOnLoad(page);
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/reports");
    const reportsEmpty = page.getByTestId("reports-empty");
    await expectNamedEmptyRegion(reportsEmpty);
    const reportsAction = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New issue", exact: true });
    await expect(reportsAction).toBeVisible();
    const actionBox = await reportsAction.boundingBox();
    expect(actionBox).not.toBeNull();
    expect((actionBox?.x ?? 0) + (actionBox?.width ?? 0)).toBeLessThanOrEqual(
      720,
    );

    await reportsAction.focus();
    await expect(reportsAction).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.locator('[data-testid="new-issue-dialog"]');
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reportsAction).toBeFocused();
  });

  test("preserves the label no-match after clearing a parent report scope", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/reports");
    await expect(
      page
        .locator('[data-slot="page-header"]')
        .getByRole("button", { name: "New issue", exact: true }),
    ).toHaveCount(0);

    const milestones = page.getByRole("button", {
      name: "Milestones",
      exact: true,
    });
    const parents = page.getByRole("button", { name: "Parents", exact: true });
    await expect(milestones).toHaveAttribute("aria-pressed", "true");
    await expect(parents).toHaveAttribute("aria-pressed", "false");

    // Exercise the real pointer activation and selected-state contract before
    // relying on the parent row downstream.
    await parents.click();
    await expect(parents).toHaveAttribute("aria-pressed", "true");
    await expect(milestones).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("health-rollup-row-REEF-101")).toBeVisible();

    // Native buttons retain keyboard activation when the segmented control has
    // focus; verify both the switch away and the switch back.
    await milestones.focus();
    await page.keyboard.press("Enter");
    await expect(milestones).toHaveAttribute("aria-pressed", "true");
    await expect(parents).toHaveAttribute("aria-pressed", "false");
    await parents.focus();
    await page.keyboard.press("Space");
    await expect(parents).toHaveAttribute("aria-pressed", "true");
    await expect(milestones).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("health-rollup-row-REEF-101").click();
    const labelInput = page.getByTestId("report-label-input");
    await labelInput.fill("docs");
    await labelInput.press("Enter");
    await expect(page.getByTestId("reports-empty")).toBeVisible();
    await expect(page.getByText("No matching report data")).toBeVisible();
    await expect(page.getByText("docs")).toBeVisible();

    const clearParentScope = page.getByTestId("reports-clear-parent-scope");
    await clearParentScope.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("reports-clear-parent-scope")).toHaveCount(0);
    await expect(page.getByText("No matching report data")).toBeVisible();
    await expect(page.getByText("docs")).toBeVisible();
  });

  test("opens the shared New issue dialog from an empty Reports header and restores focus", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/reports");

    const trigger = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New issue", exact: true });
    const reportsEmpty = page.getByTestId("reports-empty");
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(reportsEmpty).toBeVisible();
    await expect(trigger).toHaveCount(1);

    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("new-issue-cancel").click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(reportsEmpty).toBeVisible();

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(reportsEmpty).toBeVisible();

    await trigger.focus();
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(reportsEmpty).toBeVisible();
  });

  test("creates and persists an issue from an empty Reports header", async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await resetFixture(request, "configured_empty");
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/reports");

    const trigger = page
      .locator('[data-slot="page-header"]')
      .getByRole("button", { name: "New issue", exact: true });
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(page.getByTestId("reports-empty")).toBeVisible();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByTestId("new-issue-title-input")
      .fill("Created from empty Reports");
    await dialog.getByTestId("new-issue-submit").click();

    await page.waitForURL(/\/issues\/REEF-\d+/, { timeout: 10_000 });
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(
      "Created from empty Reports",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return (
          state.vaults.find((vault) => vault.name === "reef-e2e")?.issues ?? []
        );
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Created from empty Reports",
          }),
        ]),
      );
  });

  test("records dashboard surface roles and responsive evidence across routed pages", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExistingWorkspace(page);

    const routes = [
      {
        name: "inbox",
        path: "/workspace/reef-e2e/inbox",
        ready: () => page.getByTestId("notification-inbox"),
        focus: () => page.getByRole("link", { name: "Inbox", exact: true }),
      },
      {
        name: "my-work",
        path: "/workspace/reef-e2e/my-work",
        ready: () => page.getByTestId("my-work-page"),
        focus: () => page.locator('[data-testid^="my-work-row-"]').first(),
      },
      {
        name: "planning",
        path: "/workspace/reef-e2e/planning",
        ready: () => page.getByRole("heading", { name: "Planning" }),
        focus: () => page.getByRole("button", { name: "New sprint" }),
      },
      {
        name: "reports",
        path: "/workspace/reef-e2e/reports",
        ready: () => page.getByTestId("reports-page"),
        focus: () => page.getByTestId("new-issue-trigger"),
      },
      {
        name: "settings-workspace",
        path: "/workspace/reef-e2e/settings/workspace",
        ready: () => page.getByTestId("settings-tabs"),
        focus: () =>
          page.getByTestId("settings-tabs").getByRole("link").first(),
      },
      {
        name: "settings-members",
        path: "/workspace/reef-e2e/settings/workspace/members",
        ready: () => page.getByTestId("settings-tabs"),
        focus: () =>
          page.getByTestId("settings-tabs").getByRole("link").first(),
      },
      {
        name: "settings-preferences",
        path: "/workspace/reef-e2e/settings/preferences",
        ready: () => page.getByTestId("settings-tabs"),
        focus: () =>
          page.getByTestId("settings-tabs").getByRole("link").first(),
      },
      {
        name: "settings-deployment",
        path: "/workspace/reef-e2e/settings/deployment",
        ready: () => page.getByTestId("settings-tabs"),
        focus: () =>
          page.getByTestId("settings-tabs").getByRole("link").first(),
      },
    ] as const;

    const observations: Array<
      RuntimeSurfaceObservation & {
        route: string;
        theme: "light" | "dark";
        viewport: string;
      }
    > = [];
    for (const theme of ["light", "dark"] as const) {
      await setRuntimeTheme(page, theme);
      for (const viewport of RUNTIME_VISUAL_VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const route of routes) {
          await page.goto(route.path);
          await expect(route.ready()).toBeVisible({ timeout: 15_000 });
          await expectRuntimeFocus(route.focus());

          const observation = await observeRuntimeSurface(page);
          observations.push({
            route: route.name,
            theme,
            viewport: viewport.name,
            ...observation,
          });
          expect(observation.documentOverflow).toBe(false);
          expect(observation.bodyOverflow).toBe(false);
          expect(observation.mainOverflow).toBe(false);
          expect(observation.unresolvedSurfaceFills).toEqual([]);
          expect(observation.clippedText).toEqual([]);
          expect(observation.outOfViewportControls).toEqual([]);
          const tokenColors = Object.values(observation.roleTokenColors);
          expect(
            tokenColors.every((color) => color && color !== "transparent"),
          ).toBe(true);
          expect(new Set(tokenColors).size).toBe(RUNTIME_SURFACE_ROLES.length);

          const screenshot = await page.screenshot({
            animations: "disabled",
            path: testInfo.outputPath(
              `${route.name}-${theme}-${viewport.name}.png`,
            ),
          });
          expect(screenshot.byteLength).toBeGreaterThan(0);
        }
      }
    }

    await testInfo.attach("dashboard-surface-observations.json", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
  });

  test("records login, onboarding, error, and 404 surface evidence", async ({
    context,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(300_000);
    await context.clearCookies();
    await resetFixture(request, "configured");

    const observations: Array<
      RuntimeSurfaceObservation & {
        route: string;
        theme: "light" | "dark";
        viewport: string;
      }
    > = [];

    for (const theme of ["light", "dark"] as const) {
      await page.goto("/login");
      await setPublicRuntimeTheme(page, theme);
      for (const viewport of RUNTIME_VISUAL_VIEWPORTS) {
        await page.setViewportSize(viewport);
        const loginRoutes = [
          {
            name: "login",
            path: "/login",
            ready: page.getByTestId("akb-login-form"),
            focus: page.getByTestId("login-username"),
          },
          {
            name: "login-error",
            path: "/login?error=expired",
            ready: page.getByTestId("akb-login-form"),
            focus: page.getByTestId("login-username"),
          },
        ] as const;

        for (const route of loginRoutes) {
          await page.goto(route.path);
          await setPublicRuntimeTheme(page, theme);
          await expect(route.ready).toBeVisible({ timeout: 15_000 });
          await expectRuntimeFocus(route.focus);
          const observation = await observeRuntimeSurface(page);
          observations.push({
            route: route.name,
            theme,
            viewport: viewport.name,
            ...observation,
          });
          expect(observation.documentOverflow).toBe(false);
          expect(observation.bodyOverflow).toBe(false);
          expect(observation.mainOverflow).toBe(false);
          expect(observation.unresolvedSurfaceFills).toEqual([]);
          expect(observation.clippedText).toEqual([]);
          expect(observation.outOfViewportControls).toEqual([]);
          const screenshot = await page.screenshot({
            animations: "disabled",
            path: testInfo.outputPath(
              `${route.name}-${theme}-${viewport.name}.png`,
            ),
          });
          expect(screenshot.byteLength).toBeGreaterThan(0);
        }

        const missingPath = `/visual-regression-missing-${theme}-${viewport.name}`;
        const response = await page.goto(missingPath);
        expect(response?.status()).toBe(404);
        await setPublicRuntimeTheme(page, theme);
        const notFoundHome = page.getByRole("link", {
          name: "Go to reef home",
        });
        await expect(
          page.getByRole("heading", { name: "Page not found" }),
        ).toBeVisible();
        await expectRuntimeFocus(notFoundHome);
        const observation = await observeRuntimeSurface(page);
        observations.push({
          route: "404",
          theme,
          viewport: viewport.name,
          ...observation,
        });
        expect(observation.documentOverflow).toBe(false);
        expect(observation.bodyOverflow).toBe(false);
        expect(observation.mainOverflow).toBe(false);
        expect(observation.unresolvedSurfaceFills).toEqual([]);
        expect(observation.clippedText).toEqual([]);
        expect(observation.outOfViewportControls).toEqual([]);
        const screenshot = await page.screenshot({
          animations: "disabled",
          path: testInfo.outputPath(`404-${theme}-${viewport.name}.png`),
        });
        expect(screenshot.byteLength).toBeGreaterThan(0);
      }
    }

    await testInfo.attach("auth-error-surface-observations.json", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });

    await resetFixture(request, "raw_only");
    await context.clearCookies();
    await signInAsAlice(page);
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });

    const onboardingObservations: Array<
      RuntimeSurfaceObservation & {
        route: "onboarding";
        theme: "light" | "dark";
        viewport: string;
      }
    > = [];
    for (const theme of ["light", "dark"] as const) {
      await setRuntimeTheme(page, theme);
      for (const viewport of RUNTIME_VISUAL_VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto("/onboarding");
        const panel = page.getByTestId("onboarding-panel");
        await expect(panel).toBeVisible({ timeout: 15_000 });
        await expectRuntimeFocus(
          page.getByTestId("greenfield-vault-name-input"),
        );
        const observation = await observeRuntimeSurface(page);
        onboardingObservations.push({
          route: "onboarding",
          theme,
          viewport: viewport.name,
          ...observation,
        });
        expect(observation.documentOverflow).toBe(false);
        expect(observation.bodyOverflow).toBe(false);
        expect(observation.mainOverflow).toBe(false);
        expect(observation.unresolvedSurfaceFills).toEqual([]);
        expect(observation.clippedText).toEqual([]);
        expect(observation.outOfViewportControls).toEqual([]);
        const screenshot = await page.screenshot({
          animations: "disabled",
          path: testInfo.outputPath(`onboarding-${theme}-${viewport.name}.png`),
        });
        expect(screenshot.byteLength).toBeGreaterThan(0);
      }
    }
    await testInfo.attach("onboarding-surface-observations.json", {
      body: JSON.stringify(onboardingObservations, null, 2),
      contentType: "application/json",
    });
  });
});
