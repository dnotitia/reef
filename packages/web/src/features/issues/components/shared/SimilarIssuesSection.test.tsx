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
  it("renders top similar issues as new-tab chips and supports dismiss", async () => {
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

    const section = await screen.findByTestId("similar-issues-section");
    expect(within(section).getByText("Similar issues")).toBeInTheDocument();
    const link = within(section).getByRole("link", {
      name: /REEF-022 AI draft duplicate detection misses old issues/,
    });
    expect(link).toHaveAttribute("target", "_blank");

    await user.click(
      within(section).getByRole("button", { name: "Dismiss REEF-022" }),
    );
    expect(screen.queryByTestId("similar-issue-chip")).not.toBeInTheDocument();
  });

  it("waits for 600ms and at least three title characters before fetching", async () => {
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

    rerender(wrap(<SimilarIssuesSection title="ab" vault="reef-test" />));
    act(() => vi.advanceTimersByTime(600));
    expect(apiFetchMock).not.toHaveBeenCalled();

    rerender(wrap(<SimilarIssuesSection title="abc" vault="reef-test" />));
    act(() => vi.advanceTimersByTime(599));
    expect(apiFetchMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    await flushMicrotasks();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/issues/similar?vault=reef-test&q=abc&limit=5",
    );
  });

  it("hides quietly when the search request fails", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    render(
      wrap(<SimilarIssuesSection title="duplicate issue" vault="reef-test" />),
    );

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(
      screen.queryByTestId("similar-issues-section"),
    ).not.toBeInTheDocument();
  });
});
