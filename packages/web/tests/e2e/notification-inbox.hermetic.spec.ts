import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
} from "./harness/fixture";

function reefVault(state: Awaited<ReturnType<typeof readFixtureState>>) {
  const vault = state.vaults.find(
    (candidate) => candidate.name === REEF_E2E_VAULT,
  );
  if (!vault) throw new Error(`Missing fixture vault: ${REEF_E2E_VAULT}`);
  return vault;
}

function primaryNotification(
  state: Awaited<ReturnType<typeof readFixtureState>>,
) {
  const notification = reefVault(state).notifications.find(
    (candidate) => candidate.source_ref === "comment-primary",
  );
  if (!notification) throw new Error("Missing primary notification fixture");
  return notification;
}

test.describe("Hermetic notification Inbox", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "notifications");
  });

  test("keeps unread state actor-scoped, caps the badge, and persists read/unread/archive transitions", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);

    const initial = await readFixtureState(request);
    const aliceUnread = reefVault(initial).notifications.filter(
      (notification) =>
        notification.recipient === "alice" && notification.state === "unread",
    );
    expect(aliceUnread).toHaveLength(100);

    const badge = page.getByTestId("inbox-unread-badge");
    await expect(badge).toHaveText("9+");
    await expect(badge).toHaveAccessibleName(
      "100 or more unread notifications",
    );

    const forgedRecipientResponse = await page.request.get(
      `/api/notifications?vault=${REEF_E2E_VAULT}&state=unread&limit=100&recipient=bob`,
    );
    expect(forgedRecipientResponse.ok()).toBe(true);
    const forgedRecipientBody = (await forgedRecipientResponse.json()) as {
      notifications: Array<{ recipient: string }>;
    };
    expect(forgedRecipientBody.notifications).toHaveLength(100);
    expect(
      new Set(forgedRecipientBody.notifications.map((item) => item.recipient)),
    ).toEqual(new Set(["alice"]));

    await page.getByRole("link", { name: /Inbox/ }).click();
    await expect(page).toHaveURL(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(page.getByText("Comment created")).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();
    const primaryRow = page
      .getByTestId("notification-item")
      .filter({ hasText: "Comment created" });
    await expect(primaryRow).toHaveCount(1);
    await expect(primaryRow.getByTestId("notification-open")).toBeVisible();

    await primaryRow.getByTestId("notification-open").click();
    await expect(page).toHaveURL(
      `/workspace/${REEF_E2E_VAULT}/issues/REEF-001#issue-activity`,
    );
    await expect
      .poll(
        async () => primaryNotification(await readFixtureState(request)).state,
      )
      .toBe("read");

    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(
      page
        .getByTestId("notification-item")
        .filter({ hasText: "Comment created" })
        .getByRole("button", { name: "Mark REEF-001 unread" }),
    ).toBeVisible();
    const reloadedPrimaryRow = page
      .getByTestId("notification-item")
      .filter({ hasText: "Comment created" });
    await reloadedPrimaryRow
      .getByRole("button", { name: "Mark REEF-001 unread" })
      .click();
    await expect
      .poll(
        async () => primaryNotification(await readFixtureState(request)).state,
      )
      .toBe("unread");

    await page
      .getByTestId("notification-item")
      .filter({ hasText: "Comment created" })
      .getByRole("button", { name: "Archive notification for REEF-001" })
      .click();
    await expect
      .poll(
        async () => primaryNotification(await readFixtureState(request)).state,
      )
      .toBe("archived");
    await expect(
      page
        .getByTestId("notification-item")
        .filter({ hasText: "Comment created" }),
    ).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("notification-inbox")).toBeVisible();
    await expect(
      page
        .getByTestId("notification-item")
        .filter({ hasText: "Comment created" }),
    ).toHaveCount(0);
  });
});
