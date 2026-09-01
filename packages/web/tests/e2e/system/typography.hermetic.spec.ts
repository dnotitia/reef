import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  openExistingWorkspace,
  resetFixture,
  REEF_E2E_VAULT,
} from "../harness/fixture";

type Locale = "en" | "ko";
type Theme = "light" | "dark";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow-desktop", width: 1024, height: 800 },
  { name: "narrow", width: 390, height: 844 },
] as const;

const ROLE = {
  pageTitle: { size: 20, weight: 600, lineHeight: 24, tracking: 0 },
  groupTitle: { size: 15, weight: 600, lineHeight: 20, tracking: 0 },
  sectionLabel: {
    size: 13,
    weight: 600,
    lineHeight: 16,
    tracking: 13 * 0.08,
  },
  body: { size: 14, weight: 500, lineHeight: 20, tracking: 0 },
  cardTitle: { size: 14, weight: 600, lineHeight: 20, tracking: 0 },
  caption: { size: 12, weight: 400, lineHeight: 16, tracking: 0 },
  monoValue: { size: 13, weight: 400, lineHeight: 20, tracking: 0 },
  chartLabel: { size: 12, weight: 400, lineHeight: 16, tracking: 0 },
} as const;

interface ComputedTypography {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | null;
  letterSpacing: number;
  fontVariantNumeric: string;
}

async function readTypography(locator: Locator): Promise<ComputedTypography> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const px = (value: string): number | null => {
      if (value === "normal") return null;
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      fontFamily: style.fontFamily,
      fontSize: px(style.fontSize) ?? 0,
      fontWeight: Number.parseInt(style.fontWeight, 10),
      lineHeight: px(style.lineHeight),
      letterSpacing: px(style.letterSpacing) ?? 0,
      fontVariantNumeric: style.fontVariantNumeric,
    };
  });
}

async function expectTypography(
  locator: Locator,
  expected: {
    size: number;
    weight?: number;
    lineHeight?: number;
    tracking?: number;
  },
  label: string,
): Promise<ComputedTypography> {
  await expect(locator, label).toBeVisible();
  await expect
    .poll(
      async () => {
        const typography = await readTypography(locator);
        return typography.fontSize > 0 && typography.lineHeight !== null;
      },
      { message: `${label} computed style is resolved` },
    )
    .toBe(true);
  const typography = await readTypography(locator);
  expect(typography.fontSize, `${label} font-size`).toBe(expected.size);
  if (expected.weight !== undefined) {
    expect(typography.fontWeight, `${label} font-weight`).toBe(expected.weight);
  }
  if (expected.lineHeight !== undefined) {
    expect(typography.lineHeight, `${label} line-height`).toBe(
      expected.lineHeight,
    );
  }
  if (expected.tracking !== undefined) {
    expect(
      Math.abs(typography.letterSpacing - expected.tracking),
      `${label} letter-spacing`,
    ).toBeLessThan(0.02);
  }
  return typography;
}

async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('14px "Noto Sans KR"', "한글 Reef 123");
  });
}

async function expectFontStacks(
  page: Page,
  label: string,
  monoLocator?: Locator,
): Promise<void> {
  const state = await page.evaluate(() => {
    const rootStyles = getComputedStyle(document.documentElement);
    const notoVariable = rootStyles
      .getPropertyValue("--font-noto-sans-kr")
      .trim();
    const bodyFontFamily = getComputedStyle(document.body).fontFamily;
    const loadedFamilies = Array.from(document.fonts)
      .filter((font) => font.status === "loaded")
      .map((font) => font.family);
    return {
      notoVariable,
      bodyFontFamily,
      loadedFamilies,
      notoLoaded: loadedFamilies.some((family) =>
        family.includes("Noto Sans KR"),
      ),
      notoCanRenderHangul: document.fonts.check('14px "Noto Sans KR"', "한글"),
    };
  });
  expect(state.notoVariable, `${label} Noto Sans KR variable`).toContain(
    "Noto Sans KR",
  );
  expect(state.bodyFontFamily, `${label} body font stack`).toContain("Inter");
  expect(state.bodyFontFamily, `${label} body Hangul fallback`).toContain(
    "Noto Sans KR",
  );
  expect(state.notoLoaded, `${label} Noto Sans KR loaded`).toBe(true);
  expect(state.notoCanRenderHangul, `${label} Noto Sans KR Hangul`).toBe(true);
  if (monoLocator) {
    const monoTypography = await readTypography(monoLocator);
    expect(monoTypography.fontFamily, `${label} mono Latin face`).toContain(
      "Geist Mono",
    );
    expect(
      monoTypography.fontFamily,
      `${label} mono Hangul fallback`,
    ).toContain("Noto Sans KR");
  }
}

async function expectContainedLayout(page: Page, label: string): Promise<void> {
  const geometry = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const header = document.querySelector<HTMLElement>(
      '[data-slot="page-header"]',
    );
    const actions = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-slot="page-header-actions"] button, [data-slot="page-header-actions"] a',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    return {
      viewportWidth,
      documentOverflow:
        document.documentElement.scrollWidth > viewportWidth + 1,
      headerLeft: header?.getBoundingClientRect().left ?? 0,
      headerRight: header?.getBoundingClientRect().right ?? viewportWidth,
      wrappedActions: actions.filter(
        (element) => element.getBoundingClientRect().height > 40,
      ).length,
      clippedActions: actions.filter(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
      ).length,
    };
  });

  expect(geometry.documentOverflow, `${label} document overflow`).toBe(false);
  expect(geometry.headerLeft, `${label} header left`).toBeGreaterThanOrEqual(
    -1,
  );
  expect(geometry.headerRight, `${label} header right`).toBeLessThanOrEqual(
    geometry.viewportWidth + 1,
  );
  expect(geometry.wrappedActions, `${label} wrapped actions`).toBe(0);
  expect(geometry.clippedActions, `${label} clipped actions`).toBe(0);
}

async function openRoute(page: Page, path: string): Promise<Locator> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const main = page.getByRole("main").first();
  await expect(main).toBeVisible();
  await settleFonts(page);
  return main;
}

async function choosePreferences(
  page: Page,
  locale: Locale,
  theme: Theme,
): Promise<void> {
  await openRoute(page, `/workspace/${REEF_E2E_VAULT}/settings/preferences`);

  const languageSection = page.locator(
    '[data-testid="language-section"]:visible',
  );
  await expect(languageSection).toBeVisible();
  await languageSection.getByTestId(`locale-option-${locale}`).click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);

  const appearanceSection = page.locator(
    '[data-testid="preferences-section"]:visible',
  );
  await appearanceSection.getByTestId(`theme-option-${theme}`).click();
  if (theme === "dark") {
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  } else {
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  }
  await settleFonts(page);
}

async function verifyIssues(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  const main = await openRoute(
    page,
    `/workspace/${REEF_E2E_VAULT}/issues?view=board`,
  );
  const pageTitle = page
    .locator('[data-slot="page-header"] h1:visible')
    .first();
  await expectTypography(
    pageTitle,
    ROLE.pageTitle,
    `${viewport.name} Issues page title`,
  );

  const card = page.getByTestId("kanban-card").first();
  await expect(card).toBeVisible();
  const cardTitle = card.locator("h4").first();
  await expectTypography(
    cardTitle,
    ROLE.cardTitle,
    `${viewport.name} Issues card title`,
  );
  const monoId = card
    .locator('[data-issue-update-field="status"] + span')
    .first();
  const monoTypography = await expectTypography(
    monoId,
    ROLE.monoValue,
    `${viewport.name} Issues identifier`,
  );
  expect(monoTypography.fontVariantNumeric).toContain("tabular-nums");
  await expectFontStacks(page, `${viewport.name} Issues`, monoId);
  await expectContainedLayout(page, `${viewport.name} Issues`);

  // The real table header exercises the same caption-floor contract on the
  // representative Issues collection surface.
  const listMain = await openRoute(
    page,
    `/workspace/${REEF_E2E_VAULT}/issues?view=list`,
  );
  const tableHeader = listMain
    .locator('th[data-column-key="title"]:visible')
    .first();
  await expectTypography(
    tableHeader,
    ROLE.sectionLabel,
    `${viewport.name} Issues table header`,
  );
  await expectContainedLayout(page, `${viewport.name} Issues list`);
}

async function verifyReports(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  const main = await openRoute(page, `/workspace/${REEF_E2E_VAULT}/reports`);
  const pageTitle = page
    .locator('[data-slot="page-header"] h1:visible')
    .first();
  await expectTypography(
    pageTitle,
    ROLE.pageTitle,
    `${viewport.name} Reports page title`,
  );

  await expectTypography(
    main.locator("h2:visible").first(),
    ROLE.sectionLabel,
    `${viewport.name} Reports section label`,
  );
  await expectTypography(
    page.getByTestId("report-card-flow-metrics").locator("h3:visible"),
    ROLE.cardTitle,
    `${viewport.name} Reports card title`,
  );
  await expectTypography(
    page.getByTestId("report-card-flow-metrics").locator("header > span"),
    ROLE.caption,
    `${viewport.name} Reports card caption`,
  );

  const chart = page.getByTestId("flow-metrics-chart");
  await expect(chart).toBeVisible();
  await expectTypography(
    chart.locator("text:visible").first(),
    ROLE.chartLabel,
    `${viewport.name} Reports chart label`,
  );
  await expectTypography(
    main.locator("th:visible").first(),
    ROLE.chartLabel,
    `${viewport.name} Reports table label`,
  );
  await expectFontStacks(
    page,
    `${viewport.name} Reports`,
    page.getByTestId("report-card-flow-metrics").locator("dd:visible").first(),
  );
  await expectContainedLayout(page, `${viewport.name} Reports`);
}

async function verifyPreferences(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  const main = await openRoute(
    page,
    `/workspace/${REEF_E2E_VAULT}/settings/preferences`,
  );
  const pageTitle = page
    .locator('[data-slot="page-header"] h1:visible')
    .first();
  await expectTypography(
    pageTitle,
    ROLE.pageTitle,
    `${viewport.name} Settings page title`,
  );
  const groupTitle = main
    .locator('[data-testid="settings-group-personal"] h2:visible')
    .first();
  await expectTypography(
    groupTitle,
    ROLE.groupTitle,
    `${viewport.name} Settings group title`,
  );
  await expectTypography(
    page.locator('[data-testid="preferences-section"]:visible h3'),
    ROLE.sectionLabel,
    `${viewport.name} Preferences section label`,
  );
  await expectTypography(
    page.locator('[data-testid="preferences-section"]:visible > header > p'),
    ROLE.caption,
    `${viewport.name} Preferences helper text`,
  );
  await expectTypography(
    page
      .locator('[data-testid="preferences-section"]:visible [role="radio"]')
      .first()
      .locator(":scope > span:first-child > span"),
    ROLE.body,
    `${viewport.name} Settings body label`,
  );
  await expectFontStacks(page, `${viewport.name} Settings`);
  await expectContainedLayout(page, `${viewport.name} Settings`);
}

async function verifyAdditionalSectionLabels(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  const workspaceMain = await openRoute(
    page,
    `/workspace/${REEF_E2E_VAULT}/settings/workspace`,
  );
  await expectTypography(
    workspaceMain.locator("h3:visible").first(),
    ROLE.sectionLabel,
    `${viewport.name} Workspace section label`,
  );

  const deploymentMain = await openRoute(
    page,
    `/workspace/${REEF_E2E_VAULT}/settings/deployment`,
  );
  await expectTypography(
    deploymentMain.locator("h3:visible").first(),
    ROLE.sectionLabel,
    `${viewport.name} Deployment section label`,
  );

  await openRoute(page, `/workspace/${REEF_E2E_VAULT}/issues/REEF-002`);
  const issueDetail = page.getByTestId("issue-detail");
  await expect(issueDetail).toBeVisible();
  await expectTypography(
    issueDetail
      .locator('[data-testid="issue-detail-sidebar"] h3:visible')
      .first(),
    ROLE.sectionLabel,
    `${viewport.name} Issue detail section label`,
  );
  const markdown = issueDetail.locator(".reef-markdown-editor:visible").first();
  await expect(markdown).toBeVisible();
  const markdownParagraph = markdown.locator(":scope > p").first();
  if (await markdownParagraph.count()) {
    await expectTypography(
      markdownParagraph,
      { size: 14, lineHeight: 22 },
      `${viewport.name} Markdown body rhythm`,
    );
  }
  await expectContainedLayout(page, `${viewport.name} Issue detail`);
}

test.describe("Hermetic typography role contract", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("keeps role hierarchy, fixed font fallback, and narrow-surface containment across locales and themes", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    for (const locale of ["en", "ko"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await choosePreferences(page, locale, theme);

        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          await verifyIssues(page, viewport);
          await verifyReports(page, viewport);
          await verifyPreferences(page, viewport);
        }

        // The remaining section-label owners are checked once per locale/theme
        // at the narrow desktop seam; all of them consume the same role.
        await page.setViewportSize(VIEWPORTS[1]);
        await verifyAdditionalSectionLabels(page, VIEWPORTS[1]);
      }
    }
  });
});
