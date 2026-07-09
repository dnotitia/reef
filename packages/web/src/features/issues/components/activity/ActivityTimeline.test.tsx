// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => "alice",
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  defaultUrlTransform: (url: string) => url,
}));

import { apiFetch } from "@/lib/apiClient";
import type { ActivityEvent, Comment, IssueMetadata, Status } from "@reef/core";
import { ActivityTimeline } from "./ActivityTimeline";

const mockApiFetch = vi.mocked(apiFetch);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeIssue(overrides: Partial<IssueMetadata> = {}): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Demo",
    status: "in_progress",
    created_at: "2026-06-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-06-10T00:00:00.000Z",
    updated_by: "bob",
    last_status_change: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

const ALICE_COMMENT: Comment = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  reef_id: "REEF-001",
  body: "alice comment",
  author: "alice",
  created_at: "2026-06-02T00:00:00.000Z",
  edited_at: null,
};

function statusEvent(
  id: string,
  at: string,
  from: Status,
  to: Status,
): ActivityEvent {
  return {
    id,
    reef_id: "REEF-001",
    event_type: "status_change",
    event_key: `status_change:${from}->${to}@${at}`,
    payload: { from, to },
    actor: "bob",
    at,
    source: null,
  };
}

let comments: Comment[] = [];
let activity: ActivityEvent[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  comments = [ALICE_COMMENT];
  activity = [
    statusEvent("a1", "2026-06-04T00:00:00.000Z", "todo", "in_progress"),
  ];
  mockApiFetch.mockImplementation(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/planning"))
        return json({ sprints: [], milestones: [], releases: [] });
      if (url.includes("/activity")) return json({ activity });
      if (url.includes("/attachments")) {
        if (method === "POST") {
          return json(
            {
              attachment: {
                id: "att-1",
                reef_id: "REEF-001",
                file_uri: "akb://reef-test/issues/file/file-1",
                filename: "screen.png",
                mime_type: "image/png",
                size_bytes: 3,
                author: "alice",
                created_at: "2026-07-09T01:00:00.000Z",
                source: "comment",
                inline: true,
                original_jira_attachment_id: null,
                meta: null,
              },
              markdown: "![screen.png](akb://reef-test/issues/file/file-1)",
            },
            201,
          );
        }
        return json({ attachments: [] });
      }
      if (url.includes("/comments")) {
        if (method === "GET") return json({ comments });
        if (method === "POST") {
          return json(
            { comment: { ...ALICE_COMMENT, id: "new-id", body: "fresh" } },
            201,
          );
        }
        return json({
          comment: {
            ...ALICE_COMMENT,
            body: "edited",
            edited_at: "2026-06-05T00:00:00.000Z",
          },
        });
      }
      return json({});
    },
  );
});

function renderTimeline(issue = makeIssue()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActivityTimeline issueId="REEF-001" vault="v" issue={issue} />
    </QueryClientProvider>,
  );
}

describe("ActivityTimeline — unified feed (AC1, AC2)", () => {
  it("merges comments, activity, and reconstructed events with an actor and time on each", async () => {
    renderTimeline(
      makeIssue({
        implementation_refs: [
          {
            type: "pull_request",
            repo: "o/r",
            ref: "25",
            url: "https://github.com/o/r/pull/25",
            title: "Forecast",
            actor: "carol",
            detected_at: "2026-06-08T00:00:00.000Z",
          },
        ],
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("alice comment")).toBeInTheDocument(),
    );

    const rows = screen.getAllByTestId("activity-event");
    const text = rows.map((r) => r.textContent ?? "").join(" | ");
    // created (reconstructed), the status change, and the delivery ref all render.
    expect(text).toContain("created this issue");
    expect(text).toContain("In Progress");
    expect(text).toContain("PR #25");
    expect(text).toContain("Forecast");
    // AC2: a delivery ref with recorded provenance shows its actor.
    expect(text).toContain("carol");
    // AC2: every system row carries a <time>.
    for (const row of rows) {
      expect(row.querySelector("time")).not.toBeNull();
    }
  });

  it("reconstructs a closed event with its reason and the closer (AC5)", async () => {
    renderTimeline(
      makeIssue({
        status: "closed",
        // Close was the last edit (updated_at === close time), so updated_by is
        // the reliable closer and is shown.
        closed_at: "2026-06-09T00:00:00.000Z",
        closed_reason: "completed",
        last_status_change: "2026-06-09T00:00:00.000Z",
        updated_at: "2026-06-09T00:00:00.000Z",
        updated_by: "bob",
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("alice comment")).toBeInTheDocument(),
    );
    const text = screen
      .getAllByTestId("activity-event")
      .map((r) => r.textContent ?? "")
      .join(" | ");
    expect(text).toContain("closed this issue");
    expect(text).toContain("Completed");
    expect(text).toContain("bob");
  });
});

describe("ActivityTimeline — field-change rows (REEF-276)", () => {
  it("renders assignee, priority, and planning changes, and never a raw planning id", async () => {
    comments = [];
    activity = [
      {
        id: "asg-1",
        reef_id: "REEF-001",
        event_type: "assignee_change",
        event_key: "assignee_change:∅->bob@2026-06-03T00:00:00.000Z",
        payload: { from: null, to: "bob" },
        actor: "alice",
        at: "2026-06-03T00:00:00.000Z",
        source: null,
      },
      {
        id: "pri-1",
        reef_id: "REEF-001",
        event_type: "priority_change",
        event_key: "priority_change:∅->high@2026-06-03T06:00:00.000Z",
        payload: { from: null, to: "high" },
        actor: "alice",
        at: "2026-06-03T06:00:00.000Z",
        source: null,
      },
      {
        id: "pln-1",
        reef_id: "REEF-001",
        event_type: "planning_link",
        event_key:
          "planning_link:sprint:∅->spr-secret-id@2026-06-03T12:00:00.000Z",
        payload: { field: "sprint", from: null, to: "spr-secret-id" },
        actor: "alice",
        at: "2026-06-03T12:00:00.000Z",
        source: null,
      },
    ];
    renderTimeline(makeIssue());

    await waitFor(() =>
      expect(
        screen.getAllByTestId("activity-event").length,
      ).toBeGreaterThanOrEqual(4),
    );
    const text = screen
      .getAllByTestId("activity-event")
      .map((r) => r.textContent ?? "")
      .join(" | ");
    expect(text).toContain("assigned this to");
    expect(text).toContain("bob");
    expect(text).toMatch(/priority/i);
    expect(text).toContain("High");
    // The planning kind is named in text (a11y); the raw id is omitted.
    expect(text).toContain("sprint");
    expect(text).not.toContain("spr-secret-id");
  });
});

describe("ActivityTimeline — attachment rows (REEF-349)", () => {
  it("renders attachment activity with filename", async () => {
    comments = [];
    activity = [
      {
        id: "att-event-1",
        reef_id: "REEF-001",
        event_type: "attachment_added",
        event_key: "attachment_added:att-1@2026-07-09T01:00:00.000Z",
        payload: {
          attachment_id: "att-1",
          file_uri: "akb://reef-test/issues/file/file-1",
          filename: "screen.png",
          mime_type: "image/png",
          size_bytes: 3,
        },
        actor: "alice",
        at: "2026-07-09T01:00:00.000Z",
        source: null,
      },
    ];

    renderTimeline(makeIssue());

    await waitFor(() =>
      expect(screen.getByText(/screen\.png/)).toBeInTheDocument(),
    );
    const text = screen
      .getAllByTestId("activity-event")
      .map((row) => row.textContent ?? "")
      .join(" | ");
    expect(text).toContain("attached");
    expect(text).toContain("alice");
  });
});

describe("ActivityTimeline — collapse (AC3)", () => {
  it("folds a run of ≥3 status changes and expands them on click", async () => {
    comments = [];
    activity = [
      statusEvent("a1", "2026-06-02T00:00:00.000Z", "backlog", "todo"),
      statusEvent("a2", "2026-06-03T00:00:00.000Z", "todo", "in_progress"),
      statusEvent("a3", "2026-06-04T00:00:00.000Z", "in_progress", "in_review"),
    ];
    renderTimeline(makeIssue({ status: "in_review" }));

    const toggle = await screen.findByRole("button", {
      name: /3 status changes/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Collapsed: the reconstructed `created` row is visible.
    expect(screen.getAllByTestId("activity-event")).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Expanded: created + the 3 folded status changes.
    expect(screen.getAllByTestId("activity-event")).toHaveLength(4);
  });
});

describe("ActivityTimeline — comment mutations", () => {
  it("posts a new comment from the composer", async () => {
    renderTimeline();
    await waitFor(() =>
      expect(screen.getByText("alice comment")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "fresh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/comments?vault=v") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("uploads pasted images in the comment composer before appending markdown", async () => {
    renderTimeline();
    await waitFor(() =>
      expect(screen.getByText("alice comment")).toBeInTheDocument(),
    );

    const textarea = screen.getByLabelText("Add a comment");
    const file = new File([new Uint8Array([1, 2, 3])], "screen.png", {
      type: "image/png",
    });
    fireEvent.paste(textarea, {
      clipboardData: { files: [file] },
    });

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/attachments?vault=v") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(textarea).toHaveValue(
        "![screen.png](akb://reef-test/issues/file/file-1)",
      ),
    );
  });

  it("edits the author's own comment via PATCH", async () => {
    renderTimeline();
    await waitFor(() =>
      expect(screen.getByText("alice comment")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("Edit comment"));
    const draft = screen.getByLabelText("Comment draft");
    fireEvent.change(draft, { target: { value: "edited" } });
    fireEvent.click(
      within(draft.closest("div") as HTMLElement).getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) =>
            /\/comments\/[^?]+\?vault=v/.test(String(url)) &&
            init?.method === "PATCH",
        ),
      ).toBe(true),
    );
  });
});

describe("ActivityTimeline — load failure (a11y)", () => {
  it("announces a load failure in a polite live region", async () => {
    // Fail the activity query so `activityError` flips on.
    mockApiFetch.mockImplementation(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/planning"))
        return json({ sprints: [], milestones: [], releases: [] });
      if (url.includes("/activity")) return json({ error: "boom" }, 500);
      if (url.includes("/comments")) return json({ comments: [] });
      return json({});
    });

    renderTimeline();

    const msg = await screen.findByText(/load the full activity/i);
    // Lives in a polite live region (an <output>, implicit role="status") so it
    // is announced when it appears after mount, not rendered silently.
    const region = msg.closest("output");
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent(
      /load the full activity/i,
    );
  });
});
