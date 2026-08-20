import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { apiFetch } from "@/lib/apiClient";
import { StatusBadge } from "@/components/ui/status-icon";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { IssueInlineEditTrigger } from "./IssueInlineEditTrigger";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => "alice",
}));

const mockApiFetch = vi.mocked(apiFetch);

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Harness() {
  const mutation = useUpdateIssue();
  return (
    <>
      <IssueInlineEditTrigger
        scope="list"
        field="status"
        issueId="REEF-001"
        vault="reef-acme"
        occurrenceKey="REEF-001"
        label="Status"
      >
        <StatusBadge status="todo" />
      </IssueInlineEditTrigger>
      <button
        type="button"
        data-testid="start-status-update"
        onClick={() =>
          mutation.mutate({
            id: "REEF-001",
            vault: "reef-acme",
            patch: { status: "in_progress" },
          })
        }
      >
        start
      </button>
    </>
  );
}

function renderHarness(queryClient = makeQueryClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <IntlTestProvider>
          <Harness />
        </IntlTestProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("IssueInlineEditTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("announces pending and settled status updates while keeping other rows independent", async () => {
    let resolveResponse: (response: Response) => void = () => {};
    mockApiFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    renderHarness();

    const trigger = screen.getByTestId("issue-inline-edit-status");
    expect(trigger).toHaveAttribute("aria-label", "Status");
    expect(trigger).not.toHaveAttribute("aria-busy");

    await act(async () => {
      screen.getByTestId("start-status-update").click();
    });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-busy", "true"));
    expect(trigger).toHaveAccessibleName("Status, Updating status…");
    expect(screen.getByRole("status")).toHaveTextContent("Updating status…");

    await act(async () => {
      resolveResponse(
        new Response(
          JSON.stringify({
            issue: {
              id: "REEF-001",
              title: "Sample",
              status: "in_progress",
              created_at: "2026-05-01T00:00:00.000Z",
              created_by: "alice",
              updated_at: "2026-05-02T00:00:00.000Z",
              updated_by: "alice",
            },
            content: "",
          }),
          { status: 200 },
        ),
      );
    });
    await waitFor(() =>
      expect(trigger).toHaveAccessibleName("Status, Status updated."),
    );
    expect(trigger).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("status")).toHaveTextContent("Status updated.");
  });
});
