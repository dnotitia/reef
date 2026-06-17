import type { IssueMetadata } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeAll } from "../../stores/issueEntityStore";
import { IssueListRow } from "./IssueListRow";

afterEach(() => {
  cleanup();
  // The entity store is a module singleton; clear it so a populated vault from
  // a previous test does not leak its entity into the next (these tests render from the
  // seed prop, with no vault normalized into the store).
  purgeAll();
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
) {
  return render(
    <table>
      <tbody>
        <IssueListRow
          issue={issue}
          vault="reef-test"
          allIssues={allIssues}
          onClick={onClick}
        />
      </tbody>
    </table>,
    { wrapper: createWrapper() },
  );
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

  it("renders assignee", () => {
    renderRow();
    const assigneeEl = screen.getAllByText("alice")[0];
    expect(assigneeEl).toBeTruthy();
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
});
