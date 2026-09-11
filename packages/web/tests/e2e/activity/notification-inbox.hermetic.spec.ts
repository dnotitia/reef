import { expect, test } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  fixtureReaderLogin,
  fixtureWriterLogin,
  openExistingWorkspace,
  readFixtureState,
  resetFixture,
  setNotificationControl,
  signInAsUser,
} from "../harness/fixture";

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

function issueBodyMentionNotification(
  state: Awaited<ReturnType<typeof readFixtureState>>,
) {
  const notification = reefVault(state).notifications.find(
    (candidate) =>
      candidate.source_ref ===
      "issue_body_mentions_change:e2e-issue-body-commit",
  );
  if (!notification) {
    throw new Error("Missing issue-body mention notification fixture");
  }
  return notification;
}

function notificationForRecipient(
  state: Awaited<ReturnType<typeof readFixtureState>>,
  recipient: string,
) {
  const notification = reefVault(state).notifications.find(
    (candidate) => candidate.recipient === recipient,
  );
  if (!notification) {
    throw new Error(`Missing notification fixture for ${recipient}`);
  }
  return notification;
}

function schemaMutationSql(
  state: Awaited<ReturnType<typeof readFixtureState>>,
) {
  return state.sql_calls.filter(({ sql }) => {
    const lower = sql.toLowerCase();
    const writesSettings =
      /\b(delete|insert|update)\b/u.test(lower) &&
      lower.includes("reef_settings");
    const changesNotificationSchema =
      /\b(create|alter)\b/u.test(lower) && lower.includes("reef_notifications");
    return writesSettings || changesNotificationSchema;
  });
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
    expect(reefVault(initial).settings.schema_version).toBe("2");
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
      .getByRole("listitem")
      .filter({ hasText: "Comment created" });
    await expect(primaryRow).toHaveCount(1);
    const openNotification = primaryRow.getByRole("button", {
      name: /Open activity for REEF-001|REEF-001 활동 열기/u,
    });
    await expect(openNotification).toBeVisible();

    await openNotification.click();
    await expect(page).toHaveURL(
      `/workspace/${REEF_E2E_VAULT}/issues/REEF-001#comment-comment-primary`,
    );
    await expect(page.locator("#comment-comment-primary")).toBeVisible();
    await expect(page.locator("#comment-comment-primary")).toContainText(
      "mentioned source",
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

    const final = await readFixtureState(request);
    expect(reefVault(final).settings.schema_version).toBe("2");
    expect(schemaMutationSql(final)).toEqual([]);
  });

  test("lets reader sessions read their inbox but preserves 403 and the session on PATCH", async ({
    page,
    request,
  }) => {
    await signInAsUser(page, fixtureReaderLogin);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("1");

    const vaultsResponse = await page.request.get("/api/vaults");
    expect(vaultsResponse.ok()).toBe(true);
    const vaultsBody = (await vaultsResponse.json()) as {
      vaults: Array<{ name: string; role: string }>;
    };
    expect(
      vaultsBody.vaults.find((vault) => vault.name === REEF_E2E_VAULT)?.role,
    ).toBe("reader");

    const initial = await readFixtureState(request);
    const readerNotification = notificationForRecipient(initial, "bob");
    expect(readerNotification.state).toBe("unread");
    const visibleToReader = await page.request.get(
      `/api/notifications?vault=${REEF_E2E_VAULT}&state=unread&recipient=alice`,
    );
    expect(visibleToReader.status()).toBe(200);
    const visibleBody = (await visibleToReader.json()) as {
      notifications: Array<{ recipient: string }>;
    };
    expect(visibleBody.notifications).toHaveLength(1);
    expect(visibleBody.notifications[0]?.recipient).toBe("bob");

    const beforeSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "__reef_session",
    );
    if (!beforeSession) throw new Error("reader session cookie was not set");
    const deniedUpdate = await page.request.patch(
      `/api/notifications/${encodeURIComponent(readerNotification.notification_key)}`,
      {
        data: { vault: REEF_E2E_VAULT, state: "read" },
      },
    );
    expect(deniedUpdate.status()).toBe(403);
    expect(await deniedUpdate.json()).toEqual(
      expect.objectContaining({
        error: expect.stringMatching(/permission|access/i),
      }),
    );
    expect(deniedUpdate.headers()["set-cookie"]).toBeUndefined();
    const afterSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "__reef_session",
    );
    expect(afterSession?.value).toBe(beforeSession.value);

    const final = await readFixtureState(request);
    expect(notificationForRecipient(final, "bob").state).toBe("unread");
    expect(reefVault(final).settings.schema_version).toBe("2");
    expect(schemaMutationSql(final)).toEqual([]);
  });

  test("allows writer state changes without hiding recipient or key isolation", async ({
    page,
    request,
  }) => {
    await signInAsUser(page, fixtureWriterLogin);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

    const vaultsResponse = await page.request.get("/api/vaults");
    expect(vaultsResponse.ok()).toBe(true);
    const vaultsBody = (await vaultsResponse.json()) as {
      vaults: Array<{ name: string; role: string }>;
    };
    expect(
      vaultsBody.vaults.find((vault) => vault.name === REEF_E2E_VAULT)?.role,
    ).toBe("writer");

    const initial = await readFixtureState(request);
    const writerNotification = notificationForRecipient(initial, "writer");
    const readerNotification = notificationForRecipient(initial, "bob");
    const updated = await page.request.patch(
      `/api/notifications/${encodeURIComponent(writerNotification.notification_key)}`,
      {
        data: { vault: REEF_E2E_VAULT, state: "read" },
      },
    );
    expect(updated.status()).toBe(200);
    expect(await updated.json()).toEqual(
      expect.objectContaining({
        notification: expect.objectContaining({
          recipient: "writer",
          state: "read",
        }),
      }),
    );

    const crossRecipient = await page.request.patch(
      `/api/notifications/${encodeURIComponent(readerNotification.notification_key)}`,
      {
        data: {
          vault: REEF_E2E_VAULT,
          state: "read",
          recipient: "bob",
        },
      },
    );
    expect(crossRecipient.status()).toBe(404);
    expect(await crossRecipient.json()).toEqual(
      expect.objectContaining({ error: expect.any(String) }),
    );

    const final = await readFixtureState(request);
    expect(notificationForRecipient(final, "writer").state).toBe("read");
    expect(notificationForRecipient(final, "bob").state).toBe("unread");
    expect(reefVault(final).settings.schema_version).toBe("2");
    expect(schemaMutationSql(final)).toEqual([]);
  });

  test("surfaces notification schema and data failures instead of returning empty success", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    const initial = await readFixtureState(request);
    const initialSettings = { ...reefVault(initial).settings };

    const controls = [
      { schemaMode: "missing" as const },
      { schemaMode: "incompatible" as const },
      { dataMode: "forbidden" as const },
      { dataMode: "error" as const },
    ];
    try {
      for (const control of controls) {
        await setNotificationControl(request, control);
        const response = await page.request.get(
          `/api/notifications?vault=${REEF_E2E_VAULT}&state=unread`,
        );
        expect(response.ok()).toBe(false);
        expect(response.status()).not.toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toEqual(
          expect.objectContaining({ error: expect.any(String) }),
        );
        expect(body).not.toHaveProperty("notifications");

        const observed = await readFixtureState(request);
        expect(reefVault(observed).settings).toEqual(initialSettings);
        expect(schemaMutationSql(observed)).toEqual([]);
      }
    } finally {
      await setNotificationControl(request, {
        schemaMode: "healthy",
        dataMode: "healthy",
      });
    }
  });

  test("opens an issue-body mention at the description and persists read state", async ({
    page,
    request,
  }) => {
    await openExistingWorkspace(page);
    await page.getByRole("link", { name: /Inbox/ }).click();
    await expect(page).toHaveURL(`/workspace/${REEF_E2E_VAULT}/inbox`);

    const mentionRow = page
      .getByTestId("notification-item")
      .filter({ hasText: "You were mentioned in an issue" });
    await expect(mentionRow).toHaveCount(1);
    await expect(mentionRow).toContainText("bob");
    await expect(mentionRow).toContainText("REEF-001");
    await expect(mentionRow).toHaveAttribute("data-state", "unread");

    await mentionRow.getByTestId("notification-open").click();
    await expect(page).toHaveURL(
      `/workspace/${REEF_E2E_VAULT}/issues/REEF-001#issue-description`,
    );
    await expect(page.locator("#issue-description")).toBeVisible();
    await expect(page.locator("#issue-description")).toContainText(
      "Alpha description from fixture.",
    );
    await expect
      .poll(
        async () =>
          issueBodyMentionNotification(await readFixtureState(request)).state,
      )
      .toBe("read");

    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    const reloadedMentionRow = page
      .getByTestId("notification-item")
      .filter({ hasText: "You were mentioned in an issue" });
    await expect(reloadedMentionRow).toHaveCount(1);
    await expect(reloadedMentionRow).toHaveAttribute("data-state", "read");

    await page.reload();
    const refreshedMentionRows = page
      .getByTestId("notification-item")
      .filter({ hasText: "You were mentioned in an issue" });
    await expect(refreshedMentionRows).toHaveCount(1);
    await expect(refreshedMentionRows).toHaveAttribute("data-state", "read");
  });
});
