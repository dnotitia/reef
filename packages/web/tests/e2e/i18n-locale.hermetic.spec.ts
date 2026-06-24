import { expect, test } from "@playwright/test";
import {
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

    // AC1 — first paint (no locale cookie) is English: <html lang> and the
    // server-rendered language section heading are both en.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("language-section")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Language", level: 3 }),
    ).toBeVisible();
    await expect(page.getByTestId("locale-option-en")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // AC2 — switching to ko flips the UI immediately: <html lang> updates and the
    // heading re-renders from the ko catalog (proving the provider switched, AC3).
    await page.getByTestId("locale-option-ko").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(
      page.getByRole("heading", { name: "언어", level: 3 }),
    ).toBeVisible();
    await expect(page.getByTestId("locale-option-ko")).toHaveAttribute(
      "aria-checked",
      "true",
    );

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
    await expect(page.getByTestId("locale-option-ko")).toHaveAttribute(
      "aria-checked",
      "true",
    );
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
    await page.getByTestId("locale-option-ko").click();
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

    // Switch the interface to Korean through the real settings control.
    await page.goto("/settings/preferences");
    await page.getByTestId("locale-option-ko").click();
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
});
