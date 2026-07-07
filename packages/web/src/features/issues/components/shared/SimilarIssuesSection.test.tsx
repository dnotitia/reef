import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { SimilarIssuesSection } from "./SimilarIssuesSection";

const apiFetchMock = vi.mocked(apiFetch);

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function similarResponse() {
  return new Response(
    JSON.stringify({
      issues: [
        {
          id: "REEF-022",
          title: "AI draft duplicate detection misses old issues",
          status: "todo",
          issue_type: "bug",
          score: 0.032,
        },
        {
          id: "REEF-023",
          title: "Duplicate issue review in activity drafts",
          status: "in_progress",
          issue_type: "story",
          score: 0.031,
        },
        {
          id: "REEF-024",
          title: "Warn before filing duplicate backlog work",
          status: "in_review",
          issue_type: "task",
          score: 0.03,
        },
        {
          id: "REEF-025",
          title: "Quiet failed similar issue searches",
          status: "done",
          issue_type: "task",
          score: 0.029,
        },
        {
          id: "REEF-026",
          title: "Reuse duplicate hints in draft approvals",
          status: "closed",
          issue_type: "task",
          score: 0.028,
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SimilarIssuesSection", () => {
  it("renders the top five similar issues as new-tab rows and supports group dismiss", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue(similarResponse());

    render(
      wrap(
        <SimilarIssuesSection
          title="AI draft duplicate detection"
          vault="reef-test"
        />,
      ),
    );

    expect(await screen.findAllByTestId("similar-issue-row")).toHaveLength(5);
    const section = screen.getByTestId("similar-issues-section");
    expect(within(section).getByText("Similar issues")).toBeInTheDocument();
    expect(
      within(section).getByText("Top 5 by similarity"),
    ).toBeInTheDocument();
    const link = within(section).getByRole("link", {
      name: /REEF-022 AI draft duplicate detection misses old issues/,
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(
      within(section).queryByRole("button", { name: "Dismiss REEF-022" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(section).getByRole("button", { name: "Hide similar issues" }),
    );
    expect(
      screen.queryByTestId("similar-issues-section"),
    ).not.toBeInTheDocument();
  });

  it("does not fetch for two latin title characters", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(wrap(<SimilarIssuesSection title="ab" vault="reef-test" />));
    act(() => vi.advanceTimersByTime(600));
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("similar-issues-section"),
    ).not.toBeInTheDocument();
  });

  it("waits for 600ms before fetching a two-character CJK title", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { rerender } = render(
      wrap(<SimilarIssuesSection title="" vault="reef-test" />),
    );

    rerender(wrap(<SimilarIssuesSection title="이슈" vault="reef-test" />));
    await flushMicrotasks();
    const section = screen.getByTestId("similar-issues-section");
    expect(within(section).getByText("Checking title…")).toBeInTheDocument();
    const indicator = within(section).getByTestId("search-progress-bar");
    expect(indicator).toHaveClass("reef-search-progress");
    expect(indicator).toHaveClass("top-0");
    act(() => vi.advanceTimersByTime(599));
    expect(apiFetchMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    await flushMicrotasks();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/issues/similar?vault=reef-test&q=%EC%9D%B4%EC%8A%88&limit=5",
    );
  });

  it("waits for 600ms before fetching a three-character latin title", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { rerender } = render(
      wrap(<SimilarIssuesSection title="" vault="reef-test" />),
    );

    rerender(wrap(<SimilarIssuesSection title="abc" vault="reef-test" />));
    await flushMicrotasks();
    expect(screen.getByText("Checking title…")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(599));
    expect(apiFetchMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    await flushMicrotasks();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/issues/similar?vault=reef-test&q=abc&limit=5",
    );

    rerender(wrap(<SimilarIssuesSection title="abc" vault="reef-test" />));
    act(() => vi.advanceTimersByTime(600));
    await flushMicrotasks();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the section visible with a settled no-match state", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ issues: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(wrap(<SimilarIssuesSection title="이슈" vault="reef-test" />));

    expect(await screen.findByText("Checking title…")).toBeInTheDocument();

    const section = await screen.findByTestId("similar-issues-section");
    await waitFor(() =>
      expect(within(section).getByText("No close matches")).toBeInTheDocument(),
    );
    expect(
      within(section).queryByTestId("search-progress-bar"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("similar-issue-row")).not.toBeInTheDocument();
  });

  it("keeps the checking state visible while the settled request is pending", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    apiFetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      wrap(<SimilarIssuesSection title="duplicate issue" vault="reef-test" />),
    );

    await flushMicrotasks();
    const checkingSection = screen.getByTestId("similar-issues-section");
    expect(
      within(checkingSection).getByText("Checking title…"),
    ).toBeInTheDocument();
    expect(
      within(checkingSection).getByTestId("search-progress-bar"),
    ).toHaveClass("reef-search-progress");
    expect(screen.queryByTestId("similar-issue-row")).not.toBeInTheDocument();

    await act(async () => {
      resolveFetch(similarResponse());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findAllByTestId("similar-issue-row")).toHaveLength(5);
    const section = screen.getByTestId("similar-issues-section");
    expect(
      within(section).getByText("Top 5 by similarity"),
    ).toBeInTheDocument();
    expect(
      within(section).queryByTestId("search-progress-bar"),
    ).not.toBeInTheDocument();
  });

  it("dismisses only the current query so a changed title checks again", async () => {
    const user = userEvent.setup();
    apiFetchMock.mockResolvedValue(similarResponse());

    const { rerender } = render(
      wrap(<SimilarIssuesSection title="duplicate issue" vault="reef-test" />),
    );

    const section = await screen.findByTestId("similar-issues-section");
    await user.click(
      within(section).getByRole("button", { name: "Hide similar issues" }),
    );
    expect(
      screen.queryByTestId("similar-issues-section"),
    ).not.toBeInTheDocument();

    rerender(
      wrap(
        <SimilarIssuesSection
          title="different duplicate issue"
          vault="reef-test"
        />,
      ),
    );

    expect(await screen.findByText("Checking title…")).toBeInTheDocument();
  });

  it("hides stale results when the live title drops below the search threshold", async () => {
    apiFetchMock.mockResolvedValue(similarResponse());

    const { rerender } = render(
      wrap(<SimilarIssuesSection title="duplicate issue" vault="reef-test" />),
    );

    expect(await screen.findAllByTestId("similar-issue-row")).toHaveLength(5);

    rerender(wrap(<SimilarIssuesSection title="ab" vault="reef-test" />));

    await waitFor(() =>
      expect(
        screen.queryByTestId("similar-issues-section"),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the section visible with a non-blocking error state", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    render(wrap(<SimilarIssuesSection title="이슈" vault="reef-test" />));

    expect(await screen.findByText("Checking title…")).toBeInTheDocument();

    const section = await screen.findByTestId("similar-issues-section");
    await waitFor(() =>
      expect(within(section).getByText("Couldn't check")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("similar-issue-row")).not.toBeInTheDocument();
  });
});
