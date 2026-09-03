import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setIssueListFailure,
  setPlanningCatalogFailure,
} from "../harness/fixture";
import { expectCursorAtPointer } from "../harness/cursor";

async function copySelection(page: Page, locator: Locator): Promise<void> {
  const selectedText = await locator.evaluate((element) => {
    const selection = window.getSelection();
    if (!selection) throw new Error("Browser selection API is unavailable");
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selectedText.trim()).not.toBe("");
  await page.evaluate(() => {
    const browserWindow = window as Window & {
      __reefCopySelection?: string | null;
    };
    browserWindow.__reefCopySelection = null;
    document.addEventListener(
      "copy",
      () => {
        browserWindow.__reefCopySelection =
          window.getSelection()?.toString() ?? "";
      },
      { once: true },
    );
  });
  const copySucceeded = await page.evaluate(() => document.execCommand("copy"));
  expect(copySucceeded).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __reefCopySelection?: string | null })
            .__reefCopySelection,
      ),
    )
    .toBe(selectedText);
}

function sprintNames(
  state: Awaited<ReturnType<typeof readFixtureState>>,
): string[] {
  return (
    state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)?.sprints ?? []
  ).map((sprint) => sprint.name);
}

const planningKinds = [
  { tab: "Sprints", singular: "sprint", row: "Sprint Alpha" },
  {
    tab: "Milestones",
    singular: "milestone",
    row: "Coverage Complete",
  },
  { tab: "Releases", singular: "release", row: "June E2E" },
] as const;

async function readEditorGeometry(page: Page) {
  const dialog = page.locator('[data-testid="planning-editor-dialog"]');
  return dialog.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(
      '[data-testid="planning-editor-dialog-header"]',
    );
    const body = element.querySelector<HTMLElement>(
      '[data-testid="planning-editor-dialog-body"]',
    );
    const footer = element.querySelector<HTMLElement>(
      '[data-testid="planning-editor-dialog-footer"]',
    );
    if (!header || !body || !footer) {
      throw new Error("Planning editor chrome is incomplete");
    }

    const rect = (node: HTMLElement) => {
      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
      };
    };

    return {
      dialog: rect(element as HTMLElement),
      header: rect(header),
      body: {
        ...rect(body),
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        scrollTop: body.scrollTop,
      },
      footer: rect(footer),
      dialogScrollTop: element.scrollTop,
    };
  });
}

async function expectEditorChromeInViewport(page: Page, title: string) {
  const dialog = page.locator('[data-testid="planning-editor-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();

  const geometry = await readEditorGeometry(page);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(geometry.dialog.top).toBeGreaterThanOrEqual(0);
  expect(geometry.dialog.bottom).toBeLessThanOrEqual(viewport?.height ?? 0);
  expect(geometry.header.top).toBeGreaterThanOrEqual(geometry.dialog.top);
  expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.dialog.bottom);
}

async function expectEditorBodyToOwnScroll(page: Page) {
  const dialog = page.locator('[data-testid="planning-editor-dialog"]');
  const body = dialog.getByTestId("planning-editor-dialog-body");
  const initial = await readEditorGeometry(page);
  expect(initial.body.scrollHeight).toBeGreaterThan(initial.body.clientHeight);

  for (const fraction of [0, 0.5, 1]) {
    await body.evaluate((element, position: number) => {
      element.scrollTop =
        (element.scrollHeight - element.clientHeight) * position;
    }, fraction);
    await expect
      .poll(() => body.evaluate((element) => element.scrollTop))
      .toBeGreaterThanOrEqual(fraction === 0 ? 0 : 1);

    const current = await readEditorGeometry(page);
    expect(current.dialogScrollTop).toBe(0);
    expect(current.header.top).toBeCloseTo(initial.header.top, 1);
    expect(current.footer.bottom).toBeCloseTo(initial.footer.bottom, 1);
  }
}

async function expectNotesControlsAccessible(page: Page) {
  const editor = page.getByTestId("markdown-editor");
  await expect(editor).toBeVisible();
  const toolbar = editor.getByTestId("markdown-toolbar");
  for (const label of [
    "Bold",
    "Italic",
    "Strikethrough",
    "Inline Code",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Bullet List",
    "Numbered List",
    "Quote",
    "Code Block",
    "Divider",
    "Link",
    "Source",
  ]) {
    await expect(toolbar.getByRole("button", { name: label })).toBeVisible();
  }

  const toolbarButtons = toolbar.getByRole("button");
  await expect(toolbarButtons).toHaveCount(14);
  await toolbarButtons.first().focus();
  for (let index = 0; index < 14; index += 1) {
    await expect(toolbarButtons.nth(index)).toBeFocused();
    if (index < 13) await page.keyboard.press("Tab");
  }

  await toolbar.getByRole("button", { name: "Source" }).click();
  const source = editor.getByTestId("markdown-source-textarea");
  await expect(source).toBeVisible();
  await source.fill(
    Array.from({ length: 40 }, (_, index) => `Planning note ${index + 1}`).join(
      "\n",
    ),
  );
  await toolbar.getByRole("button", { name: "Source" }).click();
  await expect(editor.locator('[contenteditable="true"]')).toBeVisible();
}

async function cumulativeLayoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let value = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              hadRecentInput: boolean;
              value: number;
            };
            if (!shift.hadRecentInput) value += shift.value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(value);
        }, 300);
      }),
  );
}

test.describe("Hermetic planning workflow", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("creates, updates, and deletes a sprint through /api/planning Route Handlers", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/planning");

    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
    await expect(page.getByText("Sprint Alpha")).toBeVisible();

    await page.getByRole("button", { name: "New sprint" }).click();
    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeVisible();
    await page
      .locator('[data-testid="planning-name-input"]')
      .fill("E2E Sprint");
    await page.locator('[data-testid="planning-save"]').click();

    await expect(
      page.locator('[data-testid="planning-editor-dialog"]'),
    ).toBeHidden();
    await expect(page.getByText("E2E Sprint")).toBeVisible();
    await expect
      .poll(async () => sprintNames(await readFixtureState(request)))
      .toContain("E2E Sprint");

    await page.getByRole("button", { name: "Edit E2E Sprint" }).click();
    await page
      .locator('[data-testid="planning-name-input"]')
      .fill("E2E Sprint Edited");
    await page.locator('[data-testid="planning-save"]').click();

    await expect(page.getByText("E2E Sprint Edited")).toBeVisible();
    await expect
      .poll(async () => sprintNames(await readFixtureState(request)))
      .toContain("E2E Sprint Edited");

    await page
      .getByRole("button", { name: "Delete E2E Sprint Edited" })
      .click();
    await expect(
      page.locator('[data-testid="planning-delete-confirm"]'),
    ).toBeVisible();
    await page.locator('[data-testid="planning-delete-confirm-btn"]').click();

    await expect(
      page.locator('[data-testid="planning-delete-confirm"]'),
    ).toBeHidden();
    await expect
      .poll(async () => sprintNames(await readFixtureState(request)))
      .not.toContain("E2E Sprint Edited");
  });

  test("keeps planning editor chrome visible while the form body scrolls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/planning");

    for (const [index, planningKind] of planningKinds.entries()) {
      if (index > 0) {
        await page.getByRole("button", { name: planningKind.tab }).click();
        await expect(page.getByText(planningKind.row)).toBeVisible();
      }

      await page
        .getByRole("button", { name: `New ${planningKind.singular}` })
        .click();
      await expectEditorChromeInViewport(page, `New ${planningKind.singular}`);
      await expectEditorBodyToOwnScroll(page);
      await expectNotesControlsAccessible(page);
      await page
        .locator('[data-testid="planning-editor-dialog"]')
        .getByRole("button", { name: "Cancel" })
        .click();
      await expect(
        page.locator('[data-testid="planning-editor-dialog"]'),
      ).toBeHidden();
    }

    for (const planningKind of planningKinds) {
      await page.getByRole("button", { name: planningKind.tab }).click();
      await expect(page.getByText(planningKind.row)).toBeVisible();

      await page
        .getByRole("button", { name: `Edit ${planningKind.row}` })
        .click();
      await expectEditorChromeInViewport(page, `Edit ${planningKind.singular}`);
      await page
        .locator('[data-testid="planning-editor-dialog"]')
        .getByRole("button", { name: "Cancel" })
        .click();
      await expect(
        page.locator('[data-testid="planning-editor-dialog"]'),
      ).toBeHidden();
    }
  });

  test("reflows planning actions without horizontal overflow on a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/planning");
    await page.getByRole("button", { name: "New sprint" }).click();

    await expectEditorChromeInViewport(page, "New sprint");
    const dialog = page.locator('[data-testid="planning-editor-dialog"]');
    const footer = dialog.getByTestId("planning-editor-dialog-footer");
    const buttons = footer.getByRole("button");
    await expect(buttons).toHaveCount(2);
    await expect
      .poll(() =>
        page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        })),
      )
      .toEqual({ documentWidth: 390, viewportWidth: 390 });
    const widths = await dialog.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);

    const cancel = buttons.nth(0);
    const save = buttons.nth(1);
    const [cancelBox, saveBox] = await Promise.all([
      cancel.boundingBox(),
      save.boundingBox(),
    ]);
    expect(cancelBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(cancelBox?.y ?? 0).toBeLessThanOrEqual(saveBox?.y ?? 0);

    await cancel.focus();
    await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
  });

  test("keeps the sprint detail anchor beside its keyboard-operable goal toggle", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/planning");
    await expect(page.getByText("Sprint Alpha")).toBeVisible();

    // The expanded detail panel is absent while collapsed.
    const panel = page.locator('[id^="planning-detail-"]');
    await expect(panel).toHaveCount(0);

    // The sprint name is the dedicated-detail anchor; its adjacent disclosure
    // button owns the inline goal preview.
    const sprintLink = page.getByRole("link", {
      name: "Open Sprint Alpha sprint details",
    });
    await expect(sprintLink).toHaveAttribute(
      "href",
      /\/workspace\/reef-e2e\/planning\/sprints\//u,
    );
    await page
      .getByRole("button", { name: "Expand Sprint Alpha details" })
      .click();
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Collapse Sprint Alpha details" }),
    ).toHaveAttribute("aria-expanded", "true");

    // Clicking the disclosure again collapses it.
    await page
      .getByRole("button", { name: "Collapse Sprint Alpha details" })
      .click();
    await expect(panel).toHaveCount(0);

    // AC5: the merged toggle is keyboard-operable via Enter and Space.
    await page
      .getByRole("button", { name: "Expand Sprint Alpha details" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await page.keyboard.press(" ");
    await expect(panel).toHaveCount(0);
  });

  test("keeps normal and read-only planning content selectable and copyable", async ({
    context,
    page,
  }) => {
    await openExistingWorkspace(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    await page.goto("/workspace/reef-e2e/planning");

    const summary = page.getByText("Finish the hermetic E2E spine.", {
      exact: true,
    });
    await expect(summary).toBeVisible();
    await expectCursorAtPointer(summary, "auto");
    await copySelection(page, summary);

    await page
      .getByRole("button", { name: "Expand Sprint Alpha details" })
      .click();
    const panel = page.locator('[id^="planning-detail-"]').first();
    const editor = panel.getByTestId("markdown-editor");
    const readOnlyContent = editor.locator('[contenteditable="false"]');
    await expect(readOnlyContent).toBeVisible();
    await expectCursorAtPointer(readOnlyContent, "auto");
    await copySelection(page, readOnlyContent);
  });

  test("separates catalog failure from the true empty state and converges after retry", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await setPlanningCatalogFailure(request, true);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);

    const error = page.getByTestId("planning-catalog-error");
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error.getByText("Couldn't load planning.")).toBeVisible();
    await expect(page.getByTestId("planning-empty-sprints")).toHaveCount(0);

    await setPlanningCatalogFailure(request, false);
    await error.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByText("Sprint Alpha")).toBeVisible();
    await expect(error).toHaveCount(0);
  });

  test("keeps linked-issue aggregation and delete fail-closed until issue retry succeeds", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await setIssueListFailure(request, true);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);

    const row = page.getByText("Sprint Alpha").locator("xpath=ancestor::tr");
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("planning-issue-error")).toBeVisible();
    await expect(row.getByText("Unable to verify")).toBeVisible();

    const deleteButton = row.getByRole("button", {
      name: "Delete Sprint Alpha",
    });
    await expect(deleteButton).toHaveAttribute("aria-disabled", "true");
    await expectCursorAtPointer(deleteButton, "not-allowed");
    await expect(deleteButton).toHaveAttribute(
      "title",
      "Can't delete while linked issues can't be verified",
    );
    await expect(deleteButton).toHaveAttribute("aria-describedby", /.+/u);
    await expect(deleteButton).not.toHaveAttribute("disabled");
    await deleteButton.click({ force: true });
    await deleteButton.focus();
    await expect(deleteButton).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press(" ");
    await expect(page.getByTestId("planning-delete-confirm-btn")).toHaveCount(
      0,
    );

    await setIssueListFailure(request, false);
    await page
      .getByTestId("planning-issue-error")
      .getByRole("button", { name: "Retry" })
      .click();

    // The configured fixture has one real issue linked to Sprint Alpha. Once
    // the issue read succeeds, the accurate count keeps deletion disabled for
    // the ordinary linked-item guard rather than the unknown-integrity guard.
    await expect(row.getByText("1")).toBeVisible();
    await expect(deleteButton).toBeDisabled();
    await expectCursorAtPointer(deleteButton, "not-allowed");
    await expect(deleteButton).not.toHaveAttribute("aria-disabled", "true");
    await expect(deleteButton).toHaveAttribute(
      "title",
      "Remove linked issues before deleting",
    );
  });

  test("shows the shared lifecycle rollup and opens its filtered Issues view by keyboard", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);

    const state = await readFixtureState(request);
    const vault = state.vaults.find(
      (candidate) => candidate.name === REEF_E2E_VAULT,
    );
    const sprint = vault?.sprints[0];
    expect(sprint).toBeDefined();

    const rollup = page.getByTestId(`planning-rollup-${sprint?.id}`);
    await expect(rollup).toBeVisible();
    await expect(rollup).toContainText("7");
    await expect(rollup).toContainText("1 completed");
    await expect(rollup).toContainText("4 in progress");
    await expect(rollup).toContainText("2 not started");
    await expect(rollup).toContainText("25 pts total · 5 pts complete");
    await expect(rollup).toContainText("3 pts remaining");
    await expect(rollup).toHaveAttribute(
      "href",
      `/workspace/${REEF_E2E_VAULT}/issues?sprint_id=${sprint?.id}`,
    );

    await rollup.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(
        `/workspace/${REEF_E2E_VAULT}/issues\\?sprint_id=${sprint?.id}$`,
      ),
    );
  });

  test("opens sprint detail from Planning and keeps the fixed Board/List scope", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);

    const state = await readFixtureState(request);
    const sprint = state.vaults
      .find((vault) => vault.name === REEF_E2E_VAULT)
      ?.sprints.find((candidate) => candidate.status === "active");
    expect(sprint).toBeDefined();

    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/planning/sprints/${sprint?.id}`,
    );
    await expect(page.getByTestId("sprint-detail-header")).toBeVisible();
    await expect(page.getByTestId("current-sprint-shortcut")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Launch Readiness Sprint" }),
    ).toBeVisible();
    await expect(page.getByTestId("sprint-detail-count")).toContainText("1/7");
    await expect(page.getByTestId("sprint-detail-health")).toBeVisible();
    await expect(page.getByTestId("sprint-burnup-slot")).toHaveAttribute(
      "data-slot",
      "sprint-burnup",
    );
    await expect(page.getByTestId("sprint-filter-locked")).toContainText(
      "Launch Readiness Sprint",
    );
    await expect(page.getByTestId("view-switcher-timeline")).toHaveCount(0);

    await page.getByTestId("view-switcher-list").click();
    await expect(page).toHaveURL(
      new RegExp(
        `/workspace/${REEF_E2E_VAULT}/planning/sprints/${sprint?.id}\\?view=list$`,
      ),
    );
    await expect(
      page.locator('[data-testid="issue-list-row"]').first(),
    ).toBeVisible();

    await page
      .getByTestId("sprint-filter-locked")
      .getByRole("link", { name: "Unlock sprint scope and open Issues" })
      .click();
    await expect(page).toHaveURL(
      `/workspace/${REEF_E2E_VAULT}/issues?view=list`,
    );
  });

  test("uses the canonical current-sprint anchor in every Active Issues view", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "demo_board");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);

    const state = await readFixtureState(request);
    const sprint = state.vaults
      .find((vault) => vault.name === REEF_E2E_VAULT)
      ?.sprints.find((candidate) => candidate.status === "active");
    expect(sprint).toBeDefined();

    for (const view of ["board", "list", "timeline"] as const) {
      await page.goto(`/workspace/${REEF_E2E_VAULT}/issues?view=${view}`);
      const contextLink = page
        .getByTestId("current-sprint-shortcut")
        .getByRole("link");
      await expect(contextLink).toHaveAttribute(
        "href",
        `/workspace/${REEF_E2E_VAULT}/planning/sprints/${sprint?.id}`,
      );
      expect(await contextLink.evaluate((element) => element.tagName)).toBe(
        "A",
      );
      await expect(page.getByTestId("active-sprint-context")).toHaveCount(0);
    }
  });

  test("keeps a missing sprint distinct from a successful catalog", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    const state = await readFixtureState(request);
    const sprint = state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)
      ?.sprints[0];
    expect(sprint).toBeDefined();

    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/planning/sprints/00000000-0000-4000-8000-999999999999`,
    );
    await expect(page.getByTestId("sprint-detail-not-found")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to Planning" }),
    ).toHaveAttribute("href", `/workspace/${REEF_E2E_VAULT}/planning`);
  });

  test("keeps catalog failures explicit and retryable", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await clearPersistedQueryCacheOnLoad(page);
    await setPlanningCatalogFailure(request, true);
    await openExistingWorkspace(page);
    const state = await readFixtureState(request);
    const sprint = state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)
      ?.sprints[0];
    expect(sprint).toBeDefined();
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/planning/sprints/${sprint?.id}`,
    );
    await expect(page.getByTestId("sprint-detail-catalog-error")).toBeVisible();
    await setPlanningCatalogFailure(request, false);
    await page
      .getByTestId("sprint-detail-catalog-error")
      .getByRole("button", { name: "Retry" })
      .click();
    await expect(page.getByTestId("sprint-detail-header")).toBeVisible();
  });

  test("keeps issue failures explicit and retryable", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await clearPersistedQueryCacheOnLoad(page);
    await setIssueListFailure(request, true);
    await openExistingWorkspace(page);
    const state = await readFixtureState(request);
    const sprint = state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)
      ?.sprints[0];
    expect(sprint).toBeDefined();
    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/planning/sprints/${sprint?.id}`,
    );
    await expect(page.getByTestId("sprint-detail-issue-error")).toBeVisible();
    await expect(page.getByTestId("sprint-detail-not-found")).toHaveCount(0);
    await setIssueListFailure(request, false);
    await page
      .getByTestId("sprint-detail-issue-error")
      .getByRole("button", { name: "Retry" })
      .click();
    await expect(page.getByTestId("sprint-detail-header")).toBeVisible();
  });

  test("keeps the detail route below the CLS budget after a deep-link load", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    const state = await readFixtureState(request);
    const sprint = state.vaults.find((vault) => vault.name === REEF_E2E_VAULT)
      ?.sprints[0];
    expect(sprint).toBeDefined();

    await page.goto(
      `/workspace/${REEF_E2E_VAULT}/planning/sprints/${sprint?.id}`,
    );
    await expect(page.getByTestId("sprint-detail-header")).toBeVisible();
    expect(await cumulativeLayoutShift(page)).toBeLessThan(0.1);
  });

  test("keeps the existing empty planning state and create entry point for a successful empty catalog", async ({
    page,
    request,
  }) => {
    // The runtime-contract task publishes empty-state starting points but does
    // not execute this composed page, so keep the routed Planning proof here.
    await resetFixture(request, "configured_empty");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/planning`);

    await expect(page.getByTestId("planning-empty-sprints")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("heading", { name: "No sprints yet." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New sprint" }),
    ).toBeVisible();
    await expect(page.getByTestId("planning-catalog-error")).toHaveCount(0);
  });
});
