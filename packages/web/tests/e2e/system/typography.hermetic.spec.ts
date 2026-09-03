import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  openExistingWorkspace,
  resetFixture,
  REEF_E2E_VAULT,
} from "../harness/fixture";
import historicalBaseline from "./typography-baseline.json";

type Locale = "en" | "ko";
type Theme = "light" | "dark";
type HistoricalRoleName = keyof typeof historicalBaseline.roles;
const CARD_BASELINE = historicalBaseline.cards;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow-desktop", width: 1024, height: 800 },
  { name: "narrow", width: 390, height: 844 },
] as const;

function historicalRole(name: HistoricalRoleName) {
  const role = historicalBaseline.roles[name];
  return {
    size: role.fontSize,
    weight: role.fontWeight,
    lineHeight: role.lineHeight,
    tracking: role.letterSpacing,
    textTransform: role.textTransform,
  };
}

const ROLE = {
  pageTitle: { size: 14, weight: 600, lineHeight: 21, tracking: -0.14 },
  groupTitle: { size: 15, weight: 600, lineHeight: 20, tracking: 0 },
  navigation: { size: 13, lineHeight: 19.5, tracking: 0 },
  control: { size: 13, lineHeight: 19.5, tracking: 0 },
  boardStatus: {
    size: 12,
    weight: 600,
    lineHeight: 16,
    tracking: 12 * 0.025,
    textTransform: "uppercase",
  },
  boardEpic: {
    size: 12,
    weight: 600,
    lineHeight: 16,
    tracking: 0,
    textTransform: "none",
  },
  sectionLabel: {
    size: 13,
    weight: 600,
    lineHeight: 16,
    tracking: 13 * 0.08,
    textTransform: "uppercase",
  },
  body: { size: 14, weight: 500, lineHeight: 20, tracking: 0 },
  cardTitle: {
    size: 13,
    weight: 500,
    lineHeight: 18.5625,
    tracking: 0,
  },
  cardMetadata: { size: 11, lineHeight: 16.5, tracking: 0 },
  cardContext: { size: 10.5, weight: 500, lineHeight: 16, tracking: 0 },
  compactMono: { size: 11, lineHeight: 16.5, tracking: 0 },
  detailSection: {
    size: 11,
    weight: 600,
    lineHeight: 16.5,
    tracking: 11 * 0.025,
    textTransform: "uppercase",
  },
  comment: { size: 13, weight: 400, lineHeight: 20, tracking: 0 },
  reportSection: {
    size: 11,
    weight: 500,
    lineHeight: 16.5,
    tracking: 11 * 0.08,
    textTransform: "uppercase",
  },
  tableHeader: historicalRole("tableHeader"),
  chartTick: { size: 10, weight: 400, lineHeight: 16, tracking: 0 },
  chartMetadata: { size: 11, weight: 400, lineHeight: 16.5, tracking: 0 },
  caption: { size: 12, weight: 400, lineHeight: 16, tracking: 0 },
  monoValue: { size: 13, weight: 400, lineHeight: 20, tracking: 0 },
  chartLabel: { size: 12, weight: 400, lineHeight: 16, tracking: 0 },
  listGroup: historicalRole("listGroupLabel"),
  listGroupCount: historicalRole("listGroupCount"),
  boardType: historicalRole("boardType"),
  detailType: historicalRole("detailType"),
  boardBlocked: historicalRole("boardBlocked"),
  listId: historicalRole("listId"),
  timelineGroup: historicalRole("timelineGroup"),
  timelineTitle: historicalRole("timelineTitle"),
  timelineMonth: historicalRole("timelineMonth"),
  timelineTick: historicalRole("timelineTick"),
  timelineAssignee: historicalRole("timelineAssignee"),
  reportRowLabel: historicalRole("reportRowLabel"),
  reportCell: historicalRole("reportCell"),
  reportHeader: historicalRole("reportHeader"),
  throughputTick: historicalRole("throughputTick"),
  snapshotLabel: historicalRole("snapshotLabel"),
  settingsDescription: historicalRole("settingsDescription"),
  settingsSection: historicalRole("settingsSection"),
  settingsGroup: historicalRole("settingsGroup"),
  themeDescription: historicalRole("themeDescription"),
  segmentedControl: historicalRole("segmentedControl"),
  smallButton: historicalRole("smallButton"),
  subissueProgress: historicalRole("subissueProgress"),
  dialogTitle: historicalRole("dialogTitle"),
} as const;

interface ComputedTypography {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | null;
  letterSpacing: number;
  fontVariantNumeric: string;
  textTransform: string;
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
      textTransform: style.textTransform,
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
    textTransform?: string;
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
  if (expected.textTransform !== undefined) {
    expect(typography.textTransform, `${label} text-transform`).toBe(
      expected.textTransform,
    );
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

async function expectSmallButton(
  locator: Locator,
  label: string,
): Promise<void> {
  await expectTypography(locator, ROLE.smallButton, label);
  await locator.focus();
  await expect(locator, `${label} focusability`).toBeFocused();
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(geometry.width, `${label} hit width`).toBeGreaterThanOrEqual(28);
  expect(geometry.height, `${label} hit height`).toBeGreaterThanOrEqual(28);
  expect(geometry.whiteSpace, `${label} one-line label`).toBe("nowrap");
  expect(
    geometry.scrollWidth,
    `${label} horizontal clipping`,
  ).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(
    geometry.scrollHeight,
    `${label} vertical clipping`,
  ).toBeLessThanOrEqual(geometry.clientHeight + 1);
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

async function prepareStableRegressionSurface(
  page: Page,
  locale: Locale,
  theme: Theme,
): Promise<void> {
  await openExistingWorkspace(page);
  await choosePreferences(page, locale, theme);
  await page.setViewportSize(VIEWPORTS[0]);
}

async function verifyIssues(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  locale: Locale,
  theme: Theme,
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
  const navigation = page.locator("aside nav a:visible").first();
  if (await navigation.count()) {
    await expectTypography(
      navigation,
      ROLE.navigation,
      `${viewport.name} sidebar navigation`,
    );
  }
  await expectSmallButton(
    page.getByTestId("new-issue-trigger"),
    `${viewport.name} New Issue control`,
  );
  await expectTypography(
    page.getByTestId("view-switcher-board"),
    ROLE.segmentedControl,
    `${viewport.name} View switcher control`,
  );
  await expectTypography(
    page.getByTestId("kanban-group-header").first().locator("h3"),
    ROLE.boardStatus,
    `${viewport.name} board status group`,
  );
  await expectTypography(
    card.locator('[data-issue-update-field="priority"]').locator(".."),
    ROLE.cardMetadata,
    `${viewport.name} card metadata`,
  );
  await expectTypography(
    card.locator('[data-typography-role="board-type"]'),
    ROLE.boardType,
    `${viewport.name} Kanban type pill`,
  );
  const planningContext = card.getByTestId("kanban-planning-context");
  if (await planningContext.count()) {
    await expectTypography(
      planningContext,
      ROLE.cardContext,
      `${viewport.name} card planning context`,
    );
  }
  const monoId = card
    .locator('[data-issue-update-field="status"] + span')
    .first();
  const monoTypography = await expectTypography(
    monoId,
    ROLE.compactMono,
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
    ROLE.tableHeader,
    `${viewport.name} Issues table header`,
  );
  const listId = listMain
    .locator('td[data-column-key="id"]:visible')
    .filter({ hasText: /REEF-/ })
    .first();
  const listIdTypography = await expectTypography(
    listId,
    ROLE.listId,
    `${viewport.name} List identifier`,
  );
  expect(listIdTypography.fontVariantNumeric).toContain("tabular-nums");
  await expectFontStacks(page, `${viewport.name} List`, listId);
  await expectTypography(
    listMain
      .locator('td[data-column-key="type"] [data-typography-role="list-type"]')
      .first(),
    ROLE.cardMetadata,
    `${viewport.name} List type pill`,
  );
  if (
    viewport.width === VIEWPORTS[0].width ||
    (viewport.width === VIEWPORTS[1].width &&
      locale === "ko" &&
      theme === "light")
  ) {
    const groups =
      viewport.width === VIEWPORTS[0].width
        ? (["status", "priority", "assignee", "sprint", "label"] as const)
        : (["priority"] as const);
    for (const group of groups) {
      const groupedMain = await openRoute(
        page,
        `/workspace/${REEF_E2E_VAULT}/issues?view=list&group=${group}`,
      );
      const groupLabels = groupedMain.getByTestId("issue-group-label");
      const groupLabel =
        group === "priority" && locale === "ko" && theme === "light"
          ? groupLabels.filter({ hasText: "높음" }).first()
          : groupLabels.first();
      await expectTypography(
        groupLabel,
        ROLE.listGroup,
        `${locale}/${theme} ${viewport.name} List ${group} group label`,
      );
      const groupCount = groupedMain.getByTestId("issue-group-count").first();
      const groupCountTypography = await expectTypography(
        groupCount,
        ROLE.listGroupCount,
        `${locale}/${theme} ${viewport.name} List ${group} group count`,
      );
      expect(groupCountTypography.fontVariantNumeric).toContain("tabular-nums");
    }

    if (viewport.width === VIEWPORTS[0].width) {
      const backlogMain = await openRoute(
        page,
        `/workspace/${REEF_E2E_VAULT}/issues?scope=backlog&view=list`,
      );
      await expectTypography(
        backlogMain.locator('[data-typography-role="list-group"]').first(),
        ROLE.listGroup,
        `${viewport.name} Backlog group label`,
      );
      const backlogCountTypography = await expectTypography(
        backlogMain
          .locator('[data-typography-role="list-group-count"]')
          .first(),
        ROLE.listGroupCount,
        `${viewport.name} Backlog group count`,
      );
      expect(backlogCountTypography.fontVariantNumeric).toContain(
        "tabular-nums",
      );
    }
  }
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
    ROLE.reportSection,
    `${viewport.name} Reports section label`,
  );
  await expectTypography(
    page.getByTestId("report-card-flow-metrics").locator("h3:visible"),
    { size: 14, weight: 600, lineHeight: 20, tracking: 0 },
    `${viewport.name} Reports card title`,
  );
  await expectTypography(
    page.getByTestId("report-card-flow-metrics").locator("header > span"),
    ROLE.cardMetadata,
    `${viewport.name} Reports card caption`,
  );

  const chart = page.getByTestId("flow-metrics-chart");
  await expect(chart).toBeVisible();
  await expectTypography(
    chart.locator("text:visible").first(),
    ROLE.chartTick,
    `${viewport.name} Reports chart label`,
  );
  await expectTypography(
    main.locator('th[data-typography-role="report-header"]:visible').first(),
    ROLE.reportHeader,
    `${viewport.name} Reports Risk map header`,
  );
  await expectTypography(
    main.locator('[data-typography-role="report-row-label"]:visible').first(),
    ROLE.reportRowLabel,
    `${viewport.name} Reports Risk map row label`,
  );
  const riskCell = main
    .locator('[data-typography-role="report-cell"]:visible')
    .filter({ hasText: /^1$/ })
    .first();
  const riskCellTypography = await expectTypography(
    riskCell,
    ROLE.reportCell,
    `${viewport.name} Reports Risk map cell`,
  );
  expect(riskCellTypography.fontVariantNumeric).toContain("tabular-nums");
  await expectTypography(
    main.locator('[data-typography-role="snapshot-label"]:visible').first(),
    ROLE.snapshotLabel,
    `${viewport.name} Reports Snapshot label`,
  );
  const throughputTick = main
    .getByTestId("throughput-chart")
    .locator('[data-typography-role="throughput-tick"]')
    .first();
  await expectTypography(
    throughputTick,
    ROLE.throughputTick,
    `${viewport.name} Reports Throughput date tick`,
  );
  await expectFontStacks(
    page,
    `${viewport.name} Reports`,
    page.getByTestId("report-card-flow-metrics").locator("dd:visible").first(),
  );
  await expectContainedLayout(page, `${viewport.name} Reports`);
}

async function verifyTimeline(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  const main = await openRoute(
    page,
    `/workspace/${REEF_E2E_VAULT}/issues?view=timeline`,
  );
  const grid = main.getByTestId("timeline-grid");
  await expect(grid).toBeVisible();
  await expectTypography(
    grid.locator('[data-typography-role="timeline-group"]').first(),
    ROLE.timelineGroup,
    `${viewport.name} Timeline status group`,
  );
  const timelineTitle = grid
    .locator('[data-typography-role="timeline-title"]')
    .first();
  await expectTypography(
    timelineTitle,
    ROLE.timelineTitle,
    `${viewport.name} Timeline issue title`,
  );
  const titleGeometry = await timelineTitle.evaluate((element) => {
    const titleRect = element.getBoundingClientRect();
    const container = element.closest("button") ?? element.parentElement;
    const containerRect = container?.getBoundingClientRect();
    return {
      titleWidth: titleRect.width,
      titleLeft: titleRect.left,
      titleRight: titleRect.right,
      clientWidth: element.clientWidth,
      containerLeft: containerRect?.left ?? titleRect.left,
      containerRight: containerRect?.right ?? titleRect.right,
    };
  });
  expect(
    titleGeometry.titleWidth,
    `${viewport.name} Timeline title width`,
  ).toBeGreaterThan(0);
  expect(
    Math.abs(titleGeometry.titleWidth - titleGeometry.clientWidth),
    `${viewport.name} Timeline title available width`,
  ).toBeLessThanOrEqual(1);
  expect(
    titleGeometry.titleLeft,
    `${viewport.name} Timeline title left`,
  ).toBeGreaterThanOrEqual(titleGeometry.containerLeft - 1);
  expect(
    titleGeometry.titleRight,
    `${viewport.name} Timeline title right`,
  ).toBeLessThanOrEqual(titleGeometry.containerRight + 1);
  await expectTypography(
    grid.locator('[data-typography-role="timeline-month"]').first(),
    ROLE.timelineMonth,
    `${viewport.name} Timeline month`,
  );
  await expectTypography(
    grid
      .locator('[data-typography-role="timeline-tick"]')
      .filter({ hasText: /\d/ })
      .first(),
    ROLE.timelineTick,
    `${viewport.name} Timeline date tick`,
  );
  await expectTypography(
    grid.locator('[data-typography-role="timeline-assignee"]').first(),
    ROLE.timelineAssignee,
    `${viewport.name} Timeline assignee`,
  );
  await expectContainedLayout(page, `${viewport.name} Timeline`);
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
    ROLE.settingsGroup,
    `${viewport.name} Settings group title`,
  );
  await expectTypography(
    main.locator('[data-testid="settings-group-personal"] > div > p'),
    ROLE.settingsDescription,
    `${viewport.name} Settings group description`,
  );
  await expectTypography(
    page.locator('[data-testid="preferences-section"]:visible h3'),
    ROLE.settingsSection,
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
    ROLE.control,
    `${viewport.name} Settings body label`,
  );
  await expectTypography(
    page.locator('[data-testid="theme-option-light"]:visible > span').last(),
    ROLE.themeDescription,
    `${viewport.name} Theme card description`,
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
    workspaceMain.locator('[data-testid="active-workspace-section"] h2'),
    ROLE.settingsGroup,
    `${viewport.name} Active Workspace heading`,
  );
  await expectTypography(
    workspaceMain.locator('[data-testid="settings-group-workspace"] h2'),
    ROLE.settingsGroup,
    `${viewport.name} Workspace settings group title`,
  );
  await expectTypography(
    workspaceMain.locator('[data-testid="settings-group-workspace"] > div > p'),
    ROLE.settingsDescription,
    `${viewport.name} Workspace settings group description`,
  );
  await expectTypography(
    workspaceMain.locator("h3:visible").first(),
    ROLE.settingsSection,
    `${viewport.name} Workspace section label`,
  );

  const deploymentMain = await openRoute(
    page,
    `/workspace/${REEF_E2E_VAULT}/settings/deployment`,
  );
  await expectTypography(
    deploymentMain.locator("h3:visible").first(),
    ROLE.settingsSection,
    `${viewport.name} Deployment section label`,
  );

  const detailViewport = viewport.width >= 1280 ? viewport : VIEWPORTS[0];
  await page.setViewportSize(detailViewport);
  await openRoute(page, `/workspace/${REEF_E2E_VAULT}/issues/REEF-001`);
  const issueDetail = page.getByTestId("issue-detail");
  await expect(issueDetail).toBeVisible();
  await expectTypography(
    issueDetail
      .locator('[data-testid="issue-detail-sidebar"] h3:visible')
      .first(),
    ROLE.detailSection,
    `${detailViewport.name} Issue detail section label`,
  );
  await expectTypography(
    page.locator('[data-typography-role="detail-type"]:visible').first(),
    ROLE.detailType,
    `${detailViewport.name} Issue detail type pill`,
  );
  const markdown = issueDetail.locator(".reef-markdown-editor:visible").first();
  await expect(markdown).toBeVisible();
  const markdownParagraph = markdown.locator(":scope > p").first();
  if (await markdownParagraph.count()) {
    await expectTypography(
      markdownParagraph,
      { size: 14, lineHeight: 22 },
      `${detailViewport.name} Markdown body rhythm`,
    );
  }
  await expectTypography(
    issueDetail.getByTestId("issue-type-select"),
    ROLE.control,
    `${detailViewport.name} Issue detail select`,
  );
  await expectTypography(
    issueDetail.getByTestId("issue-title-input"),
    ROLE.control,
    `${detailViewport.name} Issue detail input`,
  );
  await expectTypography(
    issueDetail.locator('textarea[name="comment"]'),
    ROLE.comment,
    `${detailViewport.name} Comment input`,
  );
  const updatedAt = issueDetail.locator('[data-testid="issue-updated-at"]');
  if (await updatedAt.count()) {
    await expectTypography(
      updatedAt,
      ROLE.compactMono,
      `${detailViewport.name} Issue detail activity time`,
    );
  }
  const commentSurface = issueDetail.locator(".reef-markdown-comment:visible");
  if (await commentSurface.count()) {
    await expectTypography(
      commentSurface.first(),
      ROLE.comment,
      `${detailViewport.name} Comment projection`,
    );
  }
  await expectContainedLayout(page, `${detailViewport.name} Issue detail`);

  await page.getByTestId("issue-close").click();
  await expect(issueDetail).toBeHidden();
  await page.getByTestId("new-issue-trigger").click();
  const newIssueDialog = page.getByTestId("new-issue-dialog");
  await expect(newIssueDialog).toBeVisible();
  await expectTypography(
    newIssueDialog.locator('[data-slot="dialog-title"]'),
    ROLE.dialogTitle,
    `${detailViewport.name} New Issue dialog title`,
  );
  await expectSmallButton(
    newIssueDialog.getByTestId("new-issue-submit"),
    `${detailViewport.name} New Issue small button`,
  );
  await newIssueDialog.getByTestId("new-issue-cancel").click();
  await expect(newIssueDialog).toBeHidden();
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
          await verifyIssues(page, viewport, locale, theme);
          if (viewport.width >= VIEWPORTS[1].width) {
            await verifyTimeline(page, viewport);
          }
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

  // These regression checks deliberately use selectors that already existed
  // at the prechange head, so a missing new data marker cannot masquerade as
  // style evidence when the same contract runs against both products.
  test("stable historical regression keeps the English High list group", async ({
    page,
  }) => {
    await prepareStableRegressionSurface(page, "en", "dark");
    const main = await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues?view=list&group=priority`,
    );
    await expectTypography(
      main.getByTestId("issue-group-label").filter({ hasText: "High" }).first(),
      ROLE.listGroup,
      "Stable English High list group",
    );
  });

  test("stable historical regression keeps the Korean 높음 list group at 1024px", async ({
    page,
  }) => {
    await prepareStableRegressionSurface(page, "ko", "light");
    await page.setViewportSize(VIEWPORTS[1]);
    const main = await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues?view=list&group=priority`,
    );
    await expectTypography(
      main.getByTestId("issue-group-label").filter({ hasText: "높음" }).first(),
      ROLE.listGroup,
      "Stable Korean 높음 list group at 1024px",
    );
  });

  test("stable historical regression keeps the Kanban blocked chip", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await prepareStableRegressionSurface(page, "en", "dark");
    const main = await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues?view=board`,
    );
    const blockedCard = main
      .getByTestId("kanban-card")
      .filter({ hasText: "Blocked" })
      .first();
    await expectTypography(
      blockedCard.getByText("Blocked", { exact: true }),
      ROLE.boardBlocked,
      "Stable Kanban blocked chip",
    );
  });

  test("stable historical regression keeps the List ID", async ({ page }) => {
    await prepareStableRegressionSurface(page, "en", "dark");
    const main = await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues?view=list`,
    );
    const listId = main
      .locator('td[data-column-key="id"]:visible')
      .filter({ hasText: /REEF-/ })
      .first();
    const typography = await expectTypography(
      listId,
      ROLE.listId,
      "Stable List ID",
    );
    expect(typography.fontVariantNumeric).toContain("tabular-nums");
    await expectFontStacks(page, "Stable List ID", listId);
  });

  test("stable historical regression keeps the Timeline title", async ({
    page,
  }) => {
    await prepareStableRegressionSurface(page, "en", "dark");
    const main = await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues?view=timeline`,
    );
    await page.getByRole("button", { name: "Previous quarter" }).click();
    const title = main
      .getByText("Initial issue Alpha", { exact: true })
      .first();
    await expectTypography(title, ROLE.timelineTitle, "Stable Timeline title");
  });

  test("stable historical regression keeps the Reports Risk row", async ({
    page,
  }) => {
    await prepareStableRegressionSurface(page, "en", "dark");
    const main = await openRoute(page, `/workspace/${REEF_E2E_VAULT}/reports`);
    await expectTypography(
      main.locator('th[scope="row"]:visible').first(),
      ROLE.reportRowLabel,
      "Stable Reports Risk row",
    );
  });

  test("keeps Epic groups title-case instead of inheriting the status grammar", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "epic_grouping");
    await openExistingWorkspace(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues?view=board&group=epic`,
    );

    const epicHeader = page
      .getByTestId("epic-group-header")
      .first()
      .locator("h3");
    await expectTypography(epicHeader, ROLE.boardEpic, "Epic group header");
    const boardEpicId = epicHeader.locator(".type-compact-mono").first();
    await expectTypography(boardEpicId, ROLE.compactMono, "Board Epic ID");
    await expectFontStacks(page, "Board Epic", boardEpicId);
    await expectTypography(
      epicHeader.locator('[title="Platform foundation"]'),
      ROLE.boardEpic,
      "Board Epic title",
    );

    const epicList = await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues?view=list&group=epic`,
    );
    const epicListHeader = epicList.locator(
      '[data-testid="issue-group-header"][data-group-id="epic:REEF-100"]',
    );
    await expectTypography(
      epicListHeader.getByTestId("issue-group-title"),
      ROLE.listGroup,
      "Epic List group title",
    );
    const listEpicId = epicListHeader.locator(".type-compact-mono").first();
    await expectTypography(listEpicId, ROLE.compactMono, "Epic List ID");
    await expectFontStacks(page, "Epic List", listEpicId);
    await expectTypography(
      epicListHeader.getByTestId("issue-group-count"),
      ROLE.listGroupCount,
      "Epic List group count",
    );
  });

  test("keeps the Kanban Blocked badge on its historical compact role", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await openRoute(page, `/workspace/${REEF_E2E_VAULT}/issues?view=board`);
    const blockedCard = page
      .getByTestId("kanban-card")
      .filter({ hasText: "Blocked" })
      .first();
    await expectTypography(
      blockedCard.getByText("Blocked", { exact: true }),
      ROLE.boardBlocked,
      "Kanban blocked badge",
    );
  });

  test("keeps detail sub-issue progress on its historical body role", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await openExistingWorkspace(page);
    await page.setViewportSize(VIEWPORTS[0]);
    const issueDetail = await openRoute(
      page,
      `/workspace/${REEF_E2E_VAULT}/issues/REEF-101`,
    );
    await expectTypography(
      issueDetail
        .getByTestId("issue-children")
        .locator('[data-typography-role="subissue-progress"]:visible')
        .first(),
      ROLE.subissueProgress,
      "Issue detail sub-issue progress",
    );
  });

  test("keeps the representative 79-card board dense across mixed-script titles", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "typography");
    await openExistingWorkspace(page);
    await page.setViewportSize(VIEWPORTS[0]);
    await openRoute(page, `/workspace/${REEF_E2E_VAULT}/issues?view=board`);

    const cards = page.getByTestId("kanban-card");
    await expect
      .poll(() => cards.count(), {
        message: "all representative board cards are rendered",
      })
      .toBe(79);
    await expect(page.getByText(/한글 제목/).first()).toBeVisible();
    await expect(page.getByText(/English title/).first()).toBeVisible();
    await expect(page.getByText(/Mixed 제목/).first()).toBeVisible();

    const geometry = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const title = element.querySelector<HTMLElement>("h4");
        const lineHeight = title
          ? Number.parseFloat(getComputedStyle(title).lineHeight)
          : 0;
        return {
          id: element.getAttribute("data-issue-id"),
          height:
            Math.round(element.getBoundingClientRect().height * 100) / 100,
          titleLines:
            title && lineHeight > 0
              ? Math.round(title.scrollHeight / lineHeight)
              : 0,
        };
      }),
    );

    expect(geometry).toHaveLength(CARD_BASELINE.count);
    const cardIds = geometry.map((actual) => {
      if (!actual.id) {
        throw new Error("typography card is missing its issue id");
      }
      return actual.id;
    });
    const expectedCardIds = Array.from(
      { length: CARD_BASELINE.count },
      (_, index) => `REEF-${String(index + 1).padStart(3, "0")}`,
    );
    expect(new Set(cardIds).size, "representative card IDs").toBe(
      CARD_BASELINE.count,
    );
    expect([...cardIds].sort(), "representative card IDs").toEqual(
      expectedCardIds,
    );
    const deltas = geometry.map((actual) => ({
      heightDelta: actual.height - CARD_BASELINE.geometry.height,
      titleLines: actual.titleLines,
      expectedTitleLines: CARD_BASELINE.geometry.titleLines,
    }));
    const sortedDeltas = deltas
      .map(({ heightDelta }) => heightDelta)
      .sort((left, right) => left - right);
    const medianDelta = sortedDeltas[Math.floor(sortedDeltas.length / 2)] ?? 0;
    expect(Math.abs(medianDelta)).toBeLessThanOrEqual(1);
    expect(
      deltas.filter(({ heightDelta }) => Math.abs(heightDelta) <= 1).length,
    ).toBeGreaterThanOrEqual(78);
    expect(
      deltas.filter(({ heightDelta }) => Math.abs(heightDelta) > 5),
    ).toHaveLength(0);
    expect(
      deltas.filter(
        ({ titleLines, expectedTitleLines }) =>
          titleLines !== expectedTitleLines,
      ),
    ).toHaveLength(0);
  });
});
