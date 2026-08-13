import type { IssueMetadata } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeAll } from "../../stores/issueEntityStore";
import { useIssueKeyboardStore } from "../../stores/useIssueKeyboardStore";
import { useIssueSelectionStore } from "../../stores/useIssueSelectionStore";
import { IssueListRow } from "./IssueListRow";

afterEach(() => {
  cleanup();
  // The entity store is a module singleton; clear it so a populated vault from
  // a previous test does not leak its entity into the next (these tests render from the
  // seed prop, with no vault normalized into the store).
  purgeAll();
  useIssueKeyboardStore.setState({
    visibleIssueIds: { list: [], board: [], backlog: [] },
    focusedIssueId: { list: null, board: null, backlog: null },
    tabStopIssueId: { list: null, board: null, backlog: null },
    focusRequest: null,
    quickEditRequest: null,
  });
  useIssueSelectionStore.getState().clear();
});

const base = {
  created_by: "alice",
  updated_by: "alice",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
} satisfies Partial<IssueMetadata>;

const mockIssue: IssueMetadata = {
  ...base,
  id: "REEF-001",
  title: "Test issue title",
  status: "todo",
  priority: "high",
  assigned_to: "alice",
  labels: ["ui", "auth", "security"],
};

const blockerIssue: IssueMetadata = {
  ...base,
  id: "REEF-999",
  title: "Blocker",
  status: "todo",
};

const blockedIssue: IssueMetadata = {
  ...base,
  id: "REEF-002",
  title: "Blocked issue",
  status: "todo",
  depends_on: ["REEF-999"],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderRow(
  issue: IssueMetadata = mockIssue,
  allIssues: IssueMetadata[] = [mockIssue],
  onClick?: (id: string) => void,
  assigneeNames?: Readonly<Record<string, string>>,
) {
  return render(
    <table>
      <tbody>
        <IssueListRow
          issue={issue}
          vault="reef-test"
          allIssues={allIssues}
          assigneeNames={assigneeNames}
          logicalIds={["REEF-001", "REEF-002", "REEF-003"]}
          onClick={onClick}
        />
      </tbody>
    </table>,
    { wrapper: createWrapper() },
  );
}

function setBoundingClientRect(
  element: Element,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
}

describe("IssueListRow", () => {
  it("renders issue ID", () => {
    renderRow();
    expect(screen.getByText("REEF-001")).toBeTruthy();
  });

  it("renders issue title", () => {
    renderRow();
    const titleEl = screen.getAllByText("Test issue title")[0];
    expect(titleEl).toBeTruthy();
  });

  it("renders status badge", () => {
    renderRow();
    // `open`'s display label is "Todo" (REEF-109); the enum key stays `open`.
    const badgeEl = screen.getAllByText("Todo")[0];
    expect(badgeEl).toBeTruthy();
  });

  it("renders priority badge", () => {
    renderRow();
    // PriorityBadge renders the human label, not the raw enum (REEF-058).
    const priorityEl = screen.getAllByText("High")[0];
    expect(priorityEl).toBeTruthy();
  });

  it("renders the current assignee display name instead of the login", () => {
    renderRow(mockIssue, [mockIssue], undefined, { alice: "Alice Example" });

    expect(screen.getAllByText("Alice Example")[0]).toBeTruthy();
    expect(screen.queryByText("alice")).toBeNull();
  });

  it("falls back to an unknown assignee login", () => {
    const issue = { ...mockIssue, assigned_to: "missing-user" };
    renderRow(issue, [issue], undefined, { alice: "Alice Example" });

    expect(screen.getAllByText("missing-user")[0]).toBeTruthy();
  });

  it("updates the displayed name when the roster index changes", () => {
    const view = renderRow(mockIssue, [mockIssue], undefined, {
      alice: "Old Name",
    });
    expect(screen.getByText("Old Name")).toBeInTheDocument();

    view.rerender(
      <table>
        <tbody>
          <IssueListRow
            issue={mockIssue}
            vault="reef-test"
            allIssues={[mockIssue]}
            assigneeNames={{ alice: "New Name" }}
            logicalIds={["REEF-001", "REEF-002", "REEF-003"]}
          />
        </tbody>
      </table>,
    );

    expect(screen.getByText("New Name")).toBeInTheDocument();
    expect(screen.queryByText("Old Name")).toBeNull();
  });

  it("shows dash for missing assignee", () => {
    const issue: IssueMetadata = { ...mockIssue, assigned_to: undefined };
    renderRow(issue);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("renders row element", () => {
    renderRow();
    const rows = screen.getAllByTestId("issue-list-row");
    expect(rows.length).toBe(1);
  });

  it("shows blocked indicator with count when issue is blocked", () => {
    renderRow(blockedIssue, [blockedIssue, blockerIssue]);
    const blocked = screen.getAllByText(/Blocked \(1\)/);
    expect(blocked.length).toBeGreaterThan(0);
  });

  it("does NOT show blocked indicator when issue is not blocked", () => {
    renderRow(mockIssue, [mockIssue]);
    // mockIssue title is "Test issue title" — does not contain "Blocked"
    // Look specifically for the red indicator span (not the title)
    const rows = screen.getAllByTestId("issue-list-row");
    const rowHtml = rows[0].innerHTML;
    expect(rowHtml).not.toContain("Blocked (");
  });

  it("calls onClick with issue id when row is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderRow(mockIssue, [mockIssue], onClick);
    const row = screen.getAllByTestId("issue-list-row")[0];
    await user.click(row);
    expect(onClick).toHaveBeenCalledWith("REEF-001");
  });

  it("opens the context menu without opening the issue detail", () => {
    const onClick = vi.fn();
    renderRow(mockIssue, [mockIssue], onClick);
    fireEvent.contextMenu(screen.getByTestId("issue-list-row"), {
      clientX: 20,
      clientY: 20,
    });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps selected row chrome above hover while its context menu is open", async () => {
    const user = userEvent.setup();
    useIssueSelectionStore.getState().toggle(mockIssue.id);
    renderRow(mockIssue);

    const row = screen.getByTestId("issue-list-row");
    const stickyCell = row.querySelector<HTMLElement>(
      'td[data-column-key="id"]',
    );
    const boundaryCell = row.querySelector<HTMLElement>(
      'td[data-column-key="select"]',
    );
    const titleCell = row.querySelector<HTMLElement>(
      'td[data-column-key="title"]',
    );
    const ordinaryCell = row.querySelector<HTMLElement>(
      'td[data-column-key="title"]',
    );
    expect(stickyCell).not.toBeNull();
    expect(boundaryCell).not.toBeNull();
    expect(titleCell).not.toBeNull();
    expect(ordinaryCell).not.toBeNull();

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      mockIssue.id,
    ]);
    expect(row).toHaveAttribute("data-context-open", "true");
    expect(row.className).toContain("bg-brand/5");
    expect(row.className).toContain("ring-1");
    expect(Number(boundaryCell?.style.zIndex)).toBeGreaterThan(
      Number(titleCell?.style.zIndex),
    );
    expect(boundaryCell?.style.zIndex).toBe("40");
    expect(stickyCell?.className).toContain("reef-list-sticky-state");
    expect(stickyCell?.className).not.toContain("group-hover:bg-surface-hover");
    expect(ordinaryCell?.className).not.toContain("bg-surface-hover");

    const copyLink = screen.getByTestId("issue-context-menu-copy-link");
    await user.hover(copyLink);
    expect(copyLink).toHaveAttribute("data-highlighted");
    expect(row).toHaveAttribute("data-context-open", "true");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(row).not.toHaveAttribute("data-context-open", "true"),
    );
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      mockIssue.id,
    ]);
  });

  it("outlines an unselected context target without changing the selection", async () => {
    const user = userEvent.setup();
    const selectedId = mockIssue.id;
    const targetIssue = {
      ...mockIssue,
      id: "REEF-002",
      title: "Unselected context target",
    };
    useIssueSelectionStore.getState().toggle(selectedId);
    renderRow(targetIssue, [mockIssue, targetIssue]);

    const row = screen.getByTestId("issue-list-row");
    const stickyCell = row.querySelector<HTMLElement>(
      'td[data-column-key="id"]',
    );
    const boundaryCell = row.querySelector<HTMLElement>(
      'td[data-column-key="select"]',
    );
    const titleCell = row.querySelector<HTMLElement>(
      'td[data-column-key="title"]',
    );
    expect(stickyCell).not.toBeNull();
    expect(boundaryCell).not.toBeNull();
    expect(titleCell).not.toBeNull();

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      selectedId,
    ]);
    expect(row).toHaveAttribute("data-context-open", "true");
    expect(row.className).not.toContain("bg-brand/5");
    expect(row.className).toContain("hover:bg-transparent");
    expect(Number(boundaryCell?.style.zIndex)).toBeGreaterThan(
      Number(titleCell?.style.zIndex),
    );
    expect(boundaryCell?.style.zIndex).toBe("40");
    expect(stickyCell?.className).not.toContain("group-hover:bg-surface-hover");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(row).not.toHaveAttribute("data-context-open", "true"),
    );
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      selectedId,
    ]);
  });

  it("restores row focus after a keyboard context menu closes", async () => {
    const user = userEvent.setup();
    renderRow(mockIssue);
    const row = screen.getByTestId("issue-list-row");
    const stickyCell = row.querySelector<HTMLElement>(
      'td[data-column-key="id"]',
    );
    row.focus();

    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(row).toHaveAttribute("data-context-open", "true");
    expect(row.className).toContain("hover:bg-transparent");
    expect(row.className).not.toContain("bg-brand/5");
    expect(stickyCell?.className).not.toContain("bg-brand/5");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row).not.toHaveAttribute("data-context-open", "true");
  });

  it("opens the focused inline editor from status, priority, and assignee cells", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    for (const field of ["status", "priority", "assignee"] as const) {
      cleanup();
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("list", [
          { key: "row-1", issueId: mockIssue.id },
        ]);
      render(
        <IssueListRow
          issue={mockIssue}
          vault="reef-test"
          allIssues={[mockIssue]}
          logicalIds={[mockIssue.id]}
          occurrenceKey="row-1"
          onClick={onClick}
        />,
        { wrapper: createWrapper() },
      );
      await user.click(screen.getByTestId(`issue-inline-edit-${field}`));
      expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
        scope: "list",
        issueId: mockIssue.id,
        occurrenceKey: "row-1",
        field,
      });
      expect(onClick).not.toHaveBeenCalled();
      useIssueKeyboardStore.getState().closeQuickEdit();
    }
  });

  it("opens each inline editor from a focused cell with Enter without opening detail", () => {
    const onClick = vi.fn();
    for (const field of ["status", "priority", "assignee"] as const) {
      cleanup();
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("list", [
          { key: "row-1", issueId: mockIssue.id },
        ]);
      render(
        <IssueListRow
          issue={mockIssue}
          vault="reef-test"
          allIssues={[mockIssue]}
          logicalIds={[mockIssue.id]}
          occurrenceKey="row-1"
          onClick={onClick}
        />,
        { wrapper: createWrapper() },
      );

      fireEvent.keyDown(screen.getByTestId(`issue-inline-edit-${field}`), {
        key: "Enter",
      });

      expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
        scope: "list",
        issueId: mockIssue.id,
        occurrenceKey: "row-1",
        field,
      });
      expect(onClick).not.toHaveBeenCalled();
      useIssueKeyboardStore.getState().closeQuickEdit();
    }
  });

  it("positions each quick editor from its active field trigger, not the ID cell", async () => {
    const user = userEvent.setup();
    const fieldRects = {
      status: { left: 320, top: 80, width: 96, height: 28 },
      priority: { left: 460, top: 80, width: 88, height: 28 },
      assignee: { left: 600, top: 80, width: 128, height: 28 },
    } as const;

    for (const field of ["status", "priority", "assignee"] as const) {
      cleanup();
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("list", [
          { key: "row-1", issueId: mockIssue.id },
        ]);
      render(
        <IssueListRow
          issue={mockIssue}
          vault="reef-test"
          allIssues={[mockIssue]}
          logicalIds={[mockIssue.id]}
          occurrenceKey="row-1"
        />,
        { wrapper: createWrapper() },
      );

      const idCell = screen
        .getByTestId("issue-list-row")
        .querySelector<HTMLElement>('td[data-column-key="id"]');
      expect(idCell).not.toBeNull();
      const trigger = screen.getByTestId(`issue-inline-edit-${field}`);
      setBoundingClientRect(idCell as HTMLElement, {
        left: 16,
        top: 80,
        width: 128,
        height: 40,
      });
      setBoundingClientRect(trigger, fieldRects[field]);

      await user.click(trigger);

      expect(screen.getByTestId("issue-quick-edit-anchor")).toHaveStyle({
        left: `${fieldRects[field].left}px`,
      });
      useIssueKeyboardStore.getState().closeQuickEdit();
    }
  });

  it("keeps the narrow Priority quick editor inside the viewport", async () => {
    const user = userEvent.setup();
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 640,
    });

    try {
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("list", [
          { key: "row-1", issueId: mockIssue.id },
        ]);
      render(
        <IssueListRow
          issue={mockIssue}
          vault="reef-test"
          allIssues={[mockIssue]}
          logicalIds={[mockIssue.id]}
          occurrenceKey="row-1"
        />,
        { wrapper: createWrapper() },
      );

      const trigger = screen.getByTestId("issue-inline-edit-priority");
      setBoundingClientRect(trigger, {
        left: 500,
        top: 80,
        width: 88,
        height: 28,
      });
      await user.click(trigger);

      const anchor = screen.getByTestId("issue-quick-edit-anchor");
      expect(Number.parseFloat(anchor.style.left)).toBeLessThanOrEqual(448);
      expect(Number.parseFloat(anchor.style.left)).toBeGreaterThanOrEqual(0);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("uses compact enum chrome while keeping the assignee anchor width", async () => {
    const user = userEvent.setup();

    for (const field of ["status", "priority", "assignee"] as const) {
      cleanup();
      useIssueKeyboardStore
        .getState()
        .setVisibleOccurrences("list", [
          { key: "row-1", issueId: mockIssue.id },
        ]);
      render(
        <IssueListRow
          issue={mockIssue}
          vault="reef-test"
          allIssues={[mockIssue]}
          logicalIds={[mockIssue.id]}
          occurrenceKey="row-1"
        />,
        { wrapper: createWrapper() },
      );

      await user.click(screen.getByTestId(`issue-inline-edit-${field}`));

      const anchor = screen.getByTestId("issue-quick-edit-anchor");
      expect(anchor).toHaveClass(field === "assignee" ? "w-56" : "w-48");

      if (field !== "assignee") {
        expect(screen.getByRole("listbox")).toHaveClass("w-48");
      }

      useIssueKeyboardStore.getState().closeQuickEdit();
    }

    act(() => {
      useIssueKeyboardStore
        .getState()
        .requestQuickEdit("list", "labels", { requestDomFocus: false });
    });
    expect(screen.getByTestId("issue-quick-edit-anchor")).toHaveClass("w-56");
    expect(screen.getByRole("dialog")).toHaveClass("w-72");
    useIssueKeyboardStore.getState().closeQuickEdit();
  });

  it("follows the active trigger after resize and vertical or horizontal table scroll", async () => {
    useIssueKeyboardStore
      .getState()
      .setVisibleOccurrences("list", [{ key: "row-1", issueId: mockIssue.id }]);
    render(
      <div data-testid="issue-list-scroll-container">
        <table>
          <tbody>
            <IssueListRow
              issue={mockIssue}
              vault="reef-test"
              allIssues={[mockIssue]}
              logicalIds={[mockIssue.id]}
              occurrenceKey="row-1"
            />
          </tbody>
        </table>
      </div>,
      { wrapper: createWrapper() },
    );

    const idCell = screen
      .getByTestId("issue-list-row")
      .querySelector<HTMLElement>('td[data-column-key="id"]');
    const trigger = screen.getByTestId("issue-inline-edit-priority");
    const scrollContainer = screen.getByTestId("issue-list-scroll-container");
    expect(idCell).not.toBeNull();
    setBoundingClientRect(idCell as HTMLElement, {
      left: 16,
      top: 80,
      width: 128,
      height: 40,
    });
    let triggerRect = {
      left: 460,
      top: 80,
      width: 88,
      height: 28,
    };
    const triggerRectSpy = vi.fn(() => ({
      ...triggerRect,
      right: triggerRect.left + triggerRect.width,
      bottom: triggerRect.top + triggerRect.height,
      x: triggerRect.left,
      y: triggerRect.top,
      toJSON: () => triggerRect,
    }));
    Object.defineProperty(trigger, "getBoundingClientRect", {
      configurable: true,
      value: triggerRectSpy,
    });

    act(() => {
      useIssueKeyboardStore
        .getState()
        .focusOccurrence("list", "row-1", mockIssue.id, {
          requestDomFocus: false,
        });
      useIssueKeyboardStore
        .getState()
        .requestQuickEdit("list", "priority", { requestDomFocus: false });
    });
    expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
      scope: "list",
      issueId: mockIssue.id,
      occurrenceKey: "row-1",
      field: "priority",
    });
    const anchor = await screen.findByTestId("issue-quick-edit-anchor");
    expect(anchor).toHaveStyle({ left: "460px", top: "94px" });

    triggerRect = {
      left: 720,
      top: 140,
      width: 88,
      height: 28,
    };
    expect(trigger.getBoundingClientRect().left).toBe(720);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("issue-quick-edit-anchor")).toHaveStyle({
        left: "720px",
        top: "154px",
      }),
    );

    triggerRect = {
      left: 860,
      top: 220,
      width: 88,
      height: 28,
    };
    scrollContainer.scrollLeft = 140;
    scrollContainer.scrollTop = 240;
    await act(async () => {
      fireEvent.scroll(scrollContainer);
    });
    await waitFor(() =>
      expect(screen.getByTestId("issue-quick-edit-anchor")).toHaveStyle({
        left: "824px",
        top: "234px",
      }),
    );
    useIssueKeyboardStore.getState().closeQuickEdit();
  });

  it("keeps Escape closing the active quick editor", async () => {
    const user = userEvent.setup();
    useIssueKeyboardStore
      .getState()
      .setVisibleOccurrences("list", [{ key: "row-1", issueId: mockIssue.id }]);
    render(
      <IssueListRow
        issue={mockIssue}
        vault="reef-test"
        allIssues={[mockIssue]}
        logicalIds={[mockIssue.id]}
        occurrenceKey="row-1"
      />,
      { wrapper: createWrapper() },
    );

    await user.click(screen.getByTestId("issue-inline-edit-priority"));
    expect(screen.getByTestId("issue-quick-edit-anchor")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByTestId("issue-quick-edit-anchor")).toBeNull(),
    );
    expect(useIssueKeyboardStore.getState().quickEditRequest).toBeNull();
  });

  it("toggles selection from the checkbox without opening detail", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderRow(mockIssue, [mockIssue], onClick);
    await user.click(screen.getByRole("checkbox", { name: "Select REEF-001" }));
    expect(useIssueSelectionStore.getState().selectedIds.has("REEF-001")).toBe(
      true,
    );
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("issue-list-row")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("uses Shift+Click for inclusive range selection instead of detail", () => {
    const onClick = vi.fn();
    useIssueSelectionStore.getState().toggle("REEF-001");
    renderRow({ ...mockIssue, id: "REEF-003" }, [mockIssue], onClick);
    screen
      .getByTestId("issue-list-row")
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      );
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "REEF-001",
      "REEF-002",
      "REEF-003",
    ]);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("extends the range when the selection checkbox is Shift+clicked", () => {
    const onClick = vi.fn();
    useIssueSelectionStore.getState().toggle("REEF-001");
    renderRow({ ...mockIssue, id: "REEF-003" }, [mockIssue], onClick);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select REEF-003" }), {
      shiftKey: true,
    });

    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "REEF-001",
      "REEF-002",
      "REEF-003",
    ]);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uses the rounded row focus chrome instead of inset tr rings", () => {
    useIssueKeyboardStore.setState({
      focusedIssueId: { list: "REEF-001", board: null, backlog: null },
      tabStopIssueId: { list: "REEF-001", board: null, backlog: null },
    });

    renderRow();

    const row = screen.getAllByTestId("issue-list-row")[0];
    expect(row).toHaveAttribute("data-keyboard-focused", "true");
    expect(row.className).toContain("reef-issue-list-row");
    expect(row.className).toContain("bg-brand/5");
    expect(row.className).toContain("focus-visible:outline-none");
    expect(row.className).not.toContain("focus-visible:ring-2");
    expect(row.className).not.toContain("ring-inset");
  });
});
