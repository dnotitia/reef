import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "./harness/fixture";

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

test.describe("Hermetic activity suggestion workflows", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "activity_suggestions");
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
