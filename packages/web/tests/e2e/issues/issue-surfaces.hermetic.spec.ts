import { type Locator, type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  writeIndexedDbConfig,
} from "../harness/fixture";

function reefVault(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): Awaited<ReturnType<typeof readFixtureState>>["vaults"][number] {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

const ISSUE_DESCRIPTION_HEIGHT_KEY = "reef:issue-description-height:v1";

const VISUAL_VIEWPORTS = [
  { name: "320", width: 320, height: 844 },
  { name: "375", width: 375, height: 844 },
  { name: "414", width: 414, height: 844 },
  { name: "768", width: 768, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const SURFACE_ROLES = [
  "page",
  "subtle",
  "card",
  "elevated",
  "popover",
] as const;

type SurfaceRole = (typeof SURFACE_ROLES)[number];

type IssueScope = "active" | "backlog";
type IssueLayout = "board" | "list" | "timeline";

type SurfaceObservation = {
  roleCounts: Record<SurfaceRole, number>;
  roleTokenColors: Record<SurfaceRole, string>;
  unresolvedSurfaceFills: Array<{ role: SurfaceRole; className: string }>;
  clippedText: Array<{ tag: string; text: string; className: string }>;
  outOfViewportControls: Array<{ tag: string; text: string }>;
  documentOverflow: boolean;
  bodyOverflow: boolean;
  mainOverflow: boolean;
};

async function setVisualTheme(page: Page, theme: "light" | "dark") {
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

async function observeSurfaceRoles(page: Page): Promise<SurfaceObservation> {
  return page.evaluate((roles) => {
    const rolePattern =
      /^bg-surface-(page|subtle|card|elevated|popover)(?:\/.*)?$/u;
    const roleCounts = Object.fromEntries(
      roles.map((role) => [role, 0]),
    ) as Record<SurfaceRole, number>;
    const unresolvedSurfaceFills: SurfaceObservation["unresolvedSurfaceFills"] =
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
    ) as Record<SurfaceRole, string>;

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>("*"),
    )) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      for (const className of Array.from(element.classList)) {
        const match = className.match(rolePattern);
        if (!match) continue;
        const role = match[1] as SurfaceRole;
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
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: (
            element.textContent ??
            element.getAttribute("aria-label") ??
            ""
          )
            .trim()
            .slice(0, 80),
          rect,
        };
      })
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
  }, SURFACE_ROLES);
}

async function expectVisibleFocus(locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  const viewport = locator.page().viewportSize();
  if (!viewport) throw new Error("Missing Playwright viewport size");
  const focus = await locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    const outlineWidth = Number.parseFloat(styles.outlineWidth) || 0;
    const outlineVisible =
      styles.outlineStyle !== "none" &&
      outlineWidth >= 2 &&
      styles.outlineColor !== "transparent" &&
      styles.outlineColor !== "rgba(0, 0, 0, 0)";
    return {
      outlineVisible,
      boxShadow: styles.boxShadow,
      left: element.getBoundingClientRect().left,
      top: element.getBoundingClientRect().top,
      right: element.getBoundingClientRect().right,
      bottom: element.getBoundingClientRect().bottom,
    };
  });
  expect(focus.outlineVisible || focus.boxShadow !== "none").toBe(true);
  expect(focus.left).toBeGreaterThanOrEqual(-1);
  expect(focus.top).toBeGreaterThanOrEqual(-1);
  expect(focus.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(focus.bottom).toBeLessThanOrEqual(viewport.height + 1);
}

async function waitForIssueView(
  page: Page,
  scope: IssueScope,
  view: IssueLayout,
) {
  await page.waitForURL(
    (url) =>
      url.searchParams.get("scope") === scope &&
      url.searchParams.get("view") === view,
    { timeout: 10_000 },
  );
}

test.describe("Hermetic issue route surfaces", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("records surface roles, focus, clipping, and overflow across the Issues matrix", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExistingWorkspace(page);

    const routes = [
      {
        name: "issues-board",
        path: `/workspace/${REEF_E2E_VAULT}/issues?view=board`,
        ready: () => page.getByTestId("kanban-board"),
        focus: () => page.getByRole("textbox", { name: "Search issues" }),
      },
      {
        name: "issues-list",
        path: `/workspace/${REEF_E2E_VAULT}/issues?view=list`,
        ready: () => page.getByTestId("issue-list-scroll-container"),
        focus: () => page.getByRole("textbox", { name: "Search issues" }),
      },
      {
        name: "issues-backlog",
        path: `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
        ready: () => page.getByTestId("backlog-table"),
        focus: () => page.getByRole("textbox", { name: "Search issues" }),
      },
      {
        name: "issues-timeline",
        path: `/workspace/${REEF_E2E_VAULT}/issues?view=timeline`,
        ready: () => page.getByTestId("timeline-grid"),
        focus: () => page.getByRole("textbox", { name: "Search issues" }),
      },
      {
        name: "issue-detail",
        path: `/workspace/${REEF_E2E_VAULT}/issues/REEF-001`,
        ready: () => page.getByTestId("issue-detail"),
        focus: () => page.getByTestId("issue-title-input"),
      },
    ] as const;

    const observations: Array<
      SurfaceObservation & {
        route: string;
        theme: "light" | "dark";
        viewport: string;
      }
    > = [];
    const rolesSeen = new Set<SurfaceRole>();

    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);

      for (const viewport of VISUAL_VIEWPORTS) {
        await page.setViewportSize(viewport);

        for (const route of routes) {
          await page.goto(route.path);
          await expect(route.ready()).toBeVisible({ timeout: 15_000 });
          await expectVisibleFocus(route.focus());

          const observation = await observeSurfaceRoles(page);
          observations.push({
            route: route.name,
            theme,
            viewport: viewport.name,
            ...observation,
          });
          for (const role of SURFACE_ROLES) {
            if (observation.roleCounts[role] > 0) rolesSeen.add(role);
          }

          expect(
            observation.documentOverflow,
            `${route.name} ${theme} ${viewport.name} document overflow`,
          ).toBe(false);
          expect(
            observation.bodyOverflow,
            `${route.name} ${theme} ${viewport.name} body overflow`,
          ).toBe(false);
          expect(
            observation.mainOverflow,
            `${route.name} ${theme} ${viewport.name} main overflow`,
          ).toBe(false);
          expect(
            observation.unresolvedSurfaceFills,
            `${route.name} ${theme} ${viewport.name} undefined surface fill`,
          ).toEqual([]);
          expect(
            observation.clippedText,
            `${route.name} ${theme} ${viewport.name} clipped text`,
          ).toEqual([]);
          expect(
            observation.outOfViewportControls,
            `${route.name} ${theme} ${viewport.name} controls outside viewport`,
          ).toEqual([]);

          const tokenColors = Object.values(observation.roleTokenColors);
          expect(
            tokenColors.every((color) => color && color !== "transparent"),
          ).toBe(true);
          expect(new Set(tokenColors).size).toBe(SURFACE_ROLES.length);

          const screenshot = await page.screenshot({
            animations: "disabled",
            path: testInfo.outputPath(
              `${route.name}-${theme}-${viewport.name}.png`,
            ),
          });
          expect(screenshot.byteLength).toBeGreaterThan(0);

          if (route.name === "issues-board") {
            await page.getByTestId("sort-control-trigger").click();
            const menu = page.locator('[role="menu"]:visible').last();
            await expect(menu).toBeVisible();
            const popoverObservation = await observeSurfaceRoles(page);
            observations.push({
              route: "issues-board-popover",
              theme,
              viewport: viewport.name,
              ...popoverObservation,
            });
            if (popoverObservation.roleCounts.popover > 0) {
              rolesSeen.add("popover");
            }
            expect(popoverObservation.documentOverflow).toBe(false);
            expect(popoverObservation.bodyOverflow).toBe(false);
            expect(popoverObservation.mainOverflow).toBe(false);
            expect(popoverObservation.unresolvedSurfaceFills).toEqual([]);
            expect(popoverObservation.clippedText).toEqual([]);
            expect(popoverObservation.outOfViewportControls).toEqual([]);
            const popoverScreenshot = await page.screenshot({
              animations: "disabled",
              path: testInfo.outputPath(
                `issues-board-popover-${theme}-${viewport.name}.png`,
              ),
            });
            expect(popoverScreenshot.byteLength).toBeGreaterThan(0);
            await page.keyboard.press("Escape");
            await expect(menu).toBeHidden();
          }
        }
      }
    }

    expect([...rolesSeen].sort()).toEqual([...SURFACE_ROLES].sort());
    await testInfo.attach("issues-surface-observations.json", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
  });

  test("switches between independent scope and layout controls from /issues", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=board");
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="kanban-card"]').first(),
    ).toContainText("Initial issue Alpha");

    await page.locator('[data-testid="view-switcher-list"]').click();
    await page.waitForURL(/view=list/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    await page.locator('[data-testid="view-switcher-timeline"]').click();
    await page.waitForURL(/view=timeline/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="timeline-grid"]')).toBeVisible();

    await page.goto(
      "/workspace/reef-e2e/issues?scope=active&view=timeline&status=todo&q=issue",
    );
    await expect(page.locator('[data-testid="timeline-grid"]')).toBeVisible();

    const scopeSwitcher = page.getByTestId("scope-switcher");
    const scopeBefore = await scopeSwitcher.boundingBox();
    const backlogButton = page.getByTestId("scope-switcher-backlog");
    const backlogBefore = await backlogButton.boundingBox();
    if (!scopeBefore || !backlogBefore) {
      throw new Error("Scope controls have no geometry before switching");
    }

    // Click the exact center of Backlog so the visual pointer target is part
    // of the geometry contract, not just a locator-assisted activation.
    await page.mouse.click(
      backlogBefore.x + backlogBefore.width / 2,
      backlogBefore.y + backlogBefore.height / 2,
    );
    await waitForIssueView(page, "backlog", "list");
    await expect(page.locator('[data-testid="backlog-table"]')).toBeVisible();
    await expect(page.getByText("Backlog issue Gamma")).toBeVisible();

    const scopeAfter = await scopeSwitcher.boundingBox();
    const backlogAfter = await backlogButton.boundingBox();
    if (!scopeAfter || !backlogAfter) {
      throw new Error("Scope controls have no geometry after switching");
    }
    expect(Math.abs(scopeAfter.x - scopeBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(scopeAfter.y - scopeBefore.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(backlogAfter.x - backlogBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(backlogAfter.y - backlogBefore.y)).toBeLessThanOrEqual(1);
    await expect(backlogButton).toBeFocused();
    await expect(backlogButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(
        '[data-slot="page-header-title-adjacent"] [data-testid="scope-switcher"]',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-slot="page-header-actions"] [data-testid="view-switcher"]',
      ),
    ).toHaveCount(1);
    await expect(page.getByTestId("view-switcher-board")).toBeVisible();
    await expect(page.getByTestId("view-switcher-list")).toBeVisible();
    await expect(page.getByTestId("view-switcher-timeline")).toHaveCount(0);

    const url = new URL(page.url());
    expect(url.searchParams.get("scope")).toBe("backlog");
    expect(url.searchParams.get("view")).toBe("list");
    expect(url.searchParams.get("status")).toBe("todo");
    expect(url.searchParams.get("q")).toBe("issue");
  });

  test("restores scope and layout independently and normalizes Backlog Timeline", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto(
      "/workspace/reef-e2e/issues?scope=backlog&view=timeline&priority=low",
    );
    await waitForIssueView(page, "backlog", "list");
    await expect(page.getByTestId("backlog-table")).toBeVisible();
    await expect(page.getByTestId("scope-switcher-backlog")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("scope-switcher-backlog")).toHaveText(
      "Backlog",
    );
    await expect(page.getByTestId("view-switcher-timeline")).toHaveCount(0);
    await expect(page.getByTestId("display-options-trigger")).toContainText(
      "Group: Priority",
    );
    await expect(page.getByTestId("sort-control-trigger")).toContainText(
      "Sort: Rank order",
    );

    await page.getByTestId("scope-switcher-active").click();
    await waitForIssueView(page, "active", "list");
    await page.getByTestId("view-switcher-timeline").click();
    await waitForIssueView(page, "active", "timeline");
    await page.goBack();
    await waitForIssueView(page, "active", "list");
    await page.goBack();
    await waitForIssueView(page, "backlog", "list");
  });

  test("contains board columns and card metadata across narrow viewports", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const viewport of [
      { width: 320, height: 844 },
      { width: 375, height: 844 },
      { width: 414, height: 844 },
      { width: 768, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=board`);
      await expect(page.getByTestId("kanban-board-body")).toBeVisible();

      const geometry = await page
        .getByTestId("kanban-board-body")
        .evaluate((element) => {
          const root = element as HTMLElement;
          const rootRect = root.getBoundingClientRect();
          const horizontallyContained = (node: Element) => {
            const rect = node.getBoundingClientRect();
            return (
              rect.left >= rootRect.left - 1 && rect.right <= rootRect.right + 1
            );
          };
          return {
            bodyOverflowX: root.scrollWidth > root.clientWidth,
            documentOverflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
            columnsContained: Array.from(
              root.querySelectorAll("[data-group-by]"),
            ).every(horizontallyContained),
            cardsContained: Array.from(
              root.querySelectorAll('[data-testid="kanban-card"]'),
            ).every(horizontallyContained),
            cardsDoNotClipContent: Array.from(
              root.querySelectorAll<HTMLElement>('[data-testid="kanban-card"]'),
            ).every((card) => card.scrollWidth <= card.clientWidth + 1),
          };
        });

      expect(geometry.bodyOverflowX, `${viewport.width}px body`).toBe(false);
      expect(geometry.documentOverflow, `${viewport.width}px document`).toBe(
        false,
      );
      expect(geometry.columnsContained, `${viewport.width}px columns`).toBe(
        true,
      );
      expect(geometry.cardsContained, `${viewport.width}px cards`).toBe(true);
      expect(
        geometry.cardsDoNotClipContent,
        `${viewport.width}px card content`,
      ).toBe(true);
    }
  });

  test("keeps narrow Issues chrome and data scrollports contained", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const viewport of [
      { width: 320, height: 844 },
      { width: 375, height: 844 },
      { width: 414, height: 844 },
      { width: 768, height: 844 },
    ]) {
      await page.setViewportSize(viewport);

      for (const [scope, view] of [
        ["active", "board"],
        ["active", "list"],
        ["backlog", "list"],
        ["active", "timeline"],
      ] as const) {
        await page.goto(
          `/workspace/${REEF_E2E_VAULT}/issues?scope=${scope}&view=${view}`,
        );
        await expect(
          page.getByRole("textbox", { name: "Search issues" }),
        ).toBeVisible();
        const scopeSwitcher = page.getByTestId("scope-switcher");
        await expect(scopeSwitcher).toBeVisible();
        await expect(page.getByTestId("view-switcher")).toBeVisible();
        await expect(scopeSwitcher.locator("button")).toHaveCount(2);
        await expect(
          page.locator(
            '[data-slot="page-header-title-adjacent"] [data-testid="scope-switcher"]',
          ),
        ).toHaveCount(1);
        await expect(
          page.locator(
            '[data-slot="page-header-actions"] [data-testid="view-switcher"]',
          ),
        ).toHaveCount(1);
        if (scope === "backlog") {
          const filterGeometry = await page
            .getByTestId("filter-bar")
            .evaluate((element) => {
              const root = element as HTMLElement;
              const rootRect = root.getBoundingClientRect();
              const controls = [
                '[data-testid="severity-dropdown-trigger"]',
                '[data-testid="sort-control"]',
              ].map((selector) =>
                root
                  .querySelector<HTMLElement>(selector)
                  ?.getBoundingClientRect(),
              );
              return {
                flexWrap: getComputedStyle(root).flexWrap,
                filterOverflow: root.scrollWidth > root.clientWidth + 1,
                controlsContained: controls.every(
                  (rect) =>
                    rect !== undefined &&
                    rect.left >= rootRect.left - 1 &&
                    rect.right <= rootRect.right + 1 &&
                    rect.bottom <= rootRect.bottom + 1,
                ),
                documentOverflow:
                  document.documentElement.scrollWidth >
                  document.documentElement.clientWidth,
              };
            });
          expect(
            filterGeometry.flexWrap,
            `${viewport.width}px filter wrap`,
          ).toBe("wrap");
          expect(
            filterGeometry.filterOverflow,
            `${viewport.width}px filter overflow`,
          ).toBe(false);
          expect(
            filterGeometry.controlsContained,
            `${viewport.width}px filter controls`,
          ).toBe(true);
          expect(
            filterGeometry.documentOverflow,
            `${viewport.width}px filter document overflow`,
          ).toBe(false);
        }
        if (view !== "timeline") {
          await expect(page.getByTestId("sort-control-trigger")).toBeVisible();
          await expect(
            page.locator(
              '[data-slot="page-header"] [data-testid="sort-control"]',
            ),
          ).toHaveCount(0);
          await expect(page.getByTestId("sort-control")).toHaveCount(1);
          const sortPlacement = await page
            .getByTestId("filter-bar")
            .evaluate((root) => {
              const display = root.querySelector(
                '[data-testid="display-options-trigger"]',
              );
              const sort = root.querySelector('[data-testid="sort-control"]');
              return {
                directlyAfterDisplay:
                  display?.parentElement?.nextElementSibling === sort,
                toolbarOwnsSort: sort?.parentElement === root,
              };
            });
          expect(sortPlacement.directlyAfterDisplay).toBe(true);
          expect(sortPlacement.toolbarOwnsSort).toBe(true);
        } else {
          await expect(
            page.locator(
              '[data-slot="page-header"] [data-testid="sort-control"]',
            ),
          ).toHaveCount(0);
          await expect(page.getByTestId("sort-control")).toHaveCount(0);
        }

        const headerGeometry = await page
          .locator('[data-slot="page-header"]')
          .evaluate((element) => {
            const root = element as HTMLElement;
            const rootRect = root.getBoundingClientRect();
            const scope = root.querySelector('[data-testid="scope-switcher"]');
            const view = root.querySelector('[data-testid="view-switcher"]');
            return {
              scopeBeforeView: Boolean(
                scope &&
                  view &&
                  scope.compareDocumentPosition(view) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
              ),
              actionsContained: Array.from(
                root.querySelectorAll("button"),
              ).every((button) => {
                const rect = button.getBoundingClientRect();
                return (
                  rect.left >= rootRect.left - 1 &&
                  rect.right <= rootRect.right + 1
                );
              }),
              documentOverflow:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
              mainOverflow: (() => {
                const main = document.querySelector("main");
                return main instanceof HTMLElement
                  ? main.scrollWidth > main.clientWidth
                  : false;
              })(),
            };
          });
        expect(
          headerGeometry.scopeBeforeView,
          `${view} ${viewport.width}px header order`,
        ).toBe(true);
        expect(
          headerGeometry.actionsContained,
          `${view} ${viewport.width}px header`,
        ).toBe(true);
        expect(
          headerGeometry.documentOverflow,
          `${view} ${viewport.width}px document`,
        ).toBe(false);
        expect(
          headerGeometry.mainOverflow,
          `${view} ${viewport.width}px main`,
        ).toBe(false);

        if (view === "board") {
          const boardScroll = page.getByTestId("kanban-board-body");
          await expect(boardScroll).toHaveAttribute("role", "region");
          await expect(boardScroll).toHaveAttribute("tabindex", "0");
          await expect(boardScroll).toBeVisible();
          continue;
        }

        const scroll = page.getByTestId(
          view === "list"
            ? scope === "backlog"
              ? "backlog-scroll-container"
              : "issue-list-scroll-container"
            : "timeline-grid",
        );
        await expect(scroll).toHaveAttribute("role", "region");
        await expect(scroll).toHaveAttribute("tabindex", "0");
        await expect(scroll).toBeVisible();
        const scrollGeometry = await scroll.evaluate((element) => {
          const root = element as HTMLElement;
          return {
            hasOverflow: root.scrollWidth > root.clientWidth,
            documentOverflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          };
        });
        expect(
          scrollGeometry.hasOverflow,
          `${view} ${viewport.width}px scroll`,
        ).toBe(true);
        expect(
          scrollGeometry.documentOverflow,
          `${view} ${viewport.width}px scroll`,
        ).toBe(false);
      }
    }
  });

  test("wraps Backlog filters inside a 320px dark viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await openExistingWorkspace(page);
    await writeIndexedDbConfig(page, "theme", "dark");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => {
      window.localStorage.setItem("reef.theme", "dark");
    });
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
    );
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("backlog-table")).toBeVisible();

    const filterBar = page.getByTestId("filter-bar");
    await expect(filterBar).toHaveAttribute("role", "region");
    await expect(page.getByTestId("severity-dropdown-trigger")).toBeVisible();
    await expect(page.getByTestId("sort-control-trigger")).toBeVisible();

    const geometry = await filterBar.evaluate((element) => {
      const root = element as HTMLElement;
      const rootRect = root.getBoundingClientRect();
      const controlSelectors = [
        '[data-testid="severity-dropdown-trigger"]',
        '[data-testid="sort-control"]',
      ];
      const controls = controlSelectors.map((selector) => {
        const control = root.querySelector<HTMLElement>(selector);
        const rect = control?.getBoundingClientRect();
        return {
          right: rect?.right ?? Number.POSITIVE_INFINITY,
          bottom: rect?.bottom ?? Number.NEGATIVE_INFINITY,
          visible: Boolean(rect && rect.width > 0 && rect.height > 0),
        };
      });
      const dataScrollport = document.querySelector<HTMLElement>(
        '[data-testid="backlog-scroll-container"]',
      );
      return {
        flexWrap: getComputedStyle(root).flexWrap,
        filterOverflow: root.scrollWidth > root.clientWidth + 1,
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        controlsContained: controls.every(
          (control) =>
            control.visible &&
            control.right <= rootRect.right + 1 &&
            control.right >= rootRect.left - 1 &&
            control.bottom <= rootRect.bottom + 1,
        ),
        dataScrollportPreserved:
          dataScrollport !== null &&
          dataScrollport.getAttribute("role") === "region" &&
          dataScrollport.tabIndex === 0 &&
          dataScrollport.scrollWidth > dataScrollport.clientWidth,
      };
    });

    expect(geometry.flexWrap).toBe("wrap");
    expect(geometry.filterOverflow).toBe(false);
    expect(geometry.documentOverflow).toBe(false);
    expect(geometry.controlsContained).toBe(true);
    expect(geometry.dataScrollportPreserved).toBe(true);
  });

  test("shows the direction tooltip on hover, focus, and after toggling", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);
      await page.getByTestId("sort-control-trigger").click();
      await page.getByTestId("sort-option-created_at").click();
      await expect(page.getByTestId("sort-direction-toggle")).toBeVisible();

      // Selecting a date sort exercises the same long-lived direction state
      // that the narrow and desktop route checks share.
      const direction = page.getByTestId("sort-direction-toggle");
      const tooltip = page.getByRole("tooltip");
      await direction.hover();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveText("Direction: Newest");
      await page.waitForTimeout(250);
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveText("Direction: Newest");

      await page.getByTestId("sort-control-trigger").focus();
      await page.mouse.move(8, 8);
      await expect(tooltip).toBeHidden();
      await direction.hover();
      await expect(tooltip).toBeVisible();
      await page.waitForTimeout(250);
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveText("Direction: Newest");

      await direction.focus();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveText("Direction: Newest");

      await direction.press("Space");
      await expect(direction).toHaveAttribute("aria-label", /Oldest/);
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveText("Direction: Oldest");

      await page.getByTestId("sort-control-trigger").focus();
      await page.mouse.move(8, 8);
      await expect(tooltip).toBeHidden();
      await direction.hover();
      await expect(tooltip).toBeVisible();
      await page.waitForTimeout(250);
      await expect(tooltip).toHaveText("Direction: Oldest");
    }
  });

  test("keeps List and Backlog table geometry and controls aligned on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    const list = page.locator('[data-testid="issue-list-scroll-container"]');
    const defaultList = await list.evaluate((element) => {
      const root = element as HTMLElement;
      const header = root.querySelector('thead th[data-column-key="id"]');
      const row = root.querySelector(
        'tbody tr[data-testid="issue-list-row"] td[data-column-key="id"]',
      );
      return {
        headerHeight: header?.getBoundingClientRect().height ?? 0,
        rowHeight: row?.getBoundingClientRect().height ?? 0,
        columnKeys: Array.from(
          root.querySelectorAll("thead th[data-column-key]"),
        ).map((cell) => cell.getAttribute("data-column-key")),
        tableOverflow: root.scrollWidth > root.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(Math.round(defaultList.headerHeight)).toBe(32);
    expect(Math.round(defaultList.rowHeight)).toBe(40);
    expect(defaultList.columnKeys).toEqual([
      "select",
      "rank",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "due",
      "updated",
    ]);
    expect(defaultList.tableOverflow).toBe(false);
    expect(defaultList.documentOverflow).toBe(false);

    async function toggleListColumn(column: string) {
      await page.getByTestId("issue-list-columns-control").click();
      await page.getByTestId(`issue-list-column-${column}`).click();
    }

    for (const column of ["start", "sprint", "milestone", "release"]) {
      await toggleListColumn(column);
    }

    const expandedList = await list.evaluate((element) => {
      const root = element as HTMLElement;
      root.scrollLeft = root.scrollWidth;
      root.dispatchEvent(new Event("scroll"));
      const stickyKeys = ["select", "id", "type", "title"];
      return {
        tableOverflow: root.scrollWidth > root.clientWidth,
        stickyAlignment: stickyKeys.map((key) => {
          const header = root.querySelector(
            `thead th[data-column-key="${key}"]`,
          );
          const cell = root.querySelector(
            `tbody tr[data-testid="issue-list-row"] td[data-column-key="${key}"]`,
          );
          return {
            key,
            headerLeft: Math.round(header?.getBoundingClientRect().left ?? 0),
            cellLeft: Math.round(cell?.getBoundingClientRect().left ?? 0),
          };
        }),
      };
    });
    expect(expandedList.tableOverflow).toBe(true);
    for (const alignment of expandedList.stickyAlignment) {
      expect(alignment.cellLeft).toBe(alignment.headerLeft);
    }

    await page.getByTestId("scope-switcher-backlog").click();
    await waitForIssueView(page, "backlog", "list");
    await expect(page.getByTestId("backlog-table")).toBeVisible();
    await expect(page.getByTestId("backlog-row").first()).toBeVisible();
    await expect(page.getByTestId("backlog-rank-header")).toBeVisible();

    const backlog = page.getByTestId("backlog-table");
    const backlogGeometry = await backlog.evaluate((element) => {
      const root = element as HTMLElement;
      const header = root.querySelector('thead th[data-column-key="id"]');
      const row = root.querySelector(
        'tbody tr[data-testid="backlog-row"] td[data-column-key="id"]',
      );
      const status = root.querySelector(
        '[data-testid="issue-inline-edit-status"]',
      );
      const statusValue = status?.querySelector<HTMLElement>("span > span");
      return {
        headerHeight: header?.getBoundingClientRect().height ?? 0,
        rowHeight: row?.getBoundingClientRect().height ?? 0,
        statusHeight: status?.getBoundingClientRect().height ?? 0,
        statusText: statusValue?.textContent?.trim() ?? "",
        statusTextClipped:
          !statusValue || statusValue.scrollWidth > statusValue.clientWidth,
        columnKeys: Array.from(
          root.querySelectorAll("thead th[data-column-key]"),
        ).map((cell) => cell.getAttribute("data-column-key")),
      };
    });
    expect(Math.round(backlogGeometry.headerHeight)).toBe(32);
    expect(Math.round(backlogGeometry.rowHeight)).toBe(40);
    expect(backlogGeometry.statusHeight).toBeLessThanOrEqual(40);
    expect(backlogGeometry.statusText).toBe("Backlog");
    expect(backlogGeometry.statusTextClipped).toBe(false);
    expect(backlogGeometry.columnKeys).toEqual([
      "select",
      "rank",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "updated",
    ]);

    const filterGeometry = await page
      .getByTestId("filter-bar")
      .evaluate((element) => {
        const root = element as HTMLElement;
        const rootRect = root.getBoundingClientRect();
        const display = root.querySelector<HTMLElement>(
          '[data-testid="display-options-trigger"]',
        );
        const sort = root.querySelector<HTMLElement>(
          '[data-testid="sort-control"]',
        );
        return {
          sortImmediatelyAfterDisplay:
            display?.parentElement?.nextElementSibling === sort,
          controlsContained: Array.from(
            root.querySelectorAll<HTMLElement>(
              '[data-testid$="-dropdown-trigger"], [data-testid="sort-control"], [data-testid="milestone-filter"], [data-testid="labels-filter"], [data-testid="display-options-trigger"], [data-testid="named-filter-trigger"]',
            ),
          ).every((control) => {
            const rect = control.getBoundingClientRect();
            return (
              rect.left >= rootRect.left - 1 && rect.right <= rootRect.right + 1
            );
          }),
          documentOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });
    expect(filterGeometry.sortImmediatelyAfterDisplay).toBe(true);
    expect(filterGeometry.controlsContained).toBe(true);
    expect(filterGeometry.documentOverflow).toBe(false);

    const grip = page.locator('[data-testid^="backlog-grip-"]').first();
    await expect(grip).toBeVisible();
    await expect(grip).toHaveAttribute(
      "title",
      "Drag to reorder in Rank order",
    );
    await grip.focus();
    await expect
      .poll(() => grip.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");

    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-priority").click();
    await expect(page.getByTestId("backlog-rank-header")).toHaveAttribute(
      "title",
      "Switch to Rank order to reorder",
    );
    await expect(page.locator('[data-testid^="backlog-grip-"]')).toHaveCount(0);

    await page.getByTestId("sort-control-trigger").click();
    await page.getByTestId("sort-option-rank").click();
    await expect(
      page.locator('[data-testid^="backlog-grip-"]').first(),
    ).toBeVisible();

    await page.getByTestId("view-switcher-list").click();
    await page.waitForURL(/view=list/, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="backlog-row"]').first(),
    ).toBeVisible();
    await expect(page.locator('thead th[data-column-key="start"]')).toHaveCount(
      0,
    );
  });

  test("fits the default List preset inside the narrow desktop content column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 992, height: 720 });
    await openExistingWorkspace(page);
    await expect(page.locator("aside")).toBeVisible();

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    const scroll = page.getByTestId("issue-list-scroll-container");
    const geometry = await scroll.evaluate((element) => {
      const root = element as HTMLElement;
      const table = root.querySelector("table");
      const contentRight = root.getBoundingClientRect().right;
      const due = root.querySelector(
        'tbody tr[data-testid="issue-list-row"] td[data-column-key="due"]',
      );
      const updated = root.querySelector(
        'tbody tr[data-testid="issue-list-row"] td[data-column-key="updated"]',
      );
      return {
        tableWidth: table?.getBoundingClientRect().width ?? 0,
        contentWidth: root.clientWidth,
        tableOverflow: root.scrollWidth > root.clientWidth,
        dueVisible: (due?.getBoundingClientRect().right ?? 0) <= contentRight,
        updatedVisible:
          (updated?.getBoundingClientRect().right ?? 0) <= contentRight,
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        columnKeys: Array.from(
          root.querySelectorAll("thead th[data-column-key]"),
        ).map((cell) => cell.getAttribute("data-column-key")),
      };
    });

    expect(geometry.tableWidth).toBeLessThanOrEqual(geometry.contentWidth);
    expect(geometry.tableOverflow).toBe(false);
    expect(geometry.dueVisible).toBe(true);
    expect(geometry.updatedVisible).toBe(true);
    expect(geometry.documentOverflow).toBe(false);
    expect(geometry.columnKeys).toEqual([
      "select",
      "rank",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "due",
      "updated",
    ]);

    await page.goto("/workspace/reef-e2e/issues?scope=backlog&view=list");
    await expect(page.getByTestId("backlog-table")).toBeVisible();

    const narrowStatusGeometry = await page
      .locator('[data-testid="issue-inline-edit-status"]')
      .first()
      .evaluate((element) => {
        const value = element.querySelector<HTMLElement>("span > span");
        return {
          text: value?.textContent?.trim() ?? "",
          clipped: !value || value.scrollWidth > value.clientWidth,
        };
      });
    expect(narrowStatusGeometry.text).toBe("Backlog");
    expect(narrowStatusGeometry.clipped).toBe(false);

    const backlogFilterBar = page.getByTestId("filter-bar");
    const backlogFilterGeometry = await backlogFilterBar.evaluate((element) => {
      const root = element as HTMLElement;
      const selectors = [
        '[data-testid="type-dropdown-trigger"]',
        '[data-testid="priority-dropdown-trigger"]',
        '[data-testid="severity-dropdown-trigger"]',
        '[data-testid="dependency-dropdown-trigger"]',
        '[data-testid="assignee-dropdown-trigger"]',
        '[data-testid="requester-dropdown-trigger"]',
        '[data-testid="milestone-filter"]',
        '[data-testid="labels-filter"]',
        '[data-testid="display-options-trigger"]',
        '[data-testid="named-filter-trigger"]',
      ];
      const rootRect = root.getBoundingClientRect();
      return {
        flexWrap: getComputedStyle(root).flexWrap,
        filterOverflow: root.scrollWidth > root.clientWidth + 1,
        controlsContained: selectors.every((selector) => {
          const control = root.querySelector<HTMLElement>(selector);
          if (!control) return false;
          const rect = control.getBoundingClientRect();
          return (
            rect.left >= rootRect.left - 1 && rect.right <= rootRect.right + 1
          );
        }),
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(backlogFilterGeometry.flexWrap).toBe("wrap");
    expect(backlogFilterGeometry.filterOverflow).toBe(false);
    expect(backlogFilterGeometry.controlsContained).toBe(true);
    expect(backlogFilterGeometry.documentOverflow).toBe(false);
  });

  test("renders the README demo board fixture across workflow columns", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await clearPersistedQueryCacheOnLoad(page);
    await page.goto("/workspace/reef-e2e/issues?view=board");
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="kanban-card"]')).toHaveCount(11);
    await expect(
      page.getByText("Ship stateless BFF route handlers"),
    ).toBeVisible();
  });

  test("opens an intercepted issue detail, autosaves a title edit, and returns to the list backdrop", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Initial issue Alpha").click();

    await page.waitForURL(/\/issues\/REEF-001\?view=list/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Initial issue Alpha",
    );

    await page
      .locator('[data-testid="issue-title-input"]')
      .fill("Initial issue Alpha edited");
    await page.locator('[data-testid="issue-title-input"]').press("Enter");

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issues.find((issue) => issue.id === "REEF-001")
          ?.title;
      })
      .toBe("Initial issue Alpha edited");

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues\?view=list$/, { timeout: 10_000 });
  });

  test("renders a cold issue deep link and closes it back to /issues", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/issues/REEF-002");

    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Initial issue Beta",
    );

    await page.locator('[data-testid="issue-close"]').click();
    await page.waitForURL(/\/issues$/, { timeout: 10_000 });
  });

  test("creates an issue from the global dialog and deletes it from the detail actions menu", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues?view=list");

    await page.locator('[data-testid="new-issue-trigger"]').click();
    await expect(
      page.locator('[data-testid="new-issue-dialog"]'),
    ).toBeVisible();
    await page
      .locator('[data-testid="new-issue-title-input"]')
      .fill("Created from hermetic E2E");
    await page.locator('[data-testid="new-issue-submit"]').click();

    await page.waitForURL(/\/issues\/REEF-004/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Created from hermetic E2E",
    );
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issue_ids;
      })
      .toContain("REEF-004");

    await page.locator('[data-testid="issue-more-trigger"]').click();
    await page.locator('[data-testid="issue-delete-trigger"]').click();
    await expect(
      page.locator('[data-testid="issue-delete-confirm"]'),
    ).toBeVisible();
    await page.locator('[data-testid="issue-delete-confirm-btn"]').click();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issue_ids;
      })
      .not.toContain("REEF-004");
  });

  test("keeps New Issue chrome contained across desktop, mobile, and reduced height", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openExistingWorkspace(page);

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
      { width: 390, height: 420 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

      const trigger = page.getByTestId("new-issue-trigger");
      await expect(trigger).toBeVisible();
      await trigger.click();

      const dialog = page.getByTestId("new-issue-dialog");
      const header = page.getByTestId("new-issue-dialog-header");
      const actions = page.getByTestId("new-issue-dialog-actions");
      const body = page.getByTestId("new-issue-dialog-body");
      const footer = page.getByTestId("new-issue-dialog-footer");
      const template = page.getByTestId("template-picker-trigger");
      const enrich = page.getByTestId("enrich-trigger");
      const draftConversationToggle = page.getByTestId(
        "draft-conversation-toggle",
      );
      const draftViewToggle = page.getByTestId("draft-view-draft");
      const conversationViewToggle = page.getByTestId(
        "draft-view-conversation",
      );
      const title = page.getByTestId("new-issue-title-input");
      const cancel = page.getByTestId("new-issue-cancel");
      const submit = page.getByTestId("new-issue-submit");

      await expect(dialog).toBeVisible();
      await expect(header).toBeVisible();
      await expect(actions).toBeVisible();
      await expect(footer).toBeVisible();

      const geometry = await dialog.evaluate((element) => {
        const root = element as HTMLElement;
        const header = root.querySelector(
          '[data-testid="new-issue-dialog-header"]',
        ) as HTMLElement | null;
        const heading = root.querySelector(
          '[data-testid="new-issue-dialog-heading"]',
        ) as HTMLElement | null;
        const actions = root.querySelector(
          '[data-testid="new-issue-dialog-actions"]',
        ) as HTMLElement | null;
        const body = root.querySelector(
          '[data-testid="new-issue-dialog-body"]',
        ) as HTMLElement | null;
        const footer = root.querySelector(
          '[data-testid="new-issue-dialog-footer"]',
        ) as HTMLElement | null;
        const rect = (node: HTMLElement | null) => {
          const value = node?.getBoundingClientRect();
          return value
            ? {
                top: value.top,
                right: value.right,
                bottom: value.bottom,
                left: value.left,
                width: value.width,
                height: value.height,
              }
            : null;
        };
        const rootRect = rect(root);
        const headingRect = rect(heading);
        const actionsRect = rect(actions);
        const intersects =
          headingRect && actionsRect
            ? headingRect.left < actionsRect.right &&
              headingRect.right > actionsRect.left &&
              headingRect.top < actionsRect.bottom &&
              headingRect.bottom > actionsRect.top
            : false;

        return {
          root: rootRect,
          header: rect(header),
          actions: actionsRect,
          body: rect(body),
          footer: rect(footer),
          headerActionOverlap: intersects,
          rootOverflowY: getComputedStyle(root).overflowY,
          bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
          bodyScrollHeight: body?.scrollHeight ?? 0,
          bodyClientHeight: body?.clientHeight ?? 0,
          bodyScrollTop: body?.scrollTop ?? 0,
          rootScrollTop: root.scrollTop,
          documentHorizontalOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });

      expect(geometry.root).not.toBeNull();
      expect(geometry.header).not.toBeNull();
      expect(geometry.actions).not.toBeNull();
      expect(geometry.body).not.toBeNull();
      expect(geometry.footer).not.toBeNull();
      expect(geometry.headerActionOverlap).toBe(false);
      expect(geometry.rootOverflowY).toBe("hidden");
      expect(geometry.bodyOverflowY).toBe("auto");
      expect(geometry.documentHorizontalOverflow).toBe(false);

      for (const child of [geometry.header, geometry.footer]) {
        expect(child?.top).toBeGreaterThanOrEqual(geometry.root?.top ?? 0);
        expect(child?.right).toBeLessThanOrEqual(geometry.root?.right ?? 0);
        expect(child?.bottom).toBeLessThanOrEqual(geometry.root?.bottom ?? 0);
        expect(child?.left).toBeGreaterThanOrEqual(geometry.root?.left ?? 0);
      }
      expect(geometry.bodyScrollHeight).toBeGreaterThan(
        geometry.bodyClientHeight,
      );

      await body.evaluate((element) => {
        const root = element as HTMLElement;
        root.scrollTop = Math.floor(
          (root.scrollHeight - root.clientHeight) / 2,
        );
      });
      await expect
        .poll(() =>
          body.evaluate((element) => (element as HTMLElement).scrollTop),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          dialog.evaluate((element) => (element as HTMLElement).scrollTop),
        )
        .toBe(0);
      await expect(header).toBeVisible();
      await expect(cancel).toBeVisible();
      await expect(submit).toBeVisible();

      await template.focus();
      await expect(template).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(enrich).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(draftConversationToggle).toBeFocused();
      await page.keyboard.press("Tab");
      if (viewport.width < 900) {
        await expect(draftViewToggle).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(conversationViewToggle).toBeFocused();
        await page.keyboard.press("Tab");
      }
      await expect(title).toBeFocused();
      await cancel.focus();
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(submit).toBeFocused();
      await title.focus();
      await title.fill(`Responsive draft ${viewport.width}x${viewport.height}`);

      await cancel.click();
      await expect(page.getByTestId("discard-draft-confirm")).toBeVisible();
      await page.getByTestId("discard-draft-cancel").click();
      await expect(dialog).toBeVisible();
      await cancel.click();
      await page.getByTestId("discard-draft-confirm-button").click();
      await expect(dialog).toBeHidden();
    }
  });

  test("maximizes and restores the New Issue canvas without losing the draft", async ({
    page,
  }) => {
    const viewport = { width: 1920, height: 1080 };
    await page.setViewportSize(viewport);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    const title = dialog.getByTestId("new-issue-title-input");
    const sourceToggle = dialog
      .getByTestId("markdown-source-toggle")
      .getByRole("button");
    await title.fill("Draft survives maximize");
    await sourceToggle.click();
    const body = dialog.getByTestId("markdown-source-textarea");
    await expect(body).toBeVisible();
    await body.fill("Description survives maximize");

    const normalBox = await dialog.boundingBox();
    if (!normalBox) throw new Error("New Issue dialog has no normal geometry");
    const normalDescriptionBox = await dialog
      .getByTestId("markdown-editor-body-frame")
      .boundingBox();
    if (!normalDescriptionBox) {
      throw new Error("New Issue Description has no normal geometry");
    }
    const handle = dialog.getByTestId("markdown-editor-resize-handle");
    await expect(handle).toHaveAttribute("aria-valuenow", "320");
    const normalDescriptionHeight = Number(
      await handle.getAttribute("aria-valuenow"),
    );
    const maximize = dialog.getByTestId("new-issue-maximize-toggle");
    await expect(maximize).toHaveAttribute("aria-label", "Maximize window");
    await expect(maximize).toHaveAttribute("aria-pressed", "false");
    await maximize.click();

    const restore = dialog.getByTestId("new-issue-maximize-toggle");
    await expect(restore).toHaveAttribute("aria-label", "Restore window");
    await expect(restore).toHaveAttribute("aria-pressed", "true");
    await expect(restore).toBeFocused();
    await expect
      .poll(async () => (await dialog.boundingBox())?.width ?? 0)
      .toBeGreaterThan(normalBox.width + 32);
    const expandedBox = await dialog.boundingBox();
    if (!expandedBox) {
      throw new Error("New Issue dialog has no maximized geometry");
    }
    expect(expandedBox.width).toBeGreaterThan(normalBox.width + 32);
    expect(expandedBox.width).toBeLessThanOrEqual(viewport.width * 0.94 + 1);
    expect(expandedBox.height).toBeGreaterThanOrEqual(normalBox.height - 4);
    expect(expandedBox.height).toBeLessThanOrEqual(viewport.height - 30);
    const expandedDescriptionBox = await dialog
      .getByTestId("markdown-editor-body-frame")
      .boundingBox();
    if (!expandedDescriptionBox) {
      throw new Error("New Issue Description has no maximized geometry");
    }
    // The normal dialog can already consume the viewport's full vertical
    // budget; maximize must never shrink the writing canvas, but only grows it
    // when the expanded shell has additional height available.
    expect(expandedDescriptionBox.height).toBeGreaterThanOrEqual(
      normalDescriptionBox.height,
    );
    await expect(title).toHaveValue("Draft survives maximize");
    await expect(body).toHaveValue("Description survives maximize");

    await expect(handle).toBeVisible();
    await expect
      .poll(async () => Number(await handle.getAttribute("aria-valuenow")))
      .toBeGreaterThanOrEqual(normalDescriptionHeight);
    expect(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        ISSUE_DESCRIPTION_HEIGHT_KEY,
      ),
    ).toBeNull();

    await restore.click();
    await expect(restore).toHaveAttribute("aria-label", "Maximize window");
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(normalDescriptionHeight),
    );
    await expect(
      dialog.getByTestId("markdown-editor-body-frame"),
    ).toHaveAttribute(
      "style",
      new RegExp(`height: ${normalDescriptionHeight}px`),
    );

    await dialog.getByTestId("new-issue-maximize-toggle").click();
    await expect(
      dialog.getByTestId("new-issue-maximize-toggle"),
    ).toHaveAttribute("aria-label", "Restore window");
    await expect
      .poll(async () => Number(await handle.getAttribute("aria-valuenow")))
      .toBeGreaterThanOrEqual(normalDescriptionHeight);
    const maximizedHeight = Number(await handle.getAttribute("aria-valuenow"));
    await handle.focus();
    await page.keyboard.press("ArrowDown");
    const userHeight = maximizedHeight + 32;
    await expect(handle).toHaveAttribute("aria-valuenow", String(userHeight));
    await expect
      .poll(() =>
        page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          ISSUE_DESCRIPTION_HEIGHT_KEY,
        ),
      )
      .toBe(String(userHeight));

    await restore.click();
    await expect(restore).toHaveAttribute("aria-label", "Maximize window");
    await expect(
      dialog.getByTestId("markdown-editor-body-frame"),
    ).toHaveAttribute("style", new RegExp(`height: ${userHeight}px`));
    await dialog.getByTestId("new-issue-maximize-toggle").click();
    await expect(
      dialog.getByTestId("new-issue-maximize-toggle"),
    ).toHaveAttribute("aria-label", "Restore window");

    await dialog.getByTestId("new-issue-cancel").click();
    await expect(page.getByTestId("discard-draft-confirm")).toBeVisible();
    await page.getByTestId("discard-draft-confirm-button").click();
    await expect(dialog).toBeHidden();

    await page.getByTestId("new-issue-trigger").click();
    await expect(page.getByTestId("new-issue-maximize-toggle")).toHaveAttribute(
      "aria-label",
      "Restore window",
    );
    await expect(page.getByTestId("new-issue-maximize-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const reopenedDialog = page.getByTestId("new-issue-dialog");
    await expect(
      reopenedDialog.getByTestId("markdown-editor-body-frame"),
    ).toHaveAttribute("style", /height: [\d.]+px/);
    await expect
      .poll(async () => {
        const style = await reopenedDialog
          .getByTestId("markdown-editor-body-frame")
          .getAttribute("style");
        return Number.parseFloat(
          style?.match(/height: ([\d.]+)px/u)?.[1] ?? "0",
        );
      })
      .toBeGreaterThanOrEqual(userHeight);
    await page.getByTestId("new-issue-maximize-toggle").click();
    await expect(page.getByTestId("new-issue-maximize-toggle")).toHaveAttribute(
      "aria-label",
      "Maximize window",
    );
    await expect(
      reopenedDialog.getByTestId("markdown-editor-body-frame"),
    ).toHaveAttribute("style", new RegExp(`height: ${userHeight}px`));
    await page.getByTestId("new-issue-cancel").click();
    await expect(page.getByTestId("new-issue-dialog")).toBeHidden();
  });

  test("creates an issue from New Issue at a mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("new-issue-maximize-toggle")).toHaveCount(
      0,
    );
    await dialog
      .getByTestId("new-issue-title-input")
      .fill("Created from mobile New Issue");
    await dialog.getByTestId("new-issue-submit").click();

    await page.waitForURL(/\/issues\/REEF-004$/, { timeout: 10_000 });
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(
      "Created from mobile New Issue",
    );
  });

  test("keeps a created mention body visible after closing, reload, and sign-in", async ({
    context,
    page,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=list`);

    const title = "Created mention body survives re-open";
    const body = "@alice plain @ghost-v4";
    await page.getByTestId("new-issue-trigger").click();
    const dialog = page.getByTestId("new-issue-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("new-issue-title-input").fill(title);
    await dialog
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await dialog.getByTestId("markdown-source-textarea").fill(body);
    await dialog.getByTestId("new-issue-submit").click();

    await page.waitForURL(/\/issues\/REEF-\d+$/, { timeout: 10_000 });
    const issueId = new URL(page.url()).pathname.split("/").at(-1);
    if (!issueId || !/^REEF-\d+$/.test(issueId)) {
      throw new Error(`Unexpected created issue URL: ${page.url()}`);
    }
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await expect(page.getByTestId("issue-title-input")).toHaveValue(title);

    await page.getByTestId("issue-close").click();
    await page.waitForURL(/\/issues(?:\?[^#]*)?$/, { timeout: 10_000 });

    const backlogPath = `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`;
    const expectCreatedBacklogRow = async () => {
      await page.goto(backlogPath);
      await expect(page.getByTestId("backlog-table")).toBeVisible();
      const row = page.getByTestId("backlog-row").filter({ hasText: issueId });
      await expect(row).toContainText(title);
    };

    await expectCreatedBacklogRow();
    await page.reload();
    await expect(page.getByTestId("backlog-table")).toBeVisible();
    await expect(
      page.getByTestId("backlog-row").filter({ hasText: issueId }),
    ).toContainText(title);

    await context.clearCookies();
    await openExistingWorkspace(page);
    await expectCreatedBacklogRow();

    await page.getByTestId("backlog-row").filter({ hasText: issueId }).click();
    await page.waitForURL(
      new RegExp(`/issues/${issueId}\\?scope=backlog&view=list$`),
      {
        timeout: 10_000,
      },
    );
    await expect(page.getByTestId("issue-detail")).toBeVisible();
    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    await expect(page.getByTestId("markdown-source-textarea")).toHaveValue(
      body,
    );
  });

  test("creates a sub-issue from Sub-issues with inherited defaults and optimistic child list update", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    const before = reefVault(await readFixtureState(request));
    const parent = before.issues.find((issue) => issue.id === "REEF-001");
    if (!parent) throw new Error("Missing parent issue REEF-001");

    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Initial issue Alpha").click();
    await page.waitForURL(/\/issues\/REEF-001\?view=list/, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();
    await expect(page.locator('[data-testid="issue-children"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="issue-children-empty"]'),
    ).toContainText("No sub-issues yet.");

    await page.locator('[data-testid="add-sub-issue-trigger"]').click();
    const dialog = page.locator('[data-testid="new-issue-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("New sub-issue")).toBeVisible();
    await expect(
      dialog.locator('[data-testid="new-issue-parent-locked"]'),
    ).toContainText("REEF-001");
    await expect(
      dialog.locator('[data-testid="new-issue-priority-select"]'),
    ).toContainText("High");
    await expect(dialog.getByLabel("Sprint: Sprint Alpha")).toBeVisible();
    await expect(
      dialog.getByLabel("Milestone: Coverage Complete"),
    ).toBeVisible();

    await dialog
      .locator('[data-testid="new-issue-title-input"]')
      .fill("Child from sub-issue E2E");
    await dialog.locator('[data-testid="create-and-add-another"]').check();
    await dialog.locator('[data-testid="new-issue-submit"]').click();

    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return reefVault(state).issues.find(
          (issue) => issue.title === "Child from sub-issue E2E",
        );
      })
      .toMatchObject({
        id: "REEF-004",
        status: "todo",
        priority: parent.priority,
        parent_id: "REEF-001",
        sprint_id: parent.sprint_id,
        milestone_id: parent.milestone_id,
        labels: parent.labels,
      });

    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator('[data-testid="new-issue-title-input"]'),
    ).toHaveValue("");
    await expect(
      dialog.locator('[data-testid="new-issue-parent-locked"]'),
    ).toContainText("REEF-001");
    await expect(page).toHaveURL(
      /\/workspace\/reef-e2e\/issues\/REEF-001\?view=list$/,
    );

    await dialog.locator('[data-testid="new-issue-cancel"]').click();
    await page.locator('[data-testid="discard-draft-confirm-button"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-testid="issue-children"]')).toContainText(
      "Child from sub-issue E2E",
    );
    await expect(page.locator('[data-testid="issue-children"]')).toContainText(
      "0 of 1 done",
    );
  });

  test("copies the canonical issue deep link from the detail actions menu", async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openExistingWorkspace(page);

    // Open from the list so the address bar is the intercept route
    // (/issues/REEF-001?view=list), not this issue's own deep link — the copied
    // link must still be the clean canonical URL, not the address-bar value.
    await page.goto("/workspace/reef-e2e/issues?view=list");
    await page.getByText("Initial issue Alpha").click();
    await page.waitForURL(/\/issues\/REEF-001\?view=list/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    await page.locator('[data-testid="issue-more-trigger"]').click();
    await page.locator('[data-testid="issue-copy-link"]').click();

    // A success toast confirms the copy (locale-agnostic: assert the toast
    // surface, not its text).
    await expect(page.locator("[data-sonner-toast]")).toBeVisible();

    // The copied value is the clean canonical deep link — vault + id, with no
    // ?view=list riding along from the intercept URL in the address bar.
    const origin = new URL(page.url()).origin;
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`${origin}/workspace/reef-e2e/issues/REEF-001`);
  });
});
