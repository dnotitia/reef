// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import {
  getIssueChangeReviewPeriod,
  setIssueChangeReviewPeriod,
} from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueChangeReviewPage } from "./IssueChangeReviewPage";

const { mockReplace, mockUseActiveVault, navigationState, fetchMock } =
  vi.hoisted(() => ({
    mockReplace: vi.fn(),
    mockUseActiveVault: vi.fn(),
    navigationState: { searchParams: new URLSearchParams() },
    fetchMock: vi.fn(),
  }));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => navigationState.searchParams,
}));

const ISSUE = {
  id: "REEF-001",
  title: "Completed review issue",
  status: "done",
  created_at: "2026-08-10T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-08-20T00:00:00.000Z",
  updated_by: "alice",
};

const REVIEW = {
  start_at: "2026-08-18T00:00:00.000Z",
  end_at: "2026-08-19T00:00:00.000Z",
  groups: [
    {
      issue: ISSUE,
      changes: [
        {
          id: "activity-1",
          at: "2026-08-18T00:00:00.000Z",
          actor: "alice",
          kind: "field_change",
          event_type: "status_change",
          field: "status_change",
          from: "todo",
          to: "done",
          payload: { from: "todo", to: "done" },
        },
        {
          id: "body-1",
          at: "2026-08-18T01:00:00.000Z",
          actor: "alice",
          kind: "body_update",
          hash: "body-1",
          diff: "-before\n+after",
        },
        {
          id: "comment-1",
          at: "2026-08-18T02:00:00.000Z",
          actor: "bob",
          kind: "comment_added",
          comment_id: "comment-1",
          body: "The complete review comment.",
        },
        {
          id: "attachment-1",
          at: "2026-08-18T03:00:00.000Z",
          actor: "alice",
          kind: "attachment_removed",
          attachment_id: "attachment-1",
          filename: "old-evidence.txt",
          file_uri: "akb://reef-sample/file/attachment-1",
          mime_type: "text/plain",
          size_bytes: 64,
        },
      ],
    },
  ],
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <IntlTestProvider>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </IntlTestProvider>
  );
}

describe("IssueChangeReviewPage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    navigationState.searchParams = new URLSearchParams(
      "start_at=2026-08-18T00:00:00.000Z&end_at=2026-08-19T00:00:00.000Z&tz=UTC",
    );
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    fetchMock.mockResolvedValue(response(REVIEW));
    await db.config.clear();
  });

  afterEach(async () => {
    await db.config.clear();
    vi.unstubAllGlobals();
  });

  it("renders one grouped result with expandable body/comment evidence", async () => {
    render(wrap(<IssueChangeReviewPage />));

    await waitFor(() =>
      expect(
        screen.getByTestId("issue-change-review-results"),
      ).toBeInTheDocument(),
    );
    const group = screen.getByTestId("issue-change-group");
    expect(screen.getAllByTestId("issue-change-group")).toHaveLength(1);
    expect(group.querySelector("ol")).not.toBeVisible();
    fireEvent.click(screen.getByTestId("issue-change-group-summary"));
    expect(screen.getByText("Completed review issue")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getAllByText("Changed by alice")).not.toHaveLength(0);
    expect(
      screen.getByTestId("issue-change-review-actions"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("issue-change-review-share")).toBeNull();
    expect(
      screen.getByText("Removed attachment old-evidence.txt"),
    ).toBeInTheDocument();

    const bodySummary = screen.getByText(/Body updated/);
    const bodyDetails = bodySummary.closest("details");
    expect(bodyDetails).not.toBeNull();
    expect(bodyDetails).not.toHaveAttribute("open");
    fireEvent.click(bodySummary);
    expect(bodyDetails).toHaveAttribute("open");
    expect(bodyDetails?.querySelector("pre")).toHaveTextContent("-before");

    const commentSummary = screen.getByText(/Comment added/);
    fireEvent.click(commentSummary);
    expect(screen.getByText("The complete review comment.")).toBeVisible();
    expect(document.querySelectorAll("main")).toHaveLength(0);
  });

  it("rejects a malformed shared range without falling back to the personal default", async () => {
    navigationState.searchParams = new URLSearchParams(
      "start_at=2026-08-19T00:00:00.000Z&end_at=2026-08-18T00:00:00.000Z&tz=UTC",
    );

    render(wrap(<IssueChangeReviewPage />));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Choose an end date on or after the start date.",
      ),
    );
    expect(screen.queryByTestId("issue-change-review-loading")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/issues/changes"),
      expect.anything(),
    );
  });

  it("preserves a fixed shared timezone when unchanged and uses local time for a new range", async () => {
    navigationState.searchParams = new URLSearchParams(
      "start_at=2026-08-18T00:00:00.000Z&end_at=2026-08-19T00:00:00.000Z&tz=UTC",
    );

    render(wrap(<IssueChangeReviewPage />));
    await waitFor(() =>
      expect(
        screen.getByTestId("issue-change-review-results"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("issue-change-review-apply"));
    const unchangedHref = mockReplace.mock.calls.at(-1)?.[0] as string;
    const unchangedParams = new URL(unchangedHref, "http://localhost")
      .searchParams;
    expect(unchangedParams.get("start_at")).toBe("2026-08-18T00:00:00.000Z");
    expect(unchangedParams.get("end_at")).toBe("2026-08-19T00:00:00.000Z");
    expect(unchangedParams.get("tz")).toBe("UTC");

    function enterDate(id: string, label: string, value: string) {
      const trigger = document.getElementById(id);
      if (!trigger) throw new Error(`Missing date picker trigger: ${id}`);
      fireEvent.click(trigger);
      const input = screen.getByRole("textbox", {
        name: `${label} (YYYY-MM-DD)`,
      });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    }

    mockReplace.mockClear();
    enterDate("issue-change-review-start", "Start date", "2026-08-01");
    enterDate("issue-change-review-end", "End date", "2026-08-03");
    fireEvent.click(screen.getByTestId("issue-change-review-apply"));

    const changedHref = mockReplace.mock.calls.at(-1)?.[0] as string;
    const changedParams = new URL(changedHref, "http://localhost").searchParams;
    expect(changedParams.get("tz")).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
    expect(changedParams.get("start_at")).toBe(
      new Date(2026, 7, 1).toISOString(),
    );
    expect(changedParams.get("end_at")).toBe(
      new Date(2026, 7, 4).toISOString(),
    );
  });

  it("stores a relative selection per workspace and encodes custom ranges in the URL", async () => {
    navigationState.searchParams = new URLSearchParams();
    await setIssueChangeReviewPeriod("reef-acme", 3);
    window.history.replaceState({}, "", "/workspace/reef-acme/issues/changes");

    render(wrap(<IssueChangeReviewPage />));
    await waitFor(() =>
      expect(
        screen.getByTestId("issue-change-review-results"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("issue-change-review-relative-14"),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("issue-change-review-relative-14"));
    expect(
      screen.getByTestId("issue-change-review-relative-14"),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () =>
      expect(await getIssueChangeReviewPeriod("reef-acme")).toBe(14),
    );

    function enterDate(id: string, label: string, value: string) {
      const trigger = document.getElementById(id);
      if (!trigger) throw new Error(`Missing date picker trigger: ${id}`);
      fireEvent.click(trigger);
      const input = screen.getByRole("textbox", {
        name: `${label} (YYYY-MM-DD)`,
      });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    }

    enterDate("issue-change-review-start", "Start date", "2026-08-01");
    enterDate("issue-change-review-end", "End date", "2026-08-03");
    fireEvent.click(screen.getByTestId("issue-change-review-apply"));

    const expectedStart = new Date(2026, 7, 1).toISOString();
    const expectedEnd = new Date(2026, 7, 4).toISOString();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining(
        `start_at=${encodeURIComponent(expectedStart)}&end_at=${encodeURIComponent(expectedEnd)}`,
      ),
      { scroll: false },
    );
  });
});
