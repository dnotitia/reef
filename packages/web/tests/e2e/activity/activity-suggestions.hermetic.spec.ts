import { type Page, expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  clearPersistedQueryCacheOnLoad,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "../harness/fixture";

type FixtureState = Awaited<ReturnType<typeof readFixtureState>>;
type FixtureVault = FixtureState["vaults"][number];

function reefVault(state: FixtureState): FixtureVault {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

function suggestionById(state: FixtureState, id: string) {
  const suggestion = reefVault(state).activity_suggestions.find(
    (candidate) => candidate.id === id,
  );
  if (!suggestion) throw new Error(`Missing activity suggestion: ${id}`);
  return suggestion;
}

function issueById(state: FixtureState, id: string) {
  const issue = reefVault(state).issues.find(
    (candidate) => candidate.id === id,
  );
  if (!issue) throw new Error(`Missing issue: ${id}`);
  return issue;
}

async function addMonitoredRepo(
  page: Page,
  request: Parameters<typeof resetFixture>[0],
) {
  await page.goto(`/workspace/${REEF_E2E_VAULT}/settings/workspace`);
  const main = page.getByRole("main");
  await main.getByTestId("monitored-repos-trigger").click();
  await page.getByTestId("monitored-repos-option-octo/reef").click();
  await expect(main.getByTestId("monitored-repos-trigger")).toContainText(
    "1 repo(s) selected",
  );
  await expect
    .poll(async () => {
      const state = await readFixtureState(request);
      return reefVault(state).monitored_repos.map(
        (repo) => `${repo.owner}/${repo.name}`,
      );
    })
    .toContain("octo/reef");
}

test.describe("Hermetic activity suggestion workflows", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "activity_suggestions");
  });

  test("explains the repository prerequisite without putting an action in the frame", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_empty");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/suggestions`);

    const emptyState = page.getByTestId("activity-empty-state");
    await expect(emptyState).toHaveAccessibleName(
      "Set up a monitored repository",
    );
    await expect(emptyState).toHaveAccessibleDescription(
      "Add a monitored repository to start looking for suggestions.",
    );
    await expect(emptyState).toHaveAttribute("aria-labelledby", /.+/);
    await expect(emptyState).toHaveAttribute("aria-describedby", /.+/);
    expect(await emptyState.evaluate((element) => element.tagName)).toBe(
      "SECTION",
    );
    await expect(
      emptyState.getByRole("heading", {
        name: "Set up a monitored repository",
      }),
    ).toBeVisible();
    await expect(emptyState.getByRole("link")).toHaveCount(0);
    await expect(emptyState.getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("activity-scan-target-empty")).toBeVisible();
    await expect(page.getByTestId("activity-refresh")).toBeDisabled();
    const settingsLink = page
      .getByTestId("activity-scan-target-empty")
      .getByRole("link", { name: "Settings" });
    await expect(settingsLink).toHaveCount(1);
    await settingsLink.focus();
    await expect(settingsLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `/workspace/${REEF_E2E_VAULT}/settings/workspace`,
    );
    expect(
      reefVault(await readFixtureState(request)).monitored_repos,
    ).toHaveLength(0);
  });

  test("dismisses a draft from a focused control with Enter and Space", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/suggestions`);

    for (const [title, key] of [
      ["Dismiss stale draft", "Enter"],
      ["Draft API rate limit issue", "Space"],
    ] as const) {
      const card = page
        .locator('[data-testid="activity-item-ai_draft"]')
        .filter({ hasText: title });
      await expect(card).toBeVisible();
      const dismiss = card.getByRole("button", { name: "Dismiss" });
      await dismiss.focus();
      await expect(dismiss).toBeFocused();
      await page.keyboard.press(key);
      await expect(card).toBeHidden();
    }

    await expect
      .poll(async () => {
        const suggestions = reefVault(
          await readFixtureState(request),
        ).activity_suggestions;
        return suggestions
          .filter((suggestion) => suggestion.kind === "draft")
          .every((suggestion) => suggestion.status === "dismissed");
      })
      .toBe(true);
  });

  test("keeps configured empty suggestions passive and leaves Check now separate", async ({
    page,
    request,
  }) => {
    await resetFixture(request, "configured_empty");
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await addMonitoredRepo(page, request);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/suggestions`);

    const emptyState = page.getByTestId("activity-empty-state");
    await expect(emptyState).toHaveAccessibleName("No suggestions to review");
    await expect(emptyState).toHaveAccessibleDescription(
      "Suggestions will appear here when a scan finds something to review.",
    );
    await expect(emptyState).toHaveAttribute("aria-labelledby", /.+/);
    await expect(emptyState).toHaveAttribute("aria-describedby", /.+/);
    expect(await emptyState.evaluate((element) => element.tagName)).toBe(
      "SECTION",
    );
    await expect(
      emptyState.getByRole("heading", { name: "No suggestions to review" }),
    ).toBeVisible();
    await expect(emptyState.getByRole("link")).toHaveCount(0);
    await expect(emptyState.getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("activity-refresh")).toBeEnabled();
    await expect(page.getByTestId("activity-scan-target-single")).toHaveText(
      "octo/reef",
    );
    expect(
      reefVault(await readFixtureState(request)).monitored_repos.map(
        (repo) => `${repo.owner}/${repo.name}`,
      ),
    ).toContain("octo/reef");
  });

  test("recovers from a persisted filtered no-match with keyboard input", async ({
    page,
    request,
  }) => {
    await clearPersistedQueryCacheOnLoad(page);
    await openExistingWorkspace(page);
    await addMonitoredRepo(page, request);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/suggestions`);

    for (const title of ["Initial issue Alpha", "Initial issue Beta"]) {
      const card = page
        .locator('[data-testid="activity-item-ai_status_change"]')
        .filter({ hasText: title });
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "Dismiss" }).click();
      await expect(card).toBeHidden();
    }

    await expect
      .poll(async () => {
        const suggestions = reefVault(
          await readFixtureState(request),
        ).activity_suggestions;
        return suggestions
          .filter((suggestion) => suggestion.kind === "status_change")
          .every((suggestion) => suggestion.status === "dismissed");
      })
      .toBe(true);

    await page.reload();
    await expect(
      page.locator('[data-testid="activity-item-ai_draft"]'),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Status Changes", exact: true })
      .click();

    const emptyState = page.getByTestId("activity-empty-state");
    await expect(emptyState).toHaveAccessibleName("No matching suggestions");
    await expect(emptyState).toHaveAccessibleDescription(
      "Try a different filter or clear the current filter to see more suggestions.",
    );
    await expect(emptyState).toHaveAttribute("aria-labelledby", /.+/);
    await expect(emptyState).toHaveAttribute("aria-describedby", /.+/);
    expect(await emptyState.evaluate((element) => element.tagName)).toBe(
      "SECTION",
    );
    await expect(
      emptyState.getByRole("heading", { name: "No matching suggestions" }),
    ).toBeVisible();
    await expect(emptyState.getByRole("link")).toHaveCount(0);
    await expect(emptyState.getByRole("button")).toHaveCount(0);
    const clearFilters = page.getByTestId("activity-clear-filters");
    await expect(clearFilters).toBeVisible();
    await clearFilters.focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("button", { name: "All", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[data-testid="activity-item-ai_draft"]'),
    ).toHaveCount(2);
  });

  test("keeps the real pending total across a visit and decreases it after a persisted action", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    const pendingSuggestions = reefVault(
      await readFixtureState(request),
    ).activity_suggestions.filter(
      (suggestion) => suggestion.status === "pending",
    );
    const pendingBefore = pendingSuggestions.length;
    expect(pendingBefore).toBeGreaterThan(0);

    const expandedBadge = page.getByTestId("suggestions-pending-badge");
    await expect(expandedBadge).toHaveAccessibleName(
      `${pendingBefore} pending suggestions`,
    );

    await page.getByRole("link", { name: /Suggestions/ }).click();
    await expect(page).toHaveURL("/workspace/reef-e2e/suggestions");
    await expect(
      page.getByRole("heading", { name: "Suggestions to review" }),
    ).toBeVisible();
    const draftProvenance = page
      .getByTestId("suggestion-provenance")
      .filter({ hasText: "AI Draft" });
    const statusChangeProvenance = page
      .getByTestId("suggestion-provenance")
      .filter({ hasText: "AI Status Change" });
    await expect(draftProvenance).toHaveCount(
      pendingSuggestions.filter((suggestion) => suggestion.kind === "draft")
        .length,
    );
    await expect(statusChangeProvenance).toHaveCount(
      pendingSuggestions.filter(
        (suggestion) => suggestion.kind === "status_change",
      ).length,
    );
    await expect(draftProvenance.first()).toBeVisible();
    await expect(statusChangeProvenance.first()).toBeVisible();
    await expect(expandedBadge).toHaveAccessibleName(
      `${pendingBefore} pending suggestions`,
    );

    const dismissedCard = page
      .locator('[data-testid="activity-item-ai_draft"]')
      .filter({ hasText: "Dismiss stale draft" });
    const dismissedSuggestion = pendingSuggestions.find(
      (suggestion) => suggestion.title === "Dismiss stale draft",
    );
    expect(dismissedSuggestion).toBeDefined();
    await dismissedCard.getByRole("button", { name: "Dismiss" }).click();

    const pendingAfter = pendingBefore - 1;
    await expect(expandedBadge).toHaveAccessibleName(
      `${pendingAfter} pending suggestions`,
    );
    await expect
      .poll(
        async () =>
          reefVault(
            await readFixtureState(request),
          ).activity_suggestions.filter(
            (suggestion) => suggestion.status === "pending",
          ).length,
      )
      .toBe(pendingAfter);
    await page.reload();
    await expect
      .poll(
        async () =>
          suggestionById(
            await readFixtureState(request),
            dismissedSuggestion?.id ?? "",
          ).status,
      )
      .toBe("dismissed");
    const pendingApiResponse = await page.request.get(
      `/api/activity/suggestions?vault=${REEF_E2E_VAULT}&status=pending`,
    );
    expect(pendingApiResponse.ok()).toBe(true);
    const pendingApiBody = (await pendingApiResponse.json()) as {
      suggestions: unknown[];
    };
    expect(pendingApiBody.suggestions).toHaveLength(pendingAfter);
    await expect(expandedBadge).toHaveAccessibleName(
      `${pendingAfter} pending suggestions`,
    );
    await expect
      .poll(
        async () =>
          reefVault(
            await readFixtureState(request),
          ).activity_suggestions.filter(
            (suggestion) => suggestion.status === "pending",
          ).length,
      )
      .toBe(pendingAfter);
  });

  test("exposes suggestion controls from an interaction-ready shell", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    const pendingBefore = reefVault(
      await readFixtureState(request),
    ).activity_suggestions.filter(
      (suggestion) => suggestion.status === "pending",
    ).length;

    await page.goto("/workspace/reef-e2e/suggestions");
    await expect(page.locator('[data-interaction-ready="true"]')).toBeVisible();

    const collapseSidebar = page.getByRole("button", {
      name: "Collapse sidebar",
    });
    await expect(collapseSidebar).toBeVisible();
    await collapseSidebar.click();
    await expect(
      page.getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("suggestions-pending-dot"),
    ).toHaveAccessibleName(`${pendingBefore} pending suggestions`);

    await page.goto("/workspace/reef-e2e/issues");
    await expect(page.locator('[data-interaction-ready="true"]')).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page).toHaveURL("/workspace/reef-e2e/suggestions");

    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const shortcutDialog = page.getByTestId("keyboard-shortcuts-dialog");
    await expect(shortcutDialog).toBeVisible();
    await expect(
      shortcutDialog.locator('[data-shortcut-label="navigation.suggestions"]'),
    ).toContainText("Suggestions");
  });

  test("preserves repeated and empty query values through scoped and flat compatibility URLs", async ({
    page,
  }) => {
    await openExistingWorkspace(page);

    await page.goto("/workspace/reef-e2e/activity?tag=a&tag=b&empty=");
    await expect(page).toHaveURL(
      "/workspace/reef-e2e/suggestions?tag=a&tag=b&empty=",
    );

    await page.goto("/activity?tag=a&tag=b&empty=");
    await expect(page).toHaveURL(
      "/workspace/reef-e2e/suggestions?tag=a&tag=b&empty=",
    );
  });

  test("edits and approves a seeded AI draft through Suggestions", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/suggestions");

    const draftCard = page
      .locator('[data-testid="activity-item-ai_draft"]')
      .filter({ hasText: "Draft API rate limit issue" });
    await expect(draftCard).toBeVisible();

    await draftCard.locator('[data-testid="draft-edit"]').click();
    await expect(
      page.locator('[data-testid="draft-edit-panel"]'),
    ).toBeVisible();
    await page
      .locator('[data-testid="draft-edit-title"]')
      .fill("Edited activity draft issue");
    await page.locator('[data-testid="draft-save"]').click();

    await expect
      .poll(async () => {
        const suggestion = suggestionById(
          await readFixtureState(request),
          "reef-draft-1111111111111111",
        );
        const proposal = suggestion.proposal as {
          create?: { fields?: { title?: string } };
        };
        return proposal.create?.fields?.title;
      })
      .toBe("Edited activity draft issue");

    await page
      .locator('[data-testid="activity-item-ai_draft"]')
      .filter({ hasText: "Edited activity draft issue" })
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(page).toHaveURL(
      /\/workspace\/reef-e2e\/issues\/REEF-004\/?$/,
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-testid="issue-title-input"]')).toHaveValue(
      "Edited activity draft issue",
    );
    await expect
      .poll(async () =>
        suggestionById(
          await readFixtureState(request),
          "reef-draft-1111111111111111",
        ),
      )
      .toMatchObject({
        status: "approved",
        approved_issue_id: "REEF-004",
      });
    await expect
      .poll(
        async () =>
          issueById(await readFixtureState(request), "REEF-004").title,
      )
      .toBe("Edited activity draft issue");
  });

  test("dismisses a seeded AI draft without creating an issue", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/suggestions");

    const draftCard = page
      .locator('[data-testid="activity-item-ai_draft"]')
      .filter({ hasText: "Dismiss stale draft" });
    await expect(draftCard).toBeVisible();

    await draftCard.getByRole("button", { name: "Dismiss" }).click();
    await expect(draftCard).toBeHidden();
    await expect
      .poll(
        async () =>
          suggestionById(
            await readFixtureState(request),
            "reef-draft-2222222222222222",
          ).status,
      )
      .toBe("dismissed");
    await expect
      .poll(async () => reefVault(await readFixtureState(request)).issue_ids)
      .not.toContain("REEF-004");
  });

  test("edits and approves a seeded status-change suggestion", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/suggestions");

    const statusCard = page
      .locator('[data-testid="activity-item-ai_status_change"]')
      .filter({ hasText: "Initial issue Alpha" });
    await expect(statusCard).toBeVisible();

    await statusCard.locator('[data-testid="status-change-edit"]').click();
    await statusCard.locator('[data-testid="status-change-target"]').click();
    await page.getByRole("option", { name: "In Review" }).click();
    await statusCard.locator('[data-testid="status-change-save"]').click();

    await expect
      .poll(async () => {
        const suggestion = suggestionById(
          await readFixtureState(request),
          "reef-status-3333333333333333",
        );
        const proposal = suggestion.proposal as {
          update?: { patch?: { status?: string } };
        };
        return proposal.update?.patch?.status;
      })
      .toBe("in_review");

    await statusCard.getByRole("button", { name: "Approve" }).click();
    await expect(statusCard).toBeHidden();
    await expect
      .poll(
        async () =>
          suggestionById(
            await readFixtureState(request),
            "reef-status-3333333333333333",
          ).status,
      )
      .toBe("approved");
    await expect
      .poll(
        async () =>
          issueById(await readFixtureState(request), "REEF-001").status,
      )
      .toBe("in_review");
  });

  test("dismisses a seeded status-change suggestion", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/suggestions");

    const statusCard = page
      .locator('[data-testid="activity-item-ai_status_change"]')
      .filter({ hasText: "Initial issue Beta" });
    await expect(statusCard).toBeVisible();

    await statusCard.getByRole("button", { name: "Dismiss" }).click();
    await expect(statusCard).toBeHidden();
    await expect
      .poll(
        async () =>
          suggestionById(
            await readFixtureState(request),
            "reef-status-4444444444444444",
          ).status,
      )
      .toBe("dismissed");
    await expect
      .poll(
        async () =>
          issueById(await readFixtureState(request), "REEF-002").status,
      )
      .toBe("in_progress");
  });
});
