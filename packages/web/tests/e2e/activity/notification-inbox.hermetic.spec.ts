import { expect, test, type Page } from "@playwright/test";
import {
  REEF_E2E_VAULT,
  fixtureReaderLogin,
  fixtureWriterLogin,
  continueToWorkspace,
  readFixtureState,
  resetFixture,
  setNotificationControl,
  setInstallationControl,
  setVaultListControl,
  signInAsAlice,
  signInAsUser,
} from "../harness/fixture";

const DUPLICATE_COMMENT_NOTIFICATION_KEY =
  "notification:5:alice:7:comment:15:comment-primary";

async function openNotificationWorkspace(page: Page): Promise<void> {
  await signInAsAlice(page);
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
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "notifications_personal");
  });

  test("lists the actor's personal notifications without a selected vault", async ({
    page,
  }) => {
    await signInAsAlice(page);

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
    await expect(page.getByText(/Across ready workspaces/)).toBeVisible();
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

    const openNotification = primaryRow.getByRole("button", {
      name: /Open activity for REEF-001 in reef-e2e|reef-e2e의 REEF-001 활동 열기/u,
    });
    await expect(openNotification).toBeVisible();

    await alphaRow
      .getByRole("button", {
        name: /Open activity for REEF-001 in reef-alpha|reef-alpha의 REEF-001 활동 열기/u,
      })
      .click();
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

  test("surfaces notification readiness and data failures instead of returning empty success", async ({
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
      expect(response.status(), JSON.stringify(body)).toBe(409);
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

  test("fails closed and retries workspace discovery, readiness, and source errors", async ({
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
    await expectFailureThenRetry(
      "workspace readiness failure",
      () =>
        setInstallationControl(request, {
          vault: "reef-alpha",
          detailLookup: "forbidden",
        }),
      () =>
        setInstallationControl(request, {
          vault: "reef-alpha",
          detailLookup: "healthy",
        }),
    );
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
