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

  test("edits and approves a seeded AI draft through the activity inbox", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/activity");

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
    await page.waitForURL(/\/issues\/REEF-004/, { timeout: 10_000 });
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
    await page.goto("/workspace/reef-e2e/activity");

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
    await page.goto("/workspace/reef-e2e/activity");

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
    await page.goto("/workspace/reef-e2e/activity");

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
