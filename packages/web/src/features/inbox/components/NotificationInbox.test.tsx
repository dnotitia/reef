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
      occurred_at: string;
      state: "unread" | "read" | "archived";
    }>,
    unreadCount: 0,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({ vault: "reef-acme", isLoading: false }),
}));

vi.mock("../hooks/useInboxNotifications", () => ({
  useInboxNotifications: () => mocks.inboxState,
  useUpdateNotificationState: () => ({ mutateAsync: mocks.mutateAsync }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

function makeNotification(
  key: string,
  state: "unread" | "read",
  issue: string,
) {
  return {
    id: `00000000-0000-4000-8000-${key.padStart(12, "0")}`,
    notification_key: `notification:5:alice:8:activity:${key.length}:${key}`,
    recipient: "alice",
    reef_id: issue,
    source_type: "activity",
    source_ref: `event-${key}`,
    event_type: "comment_created",
    actor: "bob",
    occurred_at: "2026-07-28T00:00:00.000Z",
    state,
  };
}

function renderPage() {
  return render(
    <IntlTestProvider>
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
    mocks.mutateAsync.mockResolvedValue({});
  });

  it("renders event, actor, issue, occurred time, and read state", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getAllByTestId("notification-item")).toHaveLength(2);
    expect(screen.getAllByText("Comment created")).toHaveLength(2);
    expect(screen.getAllByText("bob")).toHaveLength(2);
    expect(screen.getByText("REEF-001")).toBeInTheDocument();
    expect(screen.getByText("Unread")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("marks an unread notification read before opening its issue activity", async () => {
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Open activity for REEF-001" }),
    );

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        notificationKey: "notification:5:alice:8:activity:1:1",
        state: "read",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-001#issue-activity",
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

    fireEvent.click(
      screen.getByRole("button", { name: "Open activity for REEF-003" }),
    );

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
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

    fireEvent.click(
      screen.getByRole("button", { name: "Open activity for REEF-004" }),
    );

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues/REEF-004#issue-activity",
      ),
    );
  });

  it("offers mark unread and archive as server state actions", async () => {
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Mark REEF-002 unread" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Archive notification for REEF-001" }),
    );

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        notificationKey: "notification:5:alice:8:activity:1:1",
        state: "archived",
      }),
    );
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      notificationKey: "notification:5:alice:8:activity:1:2",
      state: "unread",
    });
  });

  it("shows loading, error, and empty states", () => {
    mocks.inboxState.isLoading = true;
    const { rerender } = renderPage();
    expect(
      screen.getByTestId("notification-inbox-loading"),
    ).toBeInTheDocument();

    mocks.inboxState.isLoading = false;
    mocks.inboxState.isError = true;
    rerender(
      <IntlTestProvider>
        <NotificationInboxPage />
      </IntlTestProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load your notifications",
    );

    mocks.inboxState.isError = false;
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
});
