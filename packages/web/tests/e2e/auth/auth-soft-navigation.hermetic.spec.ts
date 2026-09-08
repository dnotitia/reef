import { expect, test } from "@playwright/test";
import {
  openExistingWorkspace,
  resetFixture,
  setAkbAccountDenial,
  setAuthControl,
  writeIndexedDbConfig,
} from "../harness/fixture";

const WORKSPACE = "/workspace/reef-e2e";
const ISSUES_PATH = `${WORKSPACE}/issues`;
const PLANNING_PATH = `${WORKSPACE}/planning`;

function isAuthProbeRequest(request: import("@playwright/test").Request) {
  return (
    new URL(request.url()).pathname === "/api/auth/akb/me" &&
    request.method() === "GET"
  );
}

async function expectLogin(
  page: import("@playwright/test").Page,
  redirect?: string,
): Promise<void> {
  await page.waitForURL((url) => url.pathname === "/login", {
    timeout: 12_000,
  });
  if (redirect) {
    expect(new URL(page.url()).searchParams.get("redirect")).toBe(redirect);
  }
}

async function expectPersistentShell(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect(
    page.getByRole("complementary", { name: "Sidebar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.locator('[data-testid="app-shell-skeleton"]')).toHaveCount(
    0,
  );
}

async function expectAuthPendingSurface(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  surface: {
    path: string;
    title: string;
    skeletonTestId: string;
    labels: readonly string[];
    loadedTestId?: string;
    loadedText?: string;
  },
): Promise<void> {
  await setAuthControl(request, {
    probeDelayMs: 3_000,
    probeDelayOnce: true,
  });
  await page.goto(surface.path);

  await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
  const pendingMain = page.getByTestId("app-shell-skeleton-main");
  const pendingAccessibilitySnapshot = await pendingMain.ariaSnapshot();
  const pending = await page.evaluate((expected) => {
    const shell = document.querySelector('[data-testid="app-shell-skeleton"]');
    const main = shell?.querySelector<HTMLElement>(
      '[data-testid="app-shell-skeleton-main"]',
    );
    const hasDestinationSkeleton = Boolean(
      main &&
        [...main.querySelectorAll<HTMLElement>("[data-testid]")].some(
          (element) => element.dataset.testid === expected.skeletonTestId,
        ),
    );
    const text = main?.textContent ?? "";
    return {
      hasDestinationSkeleton,
      hasTitle: text.includes(expected.title),
      hasLabels: expected.labels.every((label) => text.includes(label)),
      buttonCount: main?.querySelectorAll("button").length ?? 0,
      linkCount: main?.querySelectorAll("a").length ?? 0,
    };
  }, surface);
  expect(pending.hasDestinationSkeleton).toBe(true);
  expect(pending.hasTitle).toBe(true);
  expect(pending.hasLabels).toBe(true);
  expect(pending.buttonCount).toBe(0);
  expect(pending.linkCount).toBe(0);
  for (const label of surface.labels) {
    expect(
      pendingAccessibilitySnapshot,
      `${surface.path} pending accessibility tree should include ${label}`,
    ).toContain(label);
  }
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

  if (surface.loadedTestId) {
    await expect(page.getByTestId(surface.loadedTestId)).toBeVisible({
      timeout: 15_000,
    });
  } else if (surface.loadedText) {
    await expect(
      page.getByText(surface.loadedText, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.getByTestId("app-shell-skeleton")).toHaveCount(0);
}

const CONTINUITY_STYLE_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "color",
  "backgroundColor",
  "borderTopWidth",
  "borderTopColor",
  "borderRadius",
  "display",
  "alignItems",
  "justifyContent",
  "gap",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

type ContinuitySnapshot = {
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<(typeof CONTINUITY_STYLE_PROPERTIES)[number], string>;
};

type ContinuityEdge = keyof ContinuitySnapshot["rect"];

async function waitForPendingLayout(
  page: import("@playwright/test").Page,
): Promise<void> {
  // The auth-pending tree is intentionally captured before the probe resolves,
  // but after the browser has applied the route stylesheet and settled the
  // first layout. Without this boundary a cold production CSS/layout race can
  // measure an unstyled inline target at x=0 and compare it with the settled
  // header at its real position.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function waitForThemeTransitions(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async () => {
    const transitions = document
      .getAnimations()
      .filter((animation) => animation.constructor.name === "CSSTransition");
    await Promise.allSettled(
      transitions.map((animation) => animation.finished),
    );
  });
}

async function readContinuitySnapshot(
  page: import("@playwright/test").Page,
  selector: string,
  rootSelector?: string,
): Promise<ContinuitySnapshot> {
  const target = rootSelector
    ? page.locator(rootSelector).locator(selector)
    : page.locator(selector);
  await expect(target, `continuity target ${selector}`).toHaveCount(1);
  return target.evaluate((element, properties) => {
    const node = element as HTMLElement;
    const computed = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      styles: Object.fromEntries(
        properties.map((property) => [property, computed[property]]),
      ) as ContinuitySnapshot["styles"],
    };
  }, CONTINUITY_STYLE_PROPERTIES);
}

async function expectContinuitySnapshot(
  pending: ContinuitySnapshot,
  loaded: ContinuitySnapshot,
  name: string,
  options: {
    comparePaint?: boolean;
    edges?: readonly ContinuityEdge[];
  } = {},
): Promise<void> {
  for (const edge of options.edges ?? ["x", "y", "width", "height"]) {
    expect(
      Math.abs(pending.rect[edge] - loaded.rect[edge]),
      `${name} ${edge} changed between auth pending and loaded (pending=${pending.rect[edge]}, loaded=${loaded.rect[edge]})`,
    ).toBeLessThanOrEqual(1);
  }
  const pendingStyles: Partial<ContinuitySnapshot["styles"]> = {
    ...pending.styles,
  };
  const loadedStyles: Partial<ContinuitySnapshot["styles"]> = {
    ...loaded.styles,
  };
  if (!options.comparePaint) {
    for (const property of [
      "color",
      "backgroundColor",
      "borderTopColor",
    ] as const) {
      delete pendingStyles[property];
      delete loadedStyles[property];
    }
  }
  expect(pendingStyles, `${name} computed style changed`).toEqual(loadedStyles);
}

test.describe("auth soft navigation", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
    await setAuthControl(request, {});
  });

  test("keeps a cold protected destination behind auth and preserves a safe nested redirect", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    const firstVisitResponse = await request.get("/api/auth/akb/me");
    const firstVisit = {
      invalidated:
        firstVisitResponse.headers()["x-reef-auth-invalidated"] ?? null,
      status: firstVisitResponse.status(),
    };
    expect(firstVisit).toEqual({ invalidated: null, status: 401 });

    await page.goto(`${PLANNING_PATH}?kind=sprints`);
    await expectLogin(page, PLANNING_PATH);
    await expect(page.locator('[data-testid="planning-skeleton"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="planning-compact-list"]'),
    ).toHaveCount(0);
  });

  test("does not probe during ordinary page and issue-detail navigation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));

    let authProbeCount = 0;
    const countAuthProbe = (request: import("@playwright/test").Request) => {
      if (isAuthProbeRequest(request)) authProbeCount += 1;
    };
    page.on("request", countAuthProbe);

    try {
      await setAuthControl(request, { probeDelayMs: 1_200 });
      await page.locator(`a[href="${PLANNING_PATH}"]`).click();
      await page.waitForURL((url) => url.pathname === PLANNING_PATH);
      await expect(
        page.getByRole("heading", { name: "Planning" }),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="auth-revalidation-status"]'),
      ).toHaveCount(0);
      expect(authProbeCount).toBe(0);

      await page.locator(`a[href="${ISSUES_PATH}"]`).click();
      await page.waitForURL((url) => url.pathname === ISSUES_PATH);
      await page.getByText("Initial issue Alpha", { exact: true }).click();
      await page.waitForURL(/\/issues\/REEF-001(?:\?|$)/);
      await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
      await expect(
        page.locator('[data-testid="auth-revalidation-status"]'),
      ).toHaveCount(0);
      expect(authProbeCount).toBe(0);

      await page.locator('[data-testid="issue-close"]').click();
      await page.waitForURL((url) => url.pathname === ISSUES_PATH);
      expect(authProbeCount).toBe(0);
    } finally {
      page.off("request", countAuthProbe);
    }
  });

  test("converges an externally revoked established session on focus revalidation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { session: "revoked" });

    const probe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await probe;
    await expectLogin(page, ISSUES_PATH);
  });

  test("fails closed at the bounded probe timeout without exposing destination content", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeHang: true });

    const probe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await probe;
    await expectLogin(page, ISSUES_PATH);
    await expect(page.locator('[data-testid="planning-skeleton"]')).toHaveCount(
      0,
    );
  });

  test("keeps a valid slow destination in the protected shell until page data completes", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeDelayMs: 1_200 });

    let authProbeCount = 0;
    const countAuthProbe = (request: import("@playwright/test").Request) => {
      if (isAuthProbeRequest(request)) authProbeCount += 1;
    };
    page.on("request", countAuthProbe);

    try {
      await Promise.all([
        page.waitForURL((url) => url.pathname === PLANNING_PATH),
        page.locator(`a[href="${PLANNING_PATH}"]`).click(),
      ]);
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await expectPersistentShell(page);
      await expect(
        page.locator('[data-testid="auth-revalidation-status"]'),
      ).toHaveCount(0);
      expect(authProbeCount).toBe(0);
      await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible(
        {
          timeout: 15_000,
        },
      );
    } finally {
      page.off("request", countAuthProbe);
    }
  });

  test("keeps destination chrome during a hard-navigation auth probe", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await openExistingWorkspace(page);

    for (const surface of [
      {
        path: ISSUES_PATH,
        title: "Issues",
        skeletonTestId: "issues-skeleton",
        labels: ["Active", "Board", "Status"],
        loadedTestId: "kanban-board",
      },
      {
        path: `${ISSUES_PATH}/REEF-001`,
        title: "Issues",
        skeletonTestId: "issue-detail-skeleton",
        labels: [
          "Title",
          "Description",
          "Details",
          "People",
          "Planning",
          "Activity",
        ],
        loadedTestId: "issue-detail",
      },
      {
        path: `${WORKSPACE}/settings/workspace`,
        title: "Settings",
        skeletonTestId: "settings-workspace-skeleton",
        labels: [
          "Workspace",
          "Preferences",
          "Deployment",
          "Active Workspace",
          "General",
          "Monitored Repositories",
        ],
        loadedTestId: "settings-group-workspace",
      },
      {
        path: PLANNING_PATH,
        title: "Planning",
        skeletonTestId: "planning-skeleton",
        labels: ["Sprints", "Name", "Status", "Dates"],
        loadedText: "Sprint Alpha",
      },
      {
        path: `${WORKSPACE}/my-work`,
        title: "My Work",
        skeletonTestId: "my-work-skeleton",
        labels: ["In progress", "Open work by stage"],
        loadedTestId: "my-work-page",
      },
      {
        path: `${WORKSPACE}/reports`,
        title: "Reports",
        skeletonTestId: "reports-skeleton",
        labels: ["Period", "Snapshot", "Risk map", "Throughput"],
        loadedTestId: "reports-page",
      },
    ] as const) {
      await expectAuthPendingSurface(page, request, surface);
    }
  });

  test("keeps fixed shell and issue chrome visually continuous across auth pending", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await openExistingWorkspace(page);
    await page.setViewportSize({ width: 1280, height: 844 });
    await setAuthControl(request, {
      probeDelayMs: 4_000,
      probeDelayOnce: false,
    });

    await page.goto(`${ISSUES_PATH}?view=board`);
    await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
    await waitForPendingLayout(page);

    const pendingTargets = {
      shell: '[data-testid="app-shell-skeleton-sidebar"]',
      shellBrand:
        '[data-testid="app-shell-skeleton-sidebar"] > div:first-child',
      shellNewIssue: '[data-testid="new-issue-trigger"]',
      shellNavIssue: '[data-testid="sidebar-nav-issues"]',
      issueScope: '[data-testid="scope-switcher"]',
      issueView: '[data-testid="view-switcher"]',
      issueSearch: '[data-testid="search-bar"] input',
      issueFilter:
        '[data-testid="filter-bar"] > :first-child [data-fixed-filter]',
    } as const;
    const loadedTargets = {
      shell: 'aside[aria-label="Sidebar"]',
      shellBrand: 'aside[aria-label="Sidebar"] > div:first-child',
      shellNewIssue: '[data-testid="new-issue-trigger"]',
      shellNavIssue: '[data-testid="sidebar-nav-issues"]',
      issueScope: '[data-testid="scope-switcher"]',
      issueView: '[data-testid="view-switcher"]',
      issueSearch: '[data-testid="search-bar"] input',
      issueFilter: '[data-testid="filter-bar"] > :first-child button',
    } as const;

    const pending = Object.fromEntries(
      await Promise.all(
        Object.entries(pendingTargets).map(async ([name, selector]) => [
          name,
          await readContinuitySnapshot(page, selector),
        ]),
      ),
    ) as Record<keyof typeof pendingTargets, ContinuitySnapshot>;
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("issue-continuity-pending.png"),
    });

    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 15_000,
    });
    const loaded = Object.fromEntries(
      await Promise.all(
        Object.entries(loadedTargets).map(async ([name, selector]) => [
          name,
          await readContinuitySnapshot(page, selector),
        ]),
      ),
    ) as Record<keyof typeof loadedTargets, ContinuitySnapshot>;
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("issue-continuity-loaded.png"),
    });

    for (const name of Object.keys(pendingTargets) as Array<
      keyof typeof pendingTargets
    >) {
      await expectContinuitySnapshot(pending[name], loaded[name], name);
    }
  });

  test("compares fixed chrome across supported surfaces, viewport, locale, and theme", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    await openExistingWorkspace(page);

    const modes = [
      { name: "desktop-en-light", width: 1280, locale: "en", dark: false },
      { name: "narrow-ko-dark", width: 390, locale: "ko", dark: true },
    ] as const;
    const surfaces = [
      {
        name: "issues",
        path: `${ISSUES_PATH}?view=board`,
        target: '[data-testid="scope-switcher"]',
        loadedTestId: "kanban-board",
      },
      {
        name: "issue-detail",
        path: `${ISSUES_PATH}/REEF-001`,
        target: '[data-testid="issue-detail-title-label"]',
        loadedTestId: "issue-detail",
      },
      {
        name: "settings",
        path: `${WORKSPACE}/settings/workspace`,
        target: '[data-testid="settings-tab-workspace"]',
        loadedTestId: "settings-group-workspace",
      },
      {
        name: "planning",
        path: PLANNING_PATH,
        target: '[data-testid="planning-kind-sprints"]',
        loadedText: "Sprint Alpha",
      },
      {
        name: "my-work",
        path: `${WORKSPACE}/my-work`,
        target: '[data-testid="my-work-tile-wip-label"]',
        loadedTestId: "my-work-page",
      },
      {
        name: "reports",
        path: `${WORKSPACE}/reports`,
        target:
          '[data-testid="reports-skeleton-scope-bar"] > [data-fixed-report-control]:first-child',
        loadedTestId: "reports-page",
      },
      {
        name: "shell",
        path: `${ISSUES_PATH}?view=board`,
        target: '[data-testid="new-issue-trigger"]',
        loadedTestId: "kanban-board",
      },
    ] as const;

    for (const mode of modes) {
      await page.setViewportSize({ width: mode.width, height: 844 });
      await page.context().addCookies([
        {
          name: "NEXT_LOCALE",
          value: mode.locale,
          url: "http://localhost:7353",
        },
      ]);
      await writeIndexedDbConfig(page, "theme", mode.dark ? "dark" : "light");
      await page.evaluate(
        (theme) => {
          window.localStorage.setItem("reef.theme", theme);
        },
        mode.dark ? "dark" : "light",
      );
      await page.emulateMedia({ colorScheme: mode.dark ? "dark" : "light" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(() =>
          page
            .locator("html")
            .evaluate(
              (element, dark) => element.classList.contains("dark") === dark,
              mode.dark,
            ),
        )
        .toBe(true);

      for (const surface of surfaces) {
        await setAuthControl(request, {
          probeDelayMs: 4_000,
          // Keep the probe delayed for the whole pending capture. A one-shot
          // delay can be consumed by a bootstrap probe before the route
          // skeleton commits, leaving the global target selector to read the
          // settled tree instead of a real pending tree.
          probeDelayOnce: false,
        });
        await page.goto(surface.path);
        await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
        await waitForPendingLayout(page);
        await expect(page.getByTestId("app-shell-skeleton")).toBeVisible();
        await expect
          .poll(
            () =>
              page
                .locator("html")
                .evaluate(
                  (element, dark) =>
                    element.classList.contains("dark") === dark,
                  mode.dark,
                ),
            {
              message: `${mode.name}/${surface.name} should apply its theme before the pending paint comparison`,
            },
          )
          .toBe(true);
        await waitForThemeTransitions(page);
        await waitForPendingLayout(page);

        const pendingRoot =
          surface.name === "shell"
            ? '[data-testid="app-shell-skeleton-sidebar"]'
            : '[data-testid="app-shell-skeleton-main"]';
        const loadedRoot = surface.name === "shell" ? "aside" : "main";
        const pending = await readContinuitySnapshot(
          page,
          surface.target,
          pendingRoot,
        );
        const pendingBoardFrame =
          mode.name === "narrow-ko-dark" && surface.name === "issues"
            ? await readContinuitySnapshot(
                page,
                '[data-testid="board-columns-skeleton"]',
                pendingRoot,
              )
            : null;
        const pendingBoardHeader =
          mode.name === "narrow-ko-dark" && surface.name === "issues"
            ? await readContinuitySnapshot(
                page,
                '[data-testid="board-columns-skeleton"] > :first-child [data-testid="kanban-group-header"]',
                pendingRoot,
              )
            : null;
        const pendingPlanningCard =
          mode.name === "narrow-ko-dark" && surface.name === "planning"
            ? await readContinuitySnapshot(
                page,
                '[data-testid="planning-skeleton-compact-item"]',
                pendingRoot,
              )
            : null;
        const pendingFixedIconComposition =
          mode.name === "narrow-ko-dark" && surface.name === "issues"
            ? {
                updatedAtIcons: await page
                  .locator(
                    `${pendingRoot} [data-fixed-filter-key="updatedAtRange"] svg`,
                  )
                  .count(),
                statusIcons: await page
                  .locator(
                    `${pendingRoot} [data-testid="kanban-group-header"] svg`,
                  )
                  .count(),
              }
            : null;
        await page.screenshot({
          animations: "disabled",
          path: testInfo.outputPath(
            `continuity-${mode.name}-${surface.name}-pending.png`,
          ),
        });

        if ("loadedTestId" in surface) {
          await expect(page.getByTestId(surface.loadedTestId)).toBeVisible({
            timeout: 15_000,
          });
        } else if ("loadedText" in surface) {
          await expect(
            page.getByText(surface.loadedText, { exact: true }),
          ).toBeVisible({ timeout: 15_000 });
        }
        await expect(page.getByTestId("app-shell-skeleton")).toHaveCount(0);
        await waitForPendingLayout(page);
        await expect
          .poll(() =>
            page
              .locator("html")
              .evaluate(
                (element, dark) => element.classList.contains("dark") === dark,
                mode.dark,
              ),
          )
          .toBe(true);

        const loadedSelector =
          surface.name === "reports"
            ? '[data-testid="report-scope-bar"] > [data-fixed-report-control]:first-child button'
            : surface.target;
        const loaded = await readContinuitySnapshot(
          page,
          loadedSelector,
          loadedRoot,
        );
        const loadedFixedIconComposition =
          mode.name === "narrow-ko-dark" && surface.name === "issues"
            ? {
                updatedAtIcons: await page
                  .locator(
                    `${loadedRoot} [data-testid="updated-at-filter-trigger"] svg`,
                  )
                  .count(),
                statusIcons: await page
                  .locator(
                    `${loadedRoot} [data-testid="kanban-group-header"] svg`,
                  )
                  .count(),
              }
            : null;
        if (pendingFixedIconComposition && loadedFixedIconComposition) {
          expect(pendingFixedIconComposition).toEqual(
            loadedFixedIconComposition,
          );
          expect(pendingFixedIconComposition).toEqual({
            updatedAtIcons: 2,
            statusIcons: 5,
          });
        }
        await page.screenshot({
          animations: "disabled",
          path: testInfo.outputPath(
            `continuity-${mode.name}-${surface.name}-loaded.png`,
          ),
        });
        await expectContinuitySnapshot(
          pending,
          loaded,
          `${mode.name}/${surface.name}`,
          { comparePaint: true },
        );

        if (mode.name === "narrow-ko-dark" && surface.name === "issues") {
          const loadedBoard = await readContinuitySnapshot(
            page,
            '[data-testid="kanban-board-body"]',
            loadedRoot,
          );
          await expectContinuitySnapshot(
            pendingBoardFrame as ContinuitySnapshot,
            loadedBoard,
            `${mode.name}/${surface.name}/board-frame`,
            { comparePaint: true, edges: ["x", "y", "width", "height"] },
          );

          const loadedBoardHeader = await readContinuitySnapshot(
            page,
            '[data-testid="kanban-board-body"] > :first-child [data-testid="kanban-group-header"]',
            loadedRoot,
          );
          await expectContinuitySnapshot(
            pendingBoardHeader as ContinuitySnapshot,
            loadedBoardHeader,
            `${mode.name}/${surface.name}/first-group-header`,
            { comparePaint: true },
          );
        }

        if (mode.name === "narrow-ko-dark" && surface.name === "planning") {
          const loadedPlanningCard = await readContinuitySnapshot(
            page,
            '[data-testid="planning-compact-list"] > article:first-child',
            loadedRoot,
          );
          // Card height is data-dependent: the settled card contains the real
          // item's issue rollup and detail summary. Its fixed frame still owns
          // the top/inline geometry and computed chrome, which this compares.
          await expectContinuitySnapshot(
            pendingPlanningCard as ContinuitySnapshot,
            loadedPlanningCard,
            `${mode.name}/${surface.name}/compact-card-frame`,
            { comparePaint: true, edges: ["x", "y", "width"] },
          );
        }
      }
    }
  });

  test("captures fixed surfaces before hydration and after settlement", async ({
    context,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(240_000);
    await openExistingWorkspace(page);

    const modes = [
      { name: "desktop-en-light", width: 1280, locale: "en", dark: false },
      { name: "narrow-ko-dark", width: 390, locale: "ko", dark: true },
    ] as const;
    const surfaces = [
      {
        name: "issues",
        path: `${ISSUES_PATH}?view=board`,
        target: '[data-testid="scope-switcher"]',
        loadedTestId: "kanban-board",
      },
      {
        name: "issue-detail",
        path: `${ISSUES_PATH}/REEF-001`,
        target: '[data-testid="issue-detail-title-label"]',
        loadedTestId: "issue-detail",
      },
      {
        name: "settings",
        path: `${WORKSPACE}/settings/workspace`,
        target: '[data-testid="settings-tab-workspace"]',
        loadedTestId: "settings-group-workspace",
      },
      {
        name: "planning",
        path: PLANNING_PATH,
        target: '[data-testid="planning-kind-sprints"]',
        loadedText: "Sprint Alpha",
      },
      {
        name: "my-work",
        path: `${WORKSPACE}/my-work`,
        target: '[data-testid="my-work-tile-wip-label"]',
        loadedTestId: "my-work-page",
      },
      {
        name: "reports",
        path: `${WORKSPACE}/reports`,
        target:
          '[data-testid="reports-skeleton-scope-bar"] > [data-fixed-report-control]:first-child',
        loadedTestId: "reports-page",
      },
    ] as const;
    const observations: Array<Record<string, unknown>> = [];

    for (const mode of modes) {
      await page.setViewportSize({ width: mode.width, height: 844 });
      await page.context().addCookies([
        {
          name: "NEXT_LOCALE",
          value: mode.locale,
          url: "http://localhost:7353",
        },
      ]);
      await writeIndexedDbConfig(page, "theme", mode.dark ? "dark" : "light");
      await page.evaluate(
        (theme) => window.localStorage.setItem("reef.theme", theme),
        mode.dark ? "dark" : "light",
      );
      await page.emulateMedia({ colorScheme: mode.dark ? "dark" : "light" });

      for (const surface of surfaces) {
        await setAuthControl(request, {
          probeDelayMs: 4_000,
          probeDelayOnce: false,
        });
        const earlyPage = await context.newPage();
        await earlyPage.setViewportSize({ width: mode.width, height: 844 });
        await earlyPage.emulateMedia({
          colorScheme: mode.dark ? "dark" : "light",
        });

        let holdScripts = true;
        let heldScriptCount = 0;
        const scriptReleaseWaiters: Array<() => void> = [];
        const scriptPattern = /\/_next\/static\/.*\.js(?:\?.*)?$/u;
        await earlyPage.route(scriptPattern, async (route) => {
          if (!holdScripts) {
            await route.continue();
            return;
          }
          heldScriptCount += 1;
          await new Promise<void>((resolve) => {
            scriptReleaseWaiters.push(resolve);
          });
          await route.continue();
        });

        await earlyPage.goto(surface.path, { waitUntil: "commit" });
        await expect
          .poll(() => heldScriptCount, {
            message: `${mode.name}/${surface.name} should hold a client script before hydration`,
          })
          .toBeGreaterThan(0);
        await expect(
          earlyPage.getByTestId("app-shell-skeleton-main"),
        ).toBeVisible();

        // JavaScript is deliberately held, so this capture is the server HTML
        // and CSS paint before React hydration can run. Do not wait for fonts
        // or animation frames here: that would turn this into the later
        // pending capture used by the ordinary continuity test.
        const beforeHydration = await earlyPage.evaluate(
          ({ includeScopeRect, selector }) => {
            const html = document.documentElement;
            const main = document.querySelector<HTMLElement>(
              '[data-testid="app-shell-skeleton-main"]',
            );
            const target = main?.querySelector<HTMLElement>(selector) ?? null;
            const rectOf = (node: HTMLElement | null) => {
              if (!node) return null;
              const rect = node.getBoundingClientRect();
              return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              };
            };
            const targetRect = rectOf(target);
            return {
              readyState: document.readyState,
              darkClass: html.classList.contains("dark"),
              targetRect,
              scopeRect: includeScopeRect ? targetRect : null,
              mainRect: rectOf(main),
              skeletonPresent: Boolean(
                document.querySelector('[data-testid="app-shell-skeleton"]'),
              ),
            };
          },
          {
            includeScopeRect: surface.name === "issues",
            selector: surface.target,
          },
        );
        const beforeSnapshot = await readContinuitySnapshot(
          earlyPage,
          surface.target,
          '[data-testid="app-shell-skeleton-main"]',
        );
        await earlyPage.screenshot({
          animations: "disabled",
          path: testInfo.outputPath(
            surface.name === "issues"
              ? `hydration-${mode.name}-before-hydration.png`
              : `hydration-${mode.name}-${surface.name}-before-hydration.png`,
          ),
        });
        expect(beforeHydration.skeletonPresent).toBe(true);
        expect(beforeHydration.targetRect).not.toBeNull();
        expect(beforeHydration.mainRect).not.toBeNull();
        if (surface.name === "issues") {
          expect(beforeHydration.scopeRect).not.toBeNull();
        }
        expect(beforeHydration.darkClass).toBe(false);

        holdScripts = false;
        for (const release of scriptReleaseWaiters.splice(0)) release();

        let themeAppliedPending: {
          darkClass: boolean;
          skeletonPresent: boolean;
        } | null = null;
        if (mode.dark) {
          await expect
            .poll(() =>
              earlyPage
                .locator("html")
                .evaluate((element) => element.classList.contains("dark")),
            )
            .toBe(true);
          await expect(
            earlyPage.getByTestId("app-shell-skeleton"),
          ).toBeVisible();
          themeAppliedPending = await earlyPage.evaluate(() => ({
            darkClass: document.documentElement.classList.contains("dark"),
            skeletonPresent: Boolean(
              document.querySelector('[data-testid="app-shell-skeleton"]'),
            ),
          }));
          await earlyPage.screenshot({
            animations: "disabled",
            path: testInfo.outputPath(
              surface.name === "issues"
                ? `hydration-${mode.name}-theme-applied-pending.png`
                : `hydration-${mode.name}-${surface.name}-theme-applied-pending.png`,
            ),
          });
          expect(themeAppliedPending).toEqual({
            darkClass: true,
            skeletonPresent: true,
          });
        } else {
          expect(themeAppliedPending).toBeNull();
        }

        if ("loadedTestId" in surface) {
          await expect(earlyPage.getByTestId(surface.loadedTestId)).toBeVisible(
            {
              timeout: 15_000,
            },
          );
        } else {
          await expect(
            earlyPage.getByText(surface.loadedText, { exact: true }),
          ).toBeVisible({ timeout: 15_000 });
        }
        await expect(earlyPage.getByTestId("app-shell-skeleton")).toHaveCount(
          0,
        );
        const settled = await earlyPage.evaluate(() => ({
          darkClass: document.documentElement.classList.contains("dark"),
          skeletonPresent: Boolean(
            document.querySelector('[data-testid="app-shell-skeleton"]'),
          ),
        }));
        expect(settled.darkClass).toBe(mode.dark);
        const loadedSelector =
          surface.name === "reports"
            ? '[data-testid="report-scope-bar"] > [data-fixed-report-control]:first-child button'
            : surface.target;
        const settledSnapshot = await readContinuitySnapshot(
          earlyPage,
          loadedSelector,
          "main",
        );
        await earlyPage.screenshot({
          animations: "disabled",
          path: testInfo.outputPath(
            surface.name === "issues"
              ? `hydration-${mode.name}-settled.png`
              : `hydration-${mode.name}-${surface.name}-settled.png`,
          ),
        });
        await expectContinuitySnapshot(
          beforeSnapshot,
          settledSnapshot,
          `${mode.name}/${surface.name}/before-hydration-to-settled`,
          { comparePaint: !mode.dark },
        );
        observations.push({
          mode: mode.name,
          surface: surface.name,
          viewport: `${mode.width}x844`,
          locale: mode.locale,
          scriptsHeld: heldScriptCount,
          beforeHydration,
          themeAppliedPending,
          settled,
        });
        await earlyPage.unroute(scriptPattern);
        await earlyPage.close();
      }
    }

    const attachObservations = async (
      name: string,
      rows: Array<Record<string, unknown>>,
    ) =>
      testInfo.attach(name, {
        body: JSON.stringify(rows, null, 2),
        contentType: "application/json",
      });
    await attachObservations(
      "hydration-boundary-observations.json",
      observations.filter((observation) => observation.surface === "issues"),
    );
    await attachObservations(
      "remaining-hydration-observations.json",
      observations.filter((observation) => observation.surface !== "issues"),
    );
  });

  test("keeps the established shell during a visible-tab revalidation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { probeDelayMs: 1_200 });

    const probe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await probe;

    await page.waitForTimeout(300);
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));
    await expectPersistentShell(page);
    await expect(
      page.locator('[data-testid="auth-revalidation-status"]'),
    ).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("ignores a late probe result after an immediate invalidation", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, {
      probeDelayMs: 6_000,
      probeDelayOnce: true,
    });

    const delayedProbe = page.waitForRequest(isAuthProbeRequest);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await delayedProbe;

    await page.evaluate(() =>
      window.dispatchEvent(new Event("reef:auth-changed")),
    );
    await expectLogin(page, ISSUES_PATH);

    await page.waitForTimeout(6_200);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });

  test("keeps a resource 403 in place and preserves account-denial UX", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await setAuthControl(request, { protectedResponse: "forbidden" });

    const resourceResponse = await page.evaluate(async () => {
      const response = await fetch("/api/users/search?vault=reef-e2e&q=alice", {
        credentials: "same-origin",
        cache: "no-store",
      });
      return {
        invalidated: response.headers.get("X-Reef-Auth-Invalidated"),
        status: response.status,
      };
    });
    expect(resourceResponse).toEqual({ invalidated: null, status: 403 });
    await expect(page).toHaveURL(new RegExp(`${ISSUES_PATH}$`));

    await setAkbAccountDenial(request, "membership_required");
    await page.reload();
    await expectLogin(page);
    expect(new URL(page.url()).searchParams.get("sso_error")).toBe(
      "membership_required",
    );
  });

  test("redirects this tab when a sibling tab broadcasts AUTH_CHANGED_EVENT", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);

    const sibling = await context.newPage();
    try {
      await sibling.goto(page.url());
      await expect(sibling.locator(`a[href="${ISSUES_PATH}"]`)).toBeVisible();

      await sibling.evaluate(() => {
        const channel = new BroadcastChannel("reef:auth");
        channel.postMessage("reef:auth-changed");
        channel.close();
      });

      await expectLogin(page, ISSUES_PATH);
    } finally {
      await sibling.close();
    }
  });
});
