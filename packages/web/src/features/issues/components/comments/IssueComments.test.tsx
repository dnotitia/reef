import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
// Streamdown's markdown pipeline is irrelevant to this wiring test.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { apiFetch } from "@/lib/apiClient";
import { IssueComments } from "./IssueComments";

const mockApiFetch = vi.mocked(apiFetch);

const OWN = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reef_id: "REEF-001",
  body: "alice comment",
  author: "alice",
  created_at: "2026-06-18T01:00:00.000Z",
  edited_at: null,
};
const OTHER = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  reef_id: "REEF-001",
  body: "bob comment",
  author: "bob",
  created_at: "2026-06-18T00:00:00.000Z",
  edited_at: null,
};

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("IssueComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return new Response(JSON.stringify({ comments: [OTHER, OWN] }), {
            status: 200,
          });
        }
        if (method === "POST") {
          return new Response(
            JSON.stringify({
              comment: {
                ...OWN,
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                body: "fresh",
              },
            }),
            { status: 201 },
          );
        }
        return new Response(
          JSON.stringify({
            comment: {
              ...OWN,
              body: "edited",
              edited_at: "2026-06-18T05:00:00.000Z",
            },
          }),
          { status: 200 },
        );
      },
    );
  });

  it("renders the thread and an edit affordance only on the author's own comment", async () => {
    render(wrap(<IssueComments issueId="REEF-001" vault="v" />));

    await waitFor(() =>
      expect(screen.getByText("alice comment")).toBeInTheDocument(),
    );
    expect(screen.getByText("bob comment")).toBeInTheDocument();
    // Only the own (alice) comment exposes Edit; bob's does not.
    expect(screen.getAllByLabelText("Edit comment")).toHaveLength(1);
  });

  it("posts a new comment from the composer", async () => {
    render(wrap(<IssueComments issueId="REEF-001" vault="v" />));
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

  it("edits the author's own comment via PATCH", async () => {
    render(wrap(<IssueComments issueId="REEF-001" vault="v" />));
    await waitFor(() =>
      expect(screen.getByText("alice comment")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("Edit comment"));
    fireEvent.change(screen.getByLabelText("Comment draft"), {
      target: { value: "edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
