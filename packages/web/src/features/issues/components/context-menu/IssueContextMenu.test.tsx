import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { IssueListItem, PlanningCatalog } from "@reef/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/locales";
import { IssueContextMenu } from "./IssueContextMenu";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
}));

vi.mock("@/features/issues/hooks/mutations/useUpdateIssue", () => ({
  useUpdateIssue: () => ({
    isPending: false,
    mutateAsync: mocks.update,
  }),
}));

vi.mock("@/features/issues/hooks/mutations/useArchiveIssue", () => ({
  useArchiveIssue: () => ({
    isPending: false,
    archive: mocks.archive,
    unarchive: mocks.unarchive,
  }),
}));

const issue: IssueListItem = {
  id: "REEF-001",
  title: "Context menu issue",
  status: "todo",
  priority: "high",
  assigned_to: "alice",
  sprint_id: "11111111-1111-4111-8111-111111111111",
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-01-01T00:00:00.000Z",
  updated_by: "alice",
};

const planningCatalog: PlanningCatalog = {
  sprints: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Sprint One",
      status: "active",
      start_date: null,
      end_date: null,
      goal: "",
      capacity_points: null,
    },
  ],
  milestones: [],
  releases: [],
};

function renderMenu({ locale = "en" as Locale, archived = false } = {}) {
  const nextIssue = archived
    ? { ...issue, archived_at: "2026-01-02T00:00:00.000Z" }
    : issue;
  return render(
    <IntlTestProvider locale={locale}>
      <IssueContextMenu
        issue={nextIssue}
        vault="reef-test"
        currentLogin="alice"
        planningCatalog={planningCatalog}
        assignees={[
          { login: "alice", name: "Alice Kim", avatar_url: null },
          { login: "bob", name: "Bob Park", avatar_url: null },
        ]}
      >
        <button type="button" data-testid="issue-context-menu-trigger">
          Issue
        </button>
      </IssueContextMenu>
    </IntlTestProvider>,
  );
}

async function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("issue-context-menu-trigger"), {
    clientX: 40,
    clientY: 40,
  });
  expect(screen.getByRole("menu")).toBeInTheDocument();
}

async function openSubmenu(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.hover(screen.getByRole("menuitem", { name: label }));
  await waitFor(() =>
    expect(screen.getByRole("menu", { name: label })).toBeInTheDocument(),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IssueContextMenu", () => {
  it("opens from pointer, Shift+F10, and Menu key events", async () => {
    const user = userEvent.setup();
    renderMenu();

    await openMenu();
    await user.keyboard("{Escape}");

    const trigger = screen.getByTestId("issue-context-menu-trigger");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    fireEvent.keyDown(trigger, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("patches changed status, priority, assignee, and sprint values but not no-ops", async () => {
    const user = userEvent.setup();
    mocks.update.mockResolvedValue({ issue, content: "" });
    renderMenu();

    await openMenu();
    await openSubmenu(user, "Status");
    fireEvent.click(screen.getByTestId("issue-context-menu-status-todo"));
    expect(mocks.update).not.toHaveBeenCalled();

    await openMenu();
    await openSubmenu(user, "Status");
    fireEvent.click(screen.getByTestId("issue-context-menu-status-done"));
    expect(mocks.update).toHaveBeenLastCalledWith({
      id: issue.id,
      vault: "reef-test",
      patch: { status: "done" },
    });

    await openMenu();
    await openSubmenu(user, "Priority");
    fireEvent.click(screen.getByTestId("issue-context-menu-priority-none"));
    expect(mocks.update).toHaveBeenLastCalledWith({
      id: issue.id,
      vault: "reef-test",
      patch: { priority: null },
    });

    await openMenu();
    await openSubmenu(user, "Assignee");
    fireEvent.click(screen.getByTestId("issue-context-menu-assignee-bob"));
    expect(mocks.update).toHaveBeenLastCalledWith({
      id: issue.id,
      vault: "reef-test",
      patch: { assigned_to: "bob" },
    });

    await openMenu();
    await openSubmenu(user, "Sprint");
    fireEvent.click(screen.getByTestId("issue-context-menu-sprint-none"));
    expect(mocks.update).toHaveBeenLastCalledWith({
      id: issue.id,
      vault: "reef-test",
      patch: { sprint_id: null },
    });
  });

  it("renders shared field leaves, current checks, and distinct parent meanings", async () => {
    const user = userEvent.setup();
    renderMenu();

    await openMenu();

    const statusParent = screen.getByRole("menuitem", { name: "Status" });
    const priorityParent = screen.getByRole("menuitem", { name: "Priority" });
    expect(
      statusParent.querySelector("svg.text-status-open"),
    ).toBeInTheDocument();
    expect(
      priorityParent.querySelector("svg.text-status-open"),
    ).not.toBeInTheDocument();
    expect(
      priorityParent.querySelector('[aria-hidden="true"]'),
    ).toBeInTheDocument();

    await openSubmenu(user, "Status");
    const statusOption = screen.getByTestId("issue-context-menu-status-todo");
    expect(statusOption).toHaveTextContent("Todo");
    expect(statusOption.querySelector("svg")).toBeInTheDocument();
    expect(statusOption).toHaveAttribute("aria-checked", "true");

    await user.keyboard("{Escape}");
    await openMenu();
    await openSubmenu(user, "Priority");
    const priorityOption = screen.getByTestId(
      "issue-context-menu-priority-high",
    );
    expect(priorityOption).toHaveTextContent("High");
    expect(
      priorityOption.querySelector('[aria-hidden="true"]'),
    ).toBeInTheDocument();
    expect(priorityOption).toHaveAttribute("aria-checked", "true");

    await user.keyboard("{Escape}");
    await openMenu();
    await openSubmenu(user, "Assignee");
    const assigneeOption = screen.getByTestId(
      "issue-context-menu-assignee-alice",
    );
    expect(assigneeOption).toHaveTextContent("Alice Kim");
    expect(assigneeOption).toHaveTextContent("@alice");
    expect(
      assigneeOption.querySelector('[aria-hidden="true"]'),
    ).toBeInTheDocument();
    expect(assigneeOption).toHaveAttribute("aria-checked", "true");

    await user.keyboard("{Escape}");
    await openMenu();
    await openSubmenu(user, "Sprint");
    const sprintOption = screen.getByTestId(
      "issue-context-menu-sprint-11111111-1111-4111-8111-111111111111",
    );
    expect(sprintOption).toHaveTextContent("Sprint One");
    expect(sprintOption).toHaveTextContent("Active");
    expect(
      sprintOption.querySelector('[aria-hidden="true"]'),
    ).toBeInTheDocument();
    expect(sprintOption).toHaveAttribute("aria-checked", "true");
  });

  it("uses a neutral no-priority parent and option leaf", async () => {
    const user = userEvent.setup();
    render(
      <IntlTestProvider locale="en">
        <IssueContextMenu
          issue={{ ...issue, priority: null }}
          vault="reef-test"
          currentLogin="alice"
          planningCatalog={planningCatalog}
          assignees={[]}
        >
          <button type="button" data-testid="issue-context-menu-trigger">
            Issue
          </button>
        </IssueContextMenu>
      </IntlTestProvider>,
    );

    await openMenu();
    const priorityParent = screen.getByRole("menuitem", { name: "Priority" });
    expect(priorityParent).toHaveTextContent("Priority");
    expect(priorityParent).toHaveTextContent("No priority");

    await openSubmenu(user, "Priority");
    const noneOption = screen.getByTestId("issue-context-menu-priority-none");
    expect(noneOption).toHaveTextContent("No priority");
    expect(noneOption).toHaveAttribute("aria-checked", "true");
  });

  it("requires the existing close-reason dialog before patching a closed status", async () => {
    const user = userEvent.setup();
    mocks.update.mockResolvedValue({ issue, content: "" });
    renderMenu();

    await openMenu();
    await openSubmenu(user, "Status");
    fireEvent.click(screen.getByTestId("issue-context-menu-status-closed"));
    expect(screen.getByTestId("close-issue-dialog")).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("close-issue-confirm"));
    expect(mocks.update).toHaveBeenLastCalledWith({
      id: issue.id,
      vault: "reef-test",
      patch: { status: "closed", closed_reason: "completed" },
    });
  });

  it("copies canonical link and ID, and exposes only the current archive action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderMenu();

    await openMenu();
    await user.click(screen.getByTestId("issue-context-menu-copy-link"));
    expect(writeText).toHaveBeenLastCalledWith(
      "http://localhost:3000/workspace/reef-test/issues/REEF-001",
    );

    await openMenu();
    await user.click(screen.getByTestId("issue-context-menu-copy-id"));
    expect(writeText).toHaveBeenLastCalledWith("REEF-001");

    await openMenu();
    expect(screen.getByTestId("issue-context-menu-archive")).toHaveTextContent(
      "Archive",
    );
  });

  it("runs archive and unarchive through the existing mutations", async () => {
    const user = userEvent.setup();
    mocks.archive.mockResolvedValue({ issue, content: "" });
    mocks.unarchive.mockResolvedValue({ issue, content: "" });
    renderMenu();

    await openMenu();
    await user.click(screen.getByTestId("issue-context-menu-archive"));
    await waitFor(() =>
      expect(mocks.archive).toHaveBeenCalledWith({
        id: issue.id,
        vault: "reef-test",
      }),
    );

    cleanup();
    renderMenu({ archived: true });
    await openMenu();
    await user.click(screen.getByTestId("issue-context-menu-archive"));
    await waitFor(() =>
      expect(mocks.unarchive).toHaveBeenCalledWith({
        id: issue.id,
        vault: "reef-test",
      }),
    );
  });

  it("uses translated menu copy", async () => {
    renderMenu({ locale: "ko" });
    await openMenu();

    expect(screen.getByRole("menuitem", { name: "상태" })).toBeInTheDocument();
    expect(
      screen.getByTestId("issue-context-menu-copy-link"),
    ).toHaveTextContent("링크 복사");
    expect(screen.getByTestId("issue-context-menu-copy-id")).toHaveTextContent(
      "ID 복사",
    );
  });
});
