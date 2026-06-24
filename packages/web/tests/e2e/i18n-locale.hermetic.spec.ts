import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readIndexedDbConfig,
  resetFixture,
} from "./harness/fixture";

test.describe("Hermetic i18n locale switch + persistence", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("defaults to English, switches to Korean, and persists across reload", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/settings/preferences");

    // Scope the language-section testid lookups to the VISIBLE region via its
    // accessible role/name. Next dev's warm-navigation transition can leave a
    // second, `hidden` copy of the settings subtree in the DOM (a dev-only
    // artifact, REEF-258), which a raw `getByTestId` would match alongside the
    // real one and trip strict mode. `getByRole("region")` queries the
    // accessibility tree, so the hidden duplicate is excluded.
    const langSection = page.getByRole("region", { name: "Language" });

    // AC1 — first paint (no locale cookie) is English: <html lang> and the
    // server-rendered language section heading are both en.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(langSection).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Language", level: 3 }),
    ).toBeVisible();
    await expect(langSection.getByTestId("locale-option-en")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // AC2 — switching to ko flips the UI immediately: <html lang> updates and the
    // heading re-renders from the ko catalog (proving the provider switched, AC3).
    await langSection.getByTestId("locale-option-ko").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByRole("heading", { name: "언어", level: 3 }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "언어" })
        .getByTestId("locale-option-ko"),
    ).toHaveAttribute("aria-checked", "true");

    // REEF-293 AC1 — the chrome follows the locale, not just the language
    // section: the persistent sidebar nav re-renders from the ko catalog
    // (landmark + the Issues link), proving the string migration switches live.
    const nav = page.getByRole("navigation", { name: "메인 내비게이션" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "이슈" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "새 이슈 (Cmd+N)" }),
    ).toBeVisible();

    // AC2 — persisted to both the Dexie config (canonical) and the readable
    // NEXT_LOCALE cookie (SSR mirror).
    await expect
      .poll(async () => readIndexedDbConfig(page, "locale"))
      .toBe("ko");
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "NEXT_LOCALE")?.value).toBe("ko");

    // AC2 — survives a reload: the server reads the cookie and renders ko on the
    // first paint, with no flash back to English.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByRole("heading", { name: "언어", level: 3 }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "언어" })
        .getByTestId("locale-option-ko"),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("renders core field labels in the active locale on the board (REEF-292)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    // Baseline: the board status columns render their English labels (the
    // workflow statuses are always present regardless of the issue set).
    await page.goto("/issues?view=board");
    await expect(
      page.locator('[data-testid="kanban-board"]').first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "Todo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "In Progress" }),
    ).toBeVisible();

    // Switch the interface to Korean through the real settings control.
    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The same status columns now render their Korean labels — the core key →
    // active-locale string lookup (REEF-292) resolving end to end through the
    // merged next-intl catalog (AC1), not a separate English map.
    await page.goto("/issues?view=board");
    await expect(
      page.locator('[data-testid="kanban-board"]').first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "할 일" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "진행 중" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "Todo" }),
    ).toHaveCount(0);

    // The single-selection filter chip summary localizes too (REEF-292): picking
    // one status shows its Korean label in the closed trigger, not the raw enum.
    await page.getByTestId("status-dropdown-trigger").click();
    await page.getByTestId("status-option-in_progress").click();
    await expect(page.getByTestId("status-dropdown-trigger")).toContainText(
      "진행 중",
    );
  });

  test("renders issue field-NAME labels in the active locale (REEF-301)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The issue detail rail's field-NAME headers now render in Korean — the word
    // that labels each field, resolved through the new `fields.name.*` catalog
    // (REEF-301). Before this work these stayed English ("Assignee", "Priority")
    // sitting above an already-localized value (the half-translated header the
    // story calls out, AC2). REEF-002 always renders the full property rail.
    await page.goto("/issues/REEF-002");
    const sidebar = page.getByTestId("issue-detail-sidebar");
    await expect(sidebar).toBeVisible();
    for (const koLabel of [
      "담당자", // Assignee
      "요청자", // Requester
      "보고자", // Reporter
      "우선순위", // Priority
      "심각도", // Severity
      "라벨", // Labels
      "기한", // Due
      "스프린트", // Sprint
      "마일스톤", // Milestone
      "릴리스", // Release
    ]) {
      await expect(sidebar.getByText(koLabel, { exact: true })).toBeVisible();
    }
    // No half-translated English field name lingers for a migrated field.
    await expect(sidebar.getByText("Assignee", { exact: true })).toHaveCount(0);

    // The issue filter bar localizes its facet field names too: the board's
    // status facet trigger reads the Korean field name from the same catalog
    // (REEF-301). The board renders a single filter bar (the list view renders a
    // responsive pair), so assert there.
    await page.goto("/issues?view=board");
    await expect(
      page.locator('[data-testid="kanban-board"]').first(),
    ).toBeVisible();
    await expect(page.getByTestId("status-dropdown-trigger")).toContainText(
      "상태",
    );
    await expect(page.getByTestId("priority-dropdown-trigger")).toContainText(
      "우선순위",
    );

    // Capture the localized rail as the REEF-301 visual proof.
    await page.goto("/issues/REEF-002");
    await expect(sidebar).toBeVisible();
    await sidebar.screenshot({
      path: "test-results/reef-301-field-names-ko.png",
    });
  });

  test("server error messages localize at the Route Handler boundary (REEF-297)", async ({
    page,
    request,
  }) => {
    type ErrorBody = { error: string };

    // (A) A web-boundary validation error (invalid issue id) is resolved before
    // any backend call, so it is fully deterministic. The SAME real route returns
    // en by default and Korean when the NEXT_LOCALE cookie is set — proving the
    // boundary reads the request locale from next/headers and localizes (AC1).
    const enInvalidId = await request.get(
      `/api/issues/not-a-valid-id?vault=${REEF_E2E_VAULT}`,
    );
    expect(enInvalidId.status()).toBe(400);
    expect(((await enInvalidId.json()) as ErrorBody).error).toBe(
      "Invalid issue id. Expected format: PREFIX-NUMBER.",
    );

    const koInvalidId = await request.get(
      `/api/issues/not-a-valid-id?vault=${REEF_E2E_VAULT}`,
      { headers: { cookie: "NEXT_LOCALE=ko" } },
    );
    expect(koInvalidId.status()).toBe(400);
    expect(((await koInvalidId.json()) as ErrorBody).error).toBe(
      "잘못된 이슈 ID입니다. 형식: PREFIX-NUMBER.",
    );

    // (B) An unauthenticated request to an akb-backed route surfaces the localized
    // session error through the real handler (en vs ko).
    const enAuth = await request.get(`/api/issues?vault=${REEF_E2E_VAULT}`);
    expect(enAuth.status()).toBe(401);
    expect(((await enAuth.json()) as ErrorBody).error).toBe(
      "Your session has expired. Please sign in again.",
    );

    const koAuth = await request.get(`/api/issues?vault=${REEF_E2E_VAULT}`, {
      headers: { cookie: "NEXT_LOCALE=ko" },
    });
    expect(koAuth.status()).toBe(401);
    expect(((await koAuth.json()) as ErrorBody).error).toBe(
      "세션이 만료되었습니다. 다시 로그인해 주세요.",
    );

    // (C) A CORE ReefError (NotFound) → describeError → web-localized copy
    // (AC2 + AC4): a logged-in request for a well-formed but non-existent issue
    // 404s as a core NotFoundError, and the boundary resolves its stable
    // `notFound.issue` code to Korean — core never built the message text.
    await openExistingWorkspace(page);
    await page
      .context()
      .addCookies([
        { name: "NEXT_LOCALE", value: "ko", url: new URL(page.url()).origin },
      ]);
    const koNotFound = await page.request.get(
      `/api/issues/REEF-99999?vault=${REEF_E2E_VAULT}`,
    );
    expect(koNotFound.status()).toBe(404);
    expect(((await koNotFound.json()) as ErrorBody).error).toBe(
      "이슈를 찾을 수 없습니다.",
    );

    // The same localized copy reaches the actual UI surface: the detail page for
    // a non-existent issue renders the server error verbatim (the client toast /
    // error state is a pass-through of `body.error`), so a Korean PM sees Korean.
    await page.goto("/issues/REEF-99999");
    await expect(page.getByTestId("issue-detail-error")).toContainText(
      "이슈를 찾을 수 없습니다.",
    );
  });

  test("renders migrated onboarding/auth/shared-component body strings in the active locale (REEF-307)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The persistent sidebar account control is auth-area chrome migrated in
    // REEF-307; its accessible name now resolves from the ko catalog.
    await expect(page.getByRole("button", { name: "계정 메뉴" })).toBeVisible();

    // The shared MarkdownEditor toolbar (components/) localizes too — on the
    // issue detail surface the Bold control's accessible name is Korean.
    await page.goto("/issues/REEF-002");
    await expect(page.getByTestId("issue-detail-sidebar")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "굵게" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold" })).toHaveCount(0);
  });

  test("renders migrated my-work + timeline body strings in the active locale (REEF-306)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The My Work page header is web-chrome copy migrated in REEF-306.
    await page.goto("/my-work");
    await expect(
      page.getByRole("heading", { name: "내 작업" }).first(),
    ).toBeVisible();

    // The timeline's month-year header now formats locale-aware (REEF-306 routes
    // the old hardcoded English month abbreviations through Intl), so a Korean
    // timeline reads "2026년 6월" instead of "Jun 2026".
    await page.goto("/issues?view=timeline");
    await expect(page.getByText(/\d{4}년 \d{1,2}월/).first()).toBeVisible();
    await expect(page.getByText(/^Jun \d{4}$/)).toHaveCount(0);
  });

  test("renders migrated activity + planning body strings in the active locale (REEF-305)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The activity feed's filter controls are web-chrome copy migrated in
    // REEF-305; they render regardless of the draft set, now from the ko catalog.
    await page.goto("/activity");
    await expect(
      page.getByRole("button", { name: "AI 초안" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "상태 변경" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "AI Drafts" })).toHaveCount(
      0,
    );

    // The planning page's kind toggle follows the locale too (REEF-305).
    await page.goto("/planning");
    await expect(
      page.getByRole("group", { name: "플래닝 종류" }),
    ).toBeVisible();
  });

  test("renders migrated reports-area body strings in the active locale (REEF-304)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The reports page's breakdown card titles are web-chrome copy migrated in
    // REEF-304 — they now resolve from the ko catalog. "Top assignees" is a
    // stable always-present card heading on the populated reports surface.
    await page.goto("/reports");
    await expect(
      page.getByText("주요 담당자", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Top assignees", { exact: true })).toHaveCount(
      0,
    );

    // Capture the localized reports surface as the REEF-304 visual proof.
    await page.screenshot({
      path: "test-results/reef-304-reports-ko.png",
      fullPage: true,
    });
  });

  test("renders migrated settings-area body strings in the active locale (REEF-303)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The preferences page's Appearance section is web-chrome copy migrated in
    // REEF-303 — it now renders from the ko catalog beside the already-localized
    // Language section.
    await expect(
      page.getByRole("heading", { name: "화면 표시", level: 3 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Appearance", level: 3 }),
    ).toHaveCount(0);

    // The workspace settings route's section sub-headings (Project / Templates /
    // Authoring Language / Completed Issues) follow the locale too — the App
    // Router server page resolves its copy through next-intl (REEF-303).
    await page.goto("/settings/workspace");
    for (const koHeading of [
      "프로젝트", // Project
      "템플릿", // Templates
      "작성 언어", // Authoring Language
      "완료된 이슈", // Completed Issues
    ]) {
      await expect(
        page.getByRole("heading", { name: koHeading, level: 3 }).first(),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("heading", { name: "Project", level: 3 }),
    ).toHaveCount(0);
  });

  test("renders migrated issue-area body strings in the active locale (REEF-302)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // The issue detail surface's section headers are web-chrome copy migrated in
    // REEF-302 (the shared `sections.*` namespace). Before this work they stayed
    // English ("Details"/"People"/"Planning"/"Relationships") above already
    // localized field rows — the half-translated screen REEF-298 calls out. They
    // now resolve from the merged ko catalog end to end. REEF-002 always renders
    // the full property rail + relationships section.
    await page.goto("/issues/REEF-002");
    const sidebar = page.getByTestId("issue-detail-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText("세부 정보", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("사람", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("플래닝", { exact: true })).toBeVisible();
    await expect(page.getByText("관계", { exact: true }).first()).toBeVisible();
    // No half-translated English section header lingers on the migrated surface.
    await expect(sidebar.getByText("Details", { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText("People", { exact: true })).toHaveCount(0);

    // Capture the localized issue body as the REEF-302 visual proof.
    await page.screenshot({
      path: "test-results/reef-302-issue-body-ko.png",
      fullPage: true,
    });
  });

  test("renders the issue-list column headers in the active locale (REEF-299)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    // The list view's column headers are hoisted into a `.ts` data structure the
    // hardcoded-string guard never scanned, so they stayed English even with a
    // locale selected. They now resolve through the shared core `fields.name`
    // catalog (extended with the list/enrichment field names in REEF-299).
    await page.goto("/issues?view=list");
    await expect(
      page.getByRole("columnheader", { name: "Title" }),
    ).toBeVisible();

    await page.goto("/settings/preferences");
    await page
      .getByRole("region", { name: "Language" })
      .getByTestId("locale-option-ko")
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");

    // Same headers, now Korean — the data-structure copy follows the locale end
    // to end (REEF-299, AC1/AC2).
    await page.goto("/issues?view=list");
    await expect(
      page.getByRole("columnheader", { name: "제목" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "우선순위" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "담당자" }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Title" })).toHaveCount(
      0,
    );
  });
});
