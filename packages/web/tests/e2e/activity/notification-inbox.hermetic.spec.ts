import { test as workspaceTest } from "../harness/workspace-fixture";
import { expect, type Page } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  addLateUnreadNotification,
  fixtureReaderLogin,
  fixtureWriterLogin,
  readFixtureState,
  setNotificationControl,
  setResponseHold,
  setInstallationControl,
  setVaultListControl,
  signInThroughApi,
  continueToWorkspace,
  emitNotificationStreamEvent,
  signInAsUser,
  waitForResponseHoldPending,
  setNotificationStreamControl,
} from "../harness/fixture";

const test = workspaceTest.extend({ scenario: "notifications_personal" });

const DUPLICATE_COMMENT_NOTIFICATION_KEY =
  "notification:5:alice:7:comment:15:comment-primary";

async function openNotificationWorkspace(page: Page): Promise<void> {
  await signInThroughApi(page);
  await page.goto(`/workspace/${REEF_E2E_VAULT}/issues`);
  await continueToWorkspace(page, REEF_E2E_VAULT);
}

function reefVault(state: Awaited<ReturnType<typeof readFixtureState>>) {
  const vault = workspaceVault(state, REEF_E2E_VAULT);
  return vault;
}

function workspaceVault(
  state: Awaited<ReturnType<typeof readFixtureState>>,
  workspace: string,
) {
  const vault = state.vaults.find((candidate) => candidate.name === workspace);
  if (!vault) throw new Error(`Missing fixture vault: ${workspace}`);
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

function alphaCommentNotification(
  state: Awaited<ReturnType<typeof readFixtureState>>,
) {
  const notification = workspaceVault(state, "reef-alpha").notifications.find(
    (candidate) => candidate.source_ref === "comment-primary",
  );
  if (!notification) throw new Error("Missing duplicate comment notification");
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
  test("filters the capped list locally and reload resets it to All", async ({
    page,
  }) => {
    await signInThroughApi(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

    const allFilter = page.getByRole("button", { name: "All", exact: true });
    const unreadFilter = page.getByRole("button", {
      name: "Unread",
      exact: true,
    });
    await expect(allFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("notification-item")).toHaveCount(103);
    await unreadFilter.click();
    await expect(unreadFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("notification-item")).toHaveCount(100);

    await page.reload();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(allFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("notification-item")).toHaveCount(103);
  });

  test("refreshes the badge and Inbox after a committed notification change", async ({
    page,
    request,
  }) => {
    const feedRequests: string[] = [];
    let notificationListReads = 0;
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (url.pathname === "/api/notifications/events") {
        feedRequests.push(browserRequest.url());
      }
      if (
        url.pathname === "/api/notifications" &&
        browserRequest.method() === "GET"
      ) {
        notificationListReads += 1;
      }
    });

    await signInThroughApi(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("9+");
    await expect
      .poll(
        async () =>
          (await readFixtureState(request)).notification_stream.active,
      )
      .toBe(3);
    expect(feedRequests).toHaveLength(1);

    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByTestId("inbox-unread-badge")).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await readFixtureState(request);
        return state.vaults
          .flatMap((vault) => vault.notifications)
          .filter(
            (notification) =>
              notification.recipient === "alice" &&
              notification.state === "unread",
          ).length;
      })
      .toBe(0);
    await page.getByRole("button", { name: "Unread", exact: true }).click();
    await expect(page.getByTestId("notification-item")).toHaveCount(0);

    const readsBeforeIrrelevantEvent = notificationListReads;
    let irrelevantEventCount = (await readFixtureState(request))
      .notification_stream.events;
    for (const table of ["reef_activity", "reef_comments"] as const) {
      await emitNotificationStreamEvent(request, {
        vault: REEF_E2E_VAULT,
        table,
        operation: "insert",
      });
      irrelevantEventCount += 1;
      await expect
        .poll(
          async () =>
            (await readFixtureState(request)).notification_stream.events,
        )
        .toBe(irrelevantEventCount);
    }
    await page.waitForTimeout(1_000);
    expect(notificationListReads).toBe(readsBeforeIrrelevantEvent);

    const notificationKey = await addLateUnreadNotification(
      request,
      "reef-alpha",
      "live-notification-after-save",
    );
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("1");
    const insertedRow = page.locator(
      `[data-notification-key="${notificationKey}"]`,
    );
    await expect(insertedRow).toBeVisible();
    expect(notificationListReads).toBeGreaterThan(readsBeforeIrrelevantEvent);
    expect(feedRequests).toHaveLength(1);

    const readsBeforeReconnect = notificationListReads;
    await setNotificationStreamControl(request, {
      closeExisting: true,
      failNextConnections: 1,
    });
    await expect
      .poll(
        async () =>
          (await readFixtureState(request)).notification_stream.active,
      )
      .toBe(0);
    const missedDuringReconnect = await addLateUnreadNotification(
      request,
      "reef-e2e",
      "live-notification-during-reconnect",
    );
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("2");
    await expect(
      page.locator(`[data-notification-key="${missedDuringReconnect}"]`),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await readFixtureState(request)).notification_stream.active,
      )
      .toBe(3);
    await expect.poll(() => feedRequests.length).toBeGreaterThan(1);
    expect(notificationListReads).toBeGreaterThan(readsBeforeReconnect);
  });

  test("marks the click-time snapshot across workspaces and retries only unresolved identities", async ({
    page,
    request,
  }) => {
    await signInThroughApi(page);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

    const initial = await readFixtureState(request);
    const initialUnread = initial.vaults
      .filter((vault) =>
        [REEF_E2E_VAULT, "reef-alpha", "odd_workspace"].includes(vault.name),
      )
      .flatMap((vault) =>
        vault.notifications
          .filter(
            (notification) =>
              notification.recipient === "alice" &&
              notification.state === "unread" &&
              notification.archived_at == null,
          )
          .map((notification) => ({
            workspace: vault.name,
            notification_key: notification.notification_key,
          })),
      );
    expect(initialUnread.length).toBeGreaterThan(100);

    await setResponseHold(request, "notification-write", true);
    try {
      const firstResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/notifications/read-all") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Mark all read" }).click();
      await waitForResponseHoldPending(request, "notification-write");

      const lateOddKey = await addLateUnreadNotification(
        request,
        "odd_workspace",
        "late-during-read-all",
      );
      await setNotificationControl(request, {
        vault: "reef-alpha",
        role: "reader",
      });
      await setResponseHold(request, "notification-write", false);

      const firstResponse = await firstResponsePromise;
      expect(firstResponse.status()).toBe(200);
      const firstBody = (await firstResponse.json()) as {
        result: {
          targets: Array<{ workspace: string; notification_key: string }>;
          completed: Array<{ workspace: string; notification_key: string }>;
          unresolved: Array<{ workspace: string; notification_key: string }>;
        };
      };
      expect(firstBody.result.targets).toHaveLength(initialUnread.length);
      expect(
        firstBody.result.targets.filter(
          ({ notification_key }) =>
            notification_key === DUPLICATE_COMMENT_NOTIFICATION_KEY,
        ),
      ).toHaveLength(2);
      expect(
        new Set(firstBody.result.unresolved.map(({ workspace }) => workspace)),
      ).toEqual(new Set(["reef-alpha"]));
      expect(firstBody.result.completed.length).toBeGreaterThan(100);
      expect(firstBody.result.unresolved).toHaveLength(1);

      const afterFirstAttempt = await readFixtureState(request);
      expect(
        workspaceVault(afterFirstAttempt, "odd_workspace").notifications.find(
          ({ notification_key }) => notification_key === lateOddKey,
        )?.state,
      ).toBe("unread");
      expect(
        workspaceVault(afterFirstAttempt, "reef-alpha").notifications.find(
          ({ notification_key }) =>
            notification_key ===
            firstBody.result.unresolved[0]?.notification_key,
        )?.state,
      ).toBe("unread");

      await setNotificationControl(request, {
        vault: "reef-alpha",
        role: "owner",
      });
      const lateAlphaKey = await addLateUnreadNotification(
        request,
        "reef-alpha",
        "late-before-unresolved-retry",
      );
      const retryResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/notifications/read-all") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Retry 1 remaining" }).click();
      const retryResponse = await retryResponsePromise;
      expect(retryResponse.status()).toBe(200);
      const retryBody = (await retryResponse.json()) as {
        result: {
          targets: Array<{ workspace: string; notification_key: string }>;
          completed: Array<{ workspace: string; notification_key: string }>;
          unresolved: Array<{ workspace: string; notification_key: string }>;
        };
      };
      expect(retryBody.result.targets).toEqual(firstBody.result.unresolved);
      expect(retryBody.result.completed).toHaveLength(1);
      expect(retryBody.result.unresolved).toEqual([]);

      const final = await readFixtureState(request);
      expect(
        workspaceVault(final, "odd_workspace").notifications.find(
          ({ notification_key }) => notification_key === lateOddKey,
        )?.state,
      ).toBe("unread");
      expect(
        workspaceVault(final, "reef-alpha").notifications.find(
          ({ notification_key }) => notification_key === lateAlphaKey,
        )?.state,
      ).toBe("unread");
      expect(
        initialUnread.every((target) =>
          workspaceVault(final, target.workspace).notifications.some(
            (notification) =>
              notification.notification_key === target.notification_key &&
              notification.recipient === "alice" &&
              notification.state === "read",
          ),
        ),
      ).toBe(true);
    } finally {
      await setResponseHold(request, "notification-write", false);
      await setNotificationControl(request, {
        vault: "reef-alpha",
        role: "owner",
      });
    }
  });

  test("lists the actor's personal notifications without a selected vault", async ({
    page,
  }) => {
    await signInThroughApi(page);

    const response = await page.request.get(
      "/api/notifications?vault=raw-vault&state=archived&limit=1&recipient=bob",
    );

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      notifications: Array<{
        notification_key: string;
        recipient: string;
        state: string;
        workspace: string;
      }>;
    };
    expect(
      body.notifications.filter((item) => item.state === "unread"),
    ).toHaveLength(100);
    expect(
      body.notifications.filter((item) => item.state === "read"),
    ).toHaveLength(3);
    expect(new Set(body.notifications.map((item) => item.recipient))).toEqual(
      new Set(["alice"]),
    );
    expect(new Set(body.notifications.map((item) => item.workspace))).toEqual(
      new Set(["reef-e2e", "reef-alpha", "odd_workspace"]),
    );
    expect(
      body.notifications.filter(
        (item) => item.notification_key === DUPLICATE_COMMENT_NOTIFICATION_KEY,
      ),
    ).toHaveLength(2);
  });

  test("scrolls an activity notification to the activity section on each open", async ({
    page,
    request,
  }) => {
    await openNotificationWorkspace(page);
    await page.getByRole("link", { name: /Inbox/ }).click();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

    const row = page
      .locator(
        '[data-testid="notification-item"][data-workspace="odd_workspace"]',
      )
      .filter({ hasText: "REEF-001" });
    await expect(row).toHaveCount(1);
    await row.getByTestId("notification-open").click();

    const issueUrl = "/workspace/odd_workspace/issues/REEF-001#issue-activity";
    await expect(page).toHaveURL(issueUrl);
    const activityHeading = page.locator("#issue-activity > h3");
    await expect(activityHeading).toBeInViewport({ ratio: 0.5 });
    await expect
      .poll(async () => {
        const notification = workspaceVault(
          await readFixtureState(request),
          "odd_workspace",
        ).notifications.find(
          (candidate) => candidate.source_ref === "odd-workspace-activity",
        );
        return notification?.state;
      })
      .toBe("read");

    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(row).toHaveAttribute("data-state", "read");
    await row.getByTestId("notification-open").click();

    await expect(page).toHaveURL(issueUrl);
    await expect(activityHeading).toBeInViewport({ ratio: 0.5 });
  });

  test("keeps a global cap and changes only the selected source copy", async ({
    page,
    request,
  }) => {
    await openNotificationWorkspace(page);

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
      "/api/notifications?recipient=bob&vault=raw-vault&state=archived&limit=1",
    );
    expect(forgedRecipientResponse.ok()).toBe(true);
    const forgedRecipientBody = (await forgedRecipientResponse.json()) as {
      notifications: Array<{
        recipient: string;
        state: string;
        workspace: string;
      }>;
    };
    expect(
      forgedRecipientBody.notifications.filter(
        (item) => item.state === "unread",
      ),
    ).toHaveLength(100);
    expect(
      new Set(forgedRecipientBody.notifications.map((item) => item.recipient)),
    ).toEqual(new Set(["alice"]));

    await page.getByRole("link", { name: /Inbox/ }).click();
    await expect(page).toHaveURL(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(
      page.getByText(/Recent collaboration changes across your workspaces/),
    ).toBeVisible();
    await expect(page.getByText("Comment created")).toHaveCount(2);
    await expect(page.getByText("bob").first()).toBeVisible();
    const alphaRow = page
      .locator('[data-testid="notification-item"][data-workspace="reef-alpha"]')
      .filter({ hasText: "Comment created" });
    const primaryRow = page
      .locator(
        `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
      )
      .filter({ hasText: "Comment created" });
    await expect(alphaRow).toHaveCount(1);
    await expect(primaryRow).toHaveCount(1);
    const originalStatusRow = page
      .locator(
        `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
      )
      .filter({ hasText: "Todo" })
      .filter({ hasText: "Done" });
    await expect(originalStatusRow).toHaveCount(1);
    await expect(originalStatusRow).toContainText(
      "Primary source status event",
    );
    await expect(originalStatusRow).toContainText("Todo");
    await expect(originalStatusRow).toContainText("Done");
    await expect(
      page
        .locator(
          '[data-testid="notification-item"][data-workspace="reef-alpha"]',
        )
        .filter({ hasText: "Alpha workspace source issue" }),
    ).toHaveCount(1);
    const unavailableSourceRow = page
      .getByTestId("notification-item")
      .filter({ hasText: "Issue title unavailable" })
      .filter({ hasText: "Status change details unavailable" });
    await expect(unavailableSourceRow).toHaveCount(1);

    const rowsBeforeWorkspaceChange = await page
      .getByTestId("notification-item")
      .evaluateAll((rows) =>
        rows.map(
          (row) =>
            `${row.getAttribute("data-workspace")}:${row.getAttribute("data-notification-key")}:${row.getAttribute("data-state")}`,
        ),
      );
    await page.goto("/workspace/reef-alpha/inbox");
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("notification-item")
          .evaluateAll((rows) =>
            rows.map(
              (row) =>
                `${row.getAttribute("data-workspace")}:${row.getAttribute("data-notification-key")}:${row.getAttribute("data-state")}`,
            ),
          ),
      )
      .toEqual(rowsBeforeWorkspaceChange);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

    const openNotification = primaryRow.getByTestId("notification-open");
    await expect(openNotification).toBeVisible();

    await alphaRow.getByTestId("notification-open").click();
    await expect(page).toHaveURL(
      "/workspace/reef-alpha/issues/REEF-001#comment-comment-primary",
    );
    await expect(page.locator("#comment-comment-primary")).toContainText(
      "reef-alpha",
    );
    await expect
      .poll(
        async () =>
          alphaCommentNotification(await readFixtureState(request)).state,
      )
      .toBe("read");

    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

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
        .locator(
          `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
        )
        .filter({ hasText: "Comment created" })
        .getByRole("button", { name: "Mark REEF-001 in reef-e2e unread" }),
    ).toBeVisible();
    const reloadedPrimaryRow = page
      .locator(
        `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
      )
      .filter({ hasText: "Comment created" });
    await reloadedPrimaryRow
      .getByRole("button", { name: "Mark REEF-001 in reef-e2e unread" })
      .click();
    await expect
      .poll(
        async () => primaryNotification(await readFixtureState(request)).state,
      )
      .toBe("unread");

    await page
      .locator(
        `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
      )
      .filter({ hasText: "Comment created" })
      .getByRole("button", {
        name: "Archive notification for REEF-001 in reef-e2e",
      })
      .click();
    await expect
      .poll(
        async () => primaryNotification(await readFixtureState(request)).state,
      )
      .toBe("archived");
    await expect(
      page
        .locator(
          `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
        )
        .filter({ hasText: "Comment created" }),
    ).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("notification-inbox")).toBeVisible();
    await expect(
      page
        .locator(
          `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
        )
        .filter({ hasText: "Comment created" }),
    ).toHaveCount(0);

    const final = await readFixtureState(request);
    expect(reefVault(final).settings.schema_version).toBe("2");
    expect(alphaCommentNotification(final).state).toBe("read");
    expect(schemaMutationSql(final)).toEqual([]);
  });

  test("lets reader sessions read their inbox but preserves 403 and the session on PATCH", async ({
    page,
    request,
  }) => {
    await signInAsUser(page, fixtureReaderLogin);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("3");

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
      "/api/notifications?vault=raw-vault&state=archived&recipient=alice",
    );
    expect(visibleToReader.status()).toBe(200);
    const visibleBody = (await visibleToReader.json()) as {
      notifications: Array<{ recipient: string; state: string }>;
    };
    expect(
      visibleBody.notifications.filter((item) => item.state === "unread"),
    ).toHaveLength(3);
    expect(
      new Set(visibleBody.notifications.map((item) => item.recipient)),
    ).toEqual(new Set(["bob"]));

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

  test("shows permission guidance for a notification 403 and recovers without sign-out", async ({
    page,
    request,
  }) => {
    await signInAsUser(page, fixtureReaderLogin);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

    const beforeSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "__reef_session",
    );
    if (!beforeSession) throw new Error("reader session cookie was not set");

    await setNotificationControl(request, {
      schemaMode: "healthy",
      dataMode: "forbidden",
    });
    await page.reload();
    const error = page.getByTestId("notification-inbox-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/permission|access/i);

    await setNotificationControl(request, {
      schemaMode: "healthy",
      dataMode: "healthy",
    });
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    const afterSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "__reef_session",
    );
    expect(afterSession?.value).toBe(beforeSession.value);
  });

  test("shows permission guidance for denied read and archive actions without changing state", async ({
    page,
    request,
  }) => {
    await signInAsUser(page, fixtureReaderLogin);
    await page.goto(`/workspace/${REEF_E2E_VAULT}/inbox`);
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();

    const row = page
      .locator(
        `[data-testid="notification-item"][data-workspace="${REEF_E2E_VAULT}"]`,
      )
      .filter({ hasText: "Comment created" });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-state", "unread");
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("3");
    const beforeSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "__reef_session",
    );
    if (!beforeSession) throw new Error("reader session cookie was not set");

    await setNotificationControl(request, {
      schemaMode: "healthy",
      dataMode: "forbidden",
    });
    const actionError = page
      .getByTestId("notification-inbox")
      .getByRole("alert");
    await row.getByTestId("notification-open").click();
    await expect(actionError).toContainText(
      "You don't have permission to change this notification",
    );
    await expect(row).toHaveAttribute("data-state", "unread");
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("3");
    await expect(page).toHaveURL(`/workspace/${REEF_E2E_VAULT}/inbox`);

    await row
      .getByRole("button", {
        name: "Archive notification for REEF-001 in reef-e2e",
      })
      .click();
    await expect(actionError).toContainText(
      "You don't have permission to change this notification",
    );
    await expect(row).toHaveAttribute("data-state", "unread");
    await expect(page.getByTestId("inbox-unread-badge")).toHaveText("3");
    const afterSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "__reef_session",
    );
    expect(afterSession?.value).toBe(beforeSession.value);
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

  test("surfaces notification SQL and data failures instead of returning empty success", async ({
    page,
    request,
  }) => {
    await openNotificationWorkspace(page);
    const initial = await readFixtureState(request);
    const initialSettings = { ...reefVault(initial).settings };

    for (const schemaMode of ["missing", "incompatible"] as const) {
      await setNotificationControl(request, {
        vault: "reef-alpha",
        schemaMode,
      });
      const response = await page.request.get("/api/notifications");
      const body = (await response.json()) as {
        error?: string;
        notifications?: Array<{ workspace: string }>;
      };
      expect(response.ok(), JSON.stringify(body)).toBe(false);
      expect(body).toEqual(
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(body).not.toHaveProperty("notifications");
      await setNotificationControl(request, { vault: "reef-alpha" });
    }

    const controls = [
      { vault: "reef-alpha", dataMode: "forbidden" as const },
      { vault: "reef-alpha", dataMode: "error" as const },
    ];
    try {
      for (const control of controls) {
        await setNotificationControl(request, control);
        const response = await page.request.get(
          "/api/notifications?vault=raw-vault&state=unread&recipient=bob",
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

  test("uses active inventory and retries workspace discovery and source errors", async ({
    page,
    request,
  }) => {
    await openNotificationWorkspace(page);
    await page.getByRole("link", { name: /Inbox/ }).click();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    const persistedQueryKeys = await page.evaluate(() => {
      const serialized = window.localStorage.getItem(
        "REACT_QUERY_OFFLINE_CACHE",
      );
      if (!serialized) return [];
      const cache = JSON.parse(serialized) as {
        clientState?: {
          queries?: Array<{ queryKey?: unknown }>;
        };
      };
      return (cache.clientState?.queries ?? []).map(({ queryKey }) => queryKey);
    });
    expect(persistedQueryKeys).not.toContainEqual([
      "notifications",
      "personal",
      "alice",
    ]);

    const error = page.getByTestId("notification-inbox-error");
    const expectFailureThenRetry = async (
      label: string,
      fail: () => Promise<void>,
      recover: () => Promise<void>,
    ) => {
      await fail();
      const failedRead = await page.request.get("/api/notifications");
      const failedBody = (await failedRead.json()) as Record<string, unknown>;
      expect(failedRead.status(), label).not.toBe(200);
      expect(failedBody).toEqual(
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(failedBody).not.toHaveProperty("notifications");
      const reloadResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/notifications" &&
          response.request().method() === "GET" &&
          response.status() !== 200,
      );
      await page.evaluate(() =>
        window.localStorage.removeItem("REACT_QUERY_OFFLINE_CACHE"),
      );
      await page.reload();
      const reloadResponse = await reloadResponsePromise;
      expect(reloadResponse.status(), `${label} on page load`).not.toBe(200);
      await expect(error, label).toBeVisible();
      await expect(page.getByTestId("notification-inbox-list")).toHaveCount(0);
      await expect(page.getByTestId("inbox-unread-badge")).toHaveCount(0);
      await recover();
      await error.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
      await expect(page.getByTestId("inbox-unread-badge")).toHaveText("9+");
    };

    await expectFailureThenRetry(
      "workspace discovery failure",
      () => setVaultListControl(request, { failures: 20 }),
      () => setVaultListControl(request, {}),
    );
    // Admin inventory is the authoritative active scope; detail diagnostics
    // are no longer a dependency of the personal read.
    await setInstallationControl(request, {
      vault: "reef-alpha",
      detailLookup: "forbidden",
    });
    const activeInventoryRead = await page.request.get("/api/notifications");
    expect(activeInventoryRead.ok()).toBe(true);
    expect(await activeInventoryRead.json()).toEqual(
      expect.objectContaining({
        notifications: expect.arrayContaining([
          expect.objectContaining({ workspace: "reef-alpha" }),
        ]),
      }),
    );
    await setInstallationControl(request, {
      vault: "reef-alpha",
      detailLookup: "healthy",
    });
    await expectFailureThenRetry(
      "source data failure",
      () =>
        setNotificationControl(request, {
          vault: "reef-alpha",
          dataMode: "error",
        }),
      () => setNotificationControl(request, { vault: "reef-alpha" }),
    );
  });

  test("excludes an inaccessible source workspace and restores it after access returns", async ({
    page,
    request,
  }) => {
    await openNotificationWorkspace(page);
    await page.getByRole("link", { name: /Inbox/ }).click();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="notification-item"][data-workspace="reef-alpha"]',
      ),
    ).toHaveCount(2);

    await setNotificationControl(request, {
      vault: "reef-alpha",
      role: "none",
    });
    await page.reload();
    await expect(page.getByTestId("notification-inbox-list")).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="notification-item"][data-workspace="reef-alpha"]',
      ),
    ).toHaveCount(0);
    const vaultsResponse = await page.request.get("/api/vaults");
    const vaultsBody = (await vaultsResponse.json()) as {
      vaults: Array<{ name: string }>;
    };
    expect(vaultsBody.vaults.some(({ name }) => name === "reef-alpha")).toBe(
      false,
    );

    await setNotificationControl(request, {
      vault: "reef-alpha",
      role: "owner",
    });
    await page.reload();
    await expect(
      page.locator(
        '[data-testid="notification-item"][data-workspace="reef-alpha"]',
      ),
    ).toHaveCount(2);
  });

  test("opens an issue-body mention at the description and persists read state", async ({
    page,
    request,
  }) => {
    await openNotificationWorkspace(page);
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
