import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationInboxPage } from "./NotificationInbox";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  mutateAsync: vi.fn(),
  markAllMutateAsync: vi.fn(),
  inboxState: {
    notifications: [] as Array<{
      id: string;
      notification_key: string;
      recipient: string;
      reef_id: string;
      source_type: string;
      source_ref: string;
      event_type: string;
      actor: string;
      workspace: string;
      occurred_at: string;
      state: "unread" | "read" | "archived";
      issue_context:
        | { availability: "available"; title: string }
        | { availability: "unavailable"; title: null };
      status_change_context:
        | { availability: "available"; from: string; to: string }
        | { availability: "unavailable"; from: null; to: null }
        | null;
    }>,
    unreadCount: 0,
    isLoading: false,
    isError: false,
    isPermissionDenied: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));

vi.mock("../hooks/useInboxNotifications", () => ({
  useInboxNotifications: () => mocks.inboxState,
  useUpdateNotificationState: () => ({ mutateAsync: mocks.mutateAsync }),
  useMarkAllPersonalNotificationsRead: () => ({
    mutateAsync: mocks.markAllMutateAsync,
    isPending: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

function makeNotification(
  key: string,
  state: "unread" | "read",
  issue: string,
  overrides: Partial<{
    source_type: string;
    source_ref: string;
    event_type: string;
    actor: string;
    workspace: string;
    issue_context:
      | { availability: "available"; title: string }
      | { availability: "unavailable"; title: null };
    status_change_context:
      | { availability: "available"; from: string; to: string }
      | { availability: "unavailable"; from: null; to: null }
      | null;
  }> = {},
) {
  return {
    id: `00000000-0000-4000-8000-${key.padStart(12, "0")}`,
    notification_key: `notification:5:alice:8:activity:${key.length}:${key}`,
    recipient: "alice",
    reef_id: issue,
    source_type: overrides.source_type ?? "activity",
    source_ref: overrides.source_ref ?? `event-${key}`,
    event_type: overrides.event_type ?? "comment_created",
    actor: overrides.actor ?? "bob",
    workspace: overrides.workspace ?? "reef-acme",
    issue_context: overrides.issue_context ?? {
      availability: "available",
      title: `Title for ${issue}`,
    },
    status_change_context: overrides.status_change_context ?? null,
    occurred_at: "2026-07-28T00:00:00.000Z",
    state,
  };
}

function renderPage(locale: "en" | "ko" = "en") {
  return render(
    <IntlTestProvider locale={locale}>
      <NotificationInboxPage />
    </IntlTestProvider>,
  );
}

describe("NotificationInboxPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inboxState.notifications = [
      makeNotification("1", "unread", "REEF-001"),
      makeNotification("2", "read", "REEF-002"),
    ];
    mocks.inboxState.isLoading = false;
    mocks.inboxState.isError = false;
    mocks.inboxState.isPermissionDenied = false;
    mocks.markAllMutateAsync.mockResolvedValue({
      targets: [],
      completed: [],
      unresolved: [],
    });
    mocks.mutateAsync.mockResolvedValue({});
  });

  it("renders event, actor, issue, occurred time, and read state", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getAllByTestId("notification-item")).toHaveLength(2);
    expect(screen.getAllByText("Comment created")).toHaveLength(2);
    expect(screen.getAllByText("bob")).toHaveLength(2);
    expect(screen.getByText("REEF-001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    const time = screen
      .getAllByTestId("notification-item")[0]
      .querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-07-28T00:00:00.000Z");
    expect(time).toHaveTextContent("Jul 28, 2026, 00:00");
    expect(time).toHaveAttribute("title", "Jul 28, 2026, 00:00");
  });

  it("prioritizes source issue titles and original status transitions, with explicit unavailable states", () => {
    mocks.inboxState.notifications = [
      makeNotification("status", "unread", "REEF-001", {
        event_type: "status_change",
        issue_context: {
          availability: "available",
          title: "A long issue title that must wrap instead of disappearing",
        },
        status_change_context: {
          availability: "available",
          from: "todo",
          to: "in_progress",
        },
      }),
      makeNotification("missing", "read", "REEF-002", {
        event_type: "status_change",
        issue_context: { availability: "unavailable", title: null },
        status_change_context: {
          availability: "unavailable",
          from: null,
          to: null,
        },
      }),
    ];
    renderPage();

    const [availableRow, unavailableRow] =
      screen.getAllByTestId("notification-item");
    expect(availableRow?.textContent?.indexOf("REEF-001")).toBeLessThan(
      availableRow?.textContent?.indexOf(
        "A long issue title that must wrap instead of disappearing",
      ),
    );
    expect(
      within(availableRow as HTMLElement).getByText("Todo"),
    ).toBeInTheDocument();
    expect(
      within(availableRow as HTMLElement).getByText("In Progress"),
    ).toBeInTheDocument();
    expect(
      within(availableRow as HTMLElement).getByText("Status changed"),
    ).toBeInTheDocument();
    expect(
      within(availableRow as HTMLElement).getByTestId("notification-open"),
    ).toHaveAccessibleName(
      /REEF-001\s*A long issue title that must wrap instead of disappearing\s*Status changed\s*Todo\s*In Progress\s*bob\s*reef-acme\s*Jul 28, 2026, 00:00\s*Unread/u,
    );
    expect(
      within(unavailableRow as HTMLElement).getByText(
        "Issue title unavailable",
      ),
    ).toBeInTheDocument();
    expect(
      within(unavailableRow as HTMLElement).getByText(
        "Status change details unavailable",
      ),
    ).toBeInTheDocument();
    expect(
      within(unavailableRow as HTMLElement).queryByText("Todo"),
    ).toBeNull();
    expect(
      screen.getByText(
        "Recent collaboration changes across your workspaces · up to 100 unread and 100 read notifications.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps matching notification keys distinct by source workspace", async () => {
    mocks.inboxState.notifications = [
      makeNotification("duplicate", "unread", "REEF-001"),
      makeNotification("duplicate", "unread", "REEF-001", {
        workspace: "odd_workspace",
      }),
    ];
    renderPage();

    expect(screen.getAllByTestId("notification-item")).toHaveLength(2);
    expect(
      screen
        .getAllByTestId("notification-workspace")
        .map((item) => item.textContent),
    ).toEqual(["reef-acme", "odd_workspace"]);
    const oddWorkspaceRow = screen
      .getAllByTestId("notification-item")
      .find((row) => row.getAttribute("data-workspace") === "odd_workspace");
    fireEvent.click(
      within(oddWorkspaceRow as HTMLElement).getByTestId("notification-open"),
    );

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        workspace: "odd_workspace",
        notificationKey: "notification:5:alice:8:activity:9:duplicate",
        state: "read",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/workspace/odd_workspace/issues/REEF-001#issue-activity",
    );
  });

  it("marks an unread notification read before opening its issue activity", async () => {
    const read = Promise.withResolvers<object>();
    mocks.mutateAsync.mockReturnValueOnce(read.promise);
    renderPage();

    const firstRow = screen.getAllByTestId("notification-item")[0];
    fireEvent.click(
      within(firstRow as HTMLElement).getByTestId("notification-open"),
    );

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        workspace: "reef-acme",
        notificationKey: "notification:5:alice:8:activity:1:1",
        state: "read",
      }),
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(
      within(firstRow as HTMLElement).getByTestId("notification-open"),
    ).toBeDisabled();
    read.resolve({});
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
    expect(mocks.push).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-001#issue-activity",
    );
  });

  it("uses the localized issue-body mention label and description target", async () => {
    mocks.inboxState.notifications = [
      makeNotification("mention", "unread", "REEF-003", {
        source_ref: "issue_body_mentions_change:document-commit-1",
        event_type: "issue_body_mentions_change",
      }),
    ];
    renderPage();

    expect(
      screen.getByText("You were mentioned in an issue"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("notification-open"));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        workspace: "reef-acme",
        notificationKey: "notification:5:alice:8:activity:7:mention",
        state: "read",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-003#issue-description",
    );
  });

  it("localizes the issue-body mention label in Korean", () => {
    mocks.inboxState.notifications = [
      makeNotification("mention-ko", "read", "REEF-004", {
        event_type: "issue_body_mentions_change",
      }),
    ];
    renderPage("ko");

    expect(
      screen.getByText("이슈 본문에서 멘션되었습니다"),
    ).toBeInTheDocument();
  });

  it("does not navigate when marking an unread notification read fails", async () => {
    mocks.inboxState.notifications = [
      makeNotification("failed", "unread", "REEF-005"),
    ];
    mocks.mutateAsync.mockRejectedValueOnce(new Error("read failed"));
    renderPage();

    fireEvent.click(screen.getByTestId("notification-open"));

    await waitFor(() => expect(mocks.push).not.toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't update this notification. Try again.",
    );
  });

  it("shows permission guidance when marking an unread notification read is denied", async () => {
    mocks.inboxState.notifications = [
      makeNotification("denied-read", "unread", "REEF-005"),
    ];
    mocks.mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { status: 403 }),
    );
    renderPage();

    fireEvent.click(screen.getByTestId("notification-open"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You don't have permission to change this notification",
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("shows permission guidance when archiving a notification is denied", async () => {
    mocks.inboxState.notifications = [
      makeNotification("denied-archive", "unread", "REEF-006"),
    ];
    mocks.mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { status: 403 }),
    );
    renderPage();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Archive notification for REEF-006 in reef-acme",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You don't have permission to change this notification",
      ),
    );
    expect(screen.getByTestId("notification-item")).toHaveAttribute(
      "data-state",
      "unread",
    );
  });

  it("opens a comment notification at its persisted source comment after marking it read", async () => {
    mocks.inboxState.notifications = [
      {
        ...makeNotification("3", "unread", "REEF-003"),
        source_type: "comment",
        source_ref: "comment-primary",
      },
    ];
    renderPage();

    fireEvent.click(screen.getByTestId("notification-open"));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        workspace: "reef-acme",
        notificationKey: "notification:5:alice:8:activity:1:3",
        state: "read",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-003#comment-comment-primary",
    );
  });

  it("falls back to the issue activity anchor for a malformed comment source", async () => {
    mocks.inboxState.notifications = [
      {
        ...makeNotification("4", "read", "REEF-004"),
        source_type: "comment",
        source_ref: "comment/with-invalid-target",
      },
    ];
    renderPage();

    fireEvent.click(screen.getByTestId("notification-open"));

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues/REEF-004#issue-activity",
      ),
    );
  });

  it("offers mark unread and archive as server state actions", async () => {
    renderPage();

    for (const name of [
      "Mark REEF-002 in reef-acme unread",
      "Archive notification for REEF-001 in reef-acme",
      "Archive notification for REEF-002 in reef-acme",
    ]) {
      expect(screen.getByRole("button", { name })).not.toHaveClass(
        "[@media(pointer:coarse)]:min-w-11",
      );
    }

    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark REEF-002 in reef-acme unread",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Archive notification for REEF-001 in reef-acme",
      }),
    );

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        workspace: "reef-acme",
        notificationKey: "notification:5:alice:8:activity:1:1",
        state: "archived",
      }),
    );
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      workspace: "reef-acme",
      notificationKey: "notification:5:alice:8:activity:1:2",
      state: "unread",
    });
  });

  it("disables only the row whose state transition is in flight", async () => {
    let resolveMutation: (() => void) | undefined;
    mocks.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = () => resolve({});
        }),
    );
    renderPage();

    const rows = screen.getAllByTestId("notification-item");
    const busyRow = rows[0];
    const idleRow = rows[1];
    const busyArchive = within(busyRow).getByRole("button", {
      name: "Archive notification for REEF-001 in reef-acme",
    });
    const idleOpen = within(idleRow).getByTestId("notification-open");

    fireEvent.click(busyArchive);
    expect(busyArchive).toBeDisabled();
    expect(busyArchive).toHaveAttribute("aria-busy", "true");
    expect(idleOpen).toBeEnabled();

    resolveMutation?.();
    await waitFor(() => expect(busyArchive).toBeEnabled());
  });

  it("shows loading, error, and empty states", () => {
    mocks.inboxState.isLoading = true;
    const { rerender } = renderPage();
    expect(
      screen.getByTestId("notification-inbox-loading"),
    ).toBeInTheDocument();

    mocks.inboxState.isLoading = false;
    mocks.inboxState.isError = true;
    mocks.inboxState.isPermissionDenied = false;
    rerender(
      <IntlTestProvider>
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load your notifications",
    );

    mocks.inboxState.isPermissionDenied = true;
    rerender(
      <IntlTestProvider>
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You don't have permission to view these notifications",
    );

    mocks.inboxState.isError = false;
    mocks.inboxState.isPermissionDenied = false;
    mocks.inboxState.notifications = [];
    rerender(
      <IntlTestProvider>
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    const empty = screen.getByTestId("notification-inbox-empty");
    expect(empty).toHaveTextContent("You’re all caught up");
    expect(empty).toHaveClass(
      "mx-auto",
      "min-h-48",
      "w-full",
      "max-w-4xl",
      "rounded-lg",
      "border-dashed",
      "border-border-subtle",
      "bg-surface-subtle",
      "px-6",
      "py-12",
    );
    expect(empty.querySelector('[data-slot="empty-state-icon"]')).toBeNull();
    expect(within(empty).queryByRole("button")).not.toBeInTheDocument();

    mocks.inboxState.notifications = [
      makeNotification("3", "read", "REEF-003"),
    ];
    rerender(
      <IntlTestProvider>
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    expect(screen.getByTestId("notification-inbox-list")).toHaveClass(
      "max-w-2xl",
    );
  });

  it("defaults to All and keeps the selected filter through a failed read and retry", () => {
    const { rerender } = renderPage();
    const unreadFilter = screen.getByRole("button", { name: "Unread" });

    expect(screen.getAllByTestId("notification-item")).toHaveLength(2);
    expect(unreadFilter).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(unreadFilter);
    expect(unreadFilter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("notification-item")).toHaveLength(1);

    mocks.inboxState.isError = true;
    rerender(
      <IntlTestProvider>
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.inboxState.refetch).toHaveBeenCalledOnce();

    mocks.inboxState.isError = false;
    rerender(
      <IntlTestProvider>
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByTestId("notification-item")).toHaveLength(1);
  });

  it("shows confirmed bulk results and retries only the original unresolved identities", async () => {
    const alpha = makeNotification("same", "unread", "REEF-001", {
      workspace: "reef-alpha",
    });
    const zeta = makeNotification("same", "unread", "REEF-002", {
      workspace: "reef-zeta",
    });
    const targets = [
      { workspace: alpha.workspace, notification_key: alpha.notification_key },
      { workspace: zeta.workspace, notification_key: zeta.notification_key },
    ];
    mocks.inboxState.notifications = [alpha, zeta];
    mocks.markAllMutateAsync
      .mockResolvedValueOnce({
        targets,
        completed: [
          {
            ...targets[0],
            state: "read",
            read_at: "2026-10-15T14:00:00.000Z",
          },
        ],
        unresolved: [targets[1]],
      })
      .mockResolvedValueOnce({
        targets: [targets[1]],
        completed: [
          {
            ...targets[1],
            state: "read",
            read_at: "2026-10-15T14:01:00.000Z",
          },
        ],
        unresolved: [],
      });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Marked 1 notifications as read. 1 need to be retried.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry 1 remaining" }));

    await waitFor(() =>
      expect(mocks.markAllMutateAsync).toHaveBeenNthCalledWith(2, {
        targets: [targets[1]],
      }),
    );
    expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Marked 2 notifications as read.",
    );
  });

  it("reports an empty server snapshot and restores focus when filtering removes an item", async () => {
    mocks.markAllMutateAsync.mockResolvedValueOnce({
      targets: [],
      completed: [],
      unresolved: [],
    });
    const { rerender } = renderPage("ko");
    const unreadFilter = screen.getByRole("button", { name: "읽지 않음" });
    fireEvent.click(screen.getByRole("button", { name: "모두 읽기" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "읽음 처리할 미확인 알림이 없습니다.",
      ),
    );

    fireEvent.click(unreadFilter);
    fireEvent.click(
      screen.getByRole("button", {
        name: "reef-acme의 REEF-001 알림 보관",
      }),
    );
    await waitFor(() => expect(document.activeElement).toBe(unreadFilter));

    mocks.inboxState.notifications = [
      makeNotification("3", "read", "REEF-003"),
    ];
    rerender(
      <IntlTestProvider locale="ko">
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    expect(screen.getByTestId("notification-inbox-empty")).toHaveTextContent(
      "읽지 않은 알림이 없습니다",
    );
  });
});
