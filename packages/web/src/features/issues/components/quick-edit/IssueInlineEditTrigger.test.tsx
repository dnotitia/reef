import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { apiFetch } from "@/lib/apiClient";
import { StatusBadge } from "@/components/ui/status-icon";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import type { IssueQuickEditField } from "@/features/issues/stores/useIssueKeyboardStore";
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

const FIELD_LABELS: Record<IssueQuickEditField, string> = {
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  labels: "Labels",
};

function Harness({ field = "status" }: { field?: IssueQuickEditField }) {
  const mutation = useUpdateIssue();
  const patch =
    field === "status"
      ? { status: "in_progress" as const }
      : field === "priority"
        ? { priority: "high" as const }
        : field === "assignee"
          ? { assigned_to: "bob" }
          : { labels: ["ui"] };
  return (
    <>
      <IssueInlineEditTrigger
        scope="list"
        field={field}
        issueId="REEF-001"
        vault="reef-acme"
        occurrenceKey="REEF-001"
        label={FIELD_LABELS[field]}
      >
        {field === "status" ? (
          <StatusBadge status="todo" />
        ) : (
          FIELD_LABELS[field]
        )}
      </IssueInlineEditTrigger>
      <button
        type="button"
        data-testid="start-status-update"
        onClick={() =>
          mutation.mutate({
            id: "REEF-001",
            vault: "reef-acme",
            patch,
          })
        }
      >
        start
      </button>
    </>
  );
}

function renderHarness(
  field: IssueQuickEditField = "status",
  queryClient = makeQueryClient(),
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <IntlTestProvider>
          <Harness field={field} />
        </IntlTestProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("IssueInlineEditTrigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["status", "Status"],
    ["priority", "Priority"],
    ["assignee", "Assignee"],
    ["labels", "Labels"],
  ] as const)(
    "announces pending and settled %s updates while keeping the action name stable",
    async (field, label) => {
      let resolveResponse: (response: Response) => void = () => {};
      mockApiFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
      );
      renderHarness(field);

      const trigger = screen.getByTestId(`issue-inline-edit-${field}`);
      expect(trigger).toHaveAttribute("aria-label", label);
      expect(trigger).not.toHaveAttribute("aria-busy");

      await act(async () => {
        screen.getByTestId("start-status-update").click();
      });
      await waitFor(() => expect(trigger).toHaveAttribute("aria-busy", "true"));
      expect(trigger).toHaveAccessibleName(label);
      expect(screen.getByRole("status")).toHaveTextContent(
        `Updating ${label}…`,
      );

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
      await waitFor(() => expect(trigger).toHaveAccessibleName(label));
      expect(trigger).not.toHaveAttribute("aria-busy");
      expect(trigger).toHaveAccessibleName(label);
      expect(screen.getByRole("status")).toHaveTextContent(`${label} updated.`);
    },
  );

  it.each([
    ["status", "Status"],
    ["priority", "Priority"],
    ["assignee", "Assignee"],
    ["labels", "Labels"],
  ] as const)(
    "keeps %s failure retry feedback out of the trigger action name",
    async (field, label) => {
      mockApiFetch.mockRejectedValueOnce(new Error("save failed"));
      renderHarness(field);

      const trigger = screen.getByTestId(`issue-inline-edit-${field}`);
      await act(async () => {
        screen.getByTestId("start-status-update").click();
      });

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          `${label} update failed. Retry is available.`,
        ),
      );
      expect(trigger).toHaveAccessibleName(label);
      expect(trigger).not.toHaveAttribute("aria-busy");
      expect(
        screen.queryByRole("button", { name: "Retry" }),
      ).not.toBeInTheDocument();
    },
  );
});
