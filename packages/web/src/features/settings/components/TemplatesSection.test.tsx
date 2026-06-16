import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}));

import { apiFetch } from "@/lib/apiClient";
import { TemplatesSection } from "./TemplatesSection";

const mockApiFetch = vi.mocked(apiFetch);

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("TemplatesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ entries: [] }), { status: 200 }),
    );
  });

  it("requests /api/templates?vault={vault}", async () => {
    render(wrap(<TemplatesSection />));
    await screen.findByTestId("templates-section-empty");
    expect(mockApiFetch).toHaveBeenCalledWith("/api/templates?vault=reef-acme");
  });

  it("opens a labeled template editor with shared issue-form label input", async () => {
    const user = userEvent.setup();
    render(wrap(<TemplatesSection />));

    await user.click(await screen.findByTestId("templates-new-button"));

    expect(screen.getByText("Basics")).toBeInTheDocument();
    expect(screen.getByText("Defaults")).toBeInTheDocument();
    expect(screen.getByLabelText("Default labels")).toBeInTheDocument();
    expect(screen.getByTestId("templates-labels-input")).toHaveAttribute(
      "placeholder",
      "Add a label and press Enter…",
    );
    expect(
      screen.queryByText("Default labels (comma-separated)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Filename stem/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/_reef\/templates/i)).not.toBeInTheDocument();
  });

  it("does not show issue-only metadata fields in the template editor", async () => {
    const user = userEvent.setup();
    render(wrap(<TemplatesSection />));

    await user.click(await screen.findByTestId("templates-new-button"));

    expect(screen.getByLabelText("Name *")).toBeInTheDocument();
    expect(screen.getByLabelText("Label *")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Title prefix")).toBeInTheDocument();
    expect(screen.getByLabelText("Default labels")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();

    expect(screen.queryByLabelText("Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Severity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assignee")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Requester")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reporter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Due date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Estimate")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sprint")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Milestone")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Release")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Parent")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Depends on")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Related")).not.toBeInTheDocument();
  });

  it("lets a read-only viewer inspect a template's full details without edit/save controls", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            {
              template: {
                name: "bug-report",
                label: "Bug report",
                description: "File a bug",
                default_labels: ["bug"],
                body: "## Steps to reproduce",
                title_prefix: "Bug: ",
                priority: "high",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const user = userEvent.setup();
    render(wrap(<TemplatesSection canEdit={false} />));

    // List exposes a View affordance but no mutate controls.
    const viewBtn = await screen.findByTestId("templates-view-bug-report");
    expect(
      screen.queryByTestId("templates-edit-bug-report"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("templates-delete-bug-report"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("templates-new-button"),
    ).not.toBeInTheDocument();

    // Opening reveals the full template (body, title prefix, …) read.
    await user.click(viewBtn);
    expect(screen.getByTestId("templates-editor")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByLabelText("Title prefix")).toBeInTheDocument();
    expect(screen.getByTestId("templates-label-input")).toBeDisabled();
    expect(
      screen.queryByTestId("templates-editor-save"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("templates-editor-cancel")).toHaveTextContent(
      "Close",
    );
  });
});
