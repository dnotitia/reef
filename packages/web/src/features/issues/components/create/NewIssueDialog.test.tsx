import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: vi.fn(() => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  })),
}));

vi.mock("@/features/activity/hooks/useActivityRepo", () => ({
  useActivityRepo: vi.fn(() => ({
    repo: "octo/cat",
    monitoredRepos: ["octo/cat"],
    setRepo: () => Promise.resolve(),
    isLoading: false,
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { mockViewStore } = vi.hoisted(() => ({
  mockViewStore: { state: { newIssueDialogOpen: false } },
}));

vi.mock("@/features/ui/stores/useViewStore", () => ({
  useViewStore: <T,>(
    selector: (s: {
      newIssueDialogOpen: boolean;
      closeNewIssueDialog: () => void;
    }) => T,
  ): T =>
    selector({
      newIssueDialogOpen: mockViewStore.state.newIssueDialogOpen,
      closeNewIssueDialog: () => {
        mockViewStore.state.newIssueDialogOpen = false;
      },
    }),
}));

const { toastDefault, toastSuccess, toastError } = vi.hoisted(() => ({
  toastDefault: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastDefault(...args), {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { NewIssueDialog } from "./NewIssueDialog";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("NewIssueDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewStore.state.newIssueDialogOpen = false;
  });

  it("renders nothing visible when dialog is closed", () => {
    render(wrap(<NewIssueDialog />));
    expect(screen.queryByText(/Create issue/i)).not.toBeInTheDocument();
  });

  it("renders the dialog form when open", async () => {
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));
    expect(await screen.findByText("New Issue")).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Requester")).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
    expect(screen.getByLabelText("Parent")).toBeInTheDocument();
    expect(screen.getByLabelText("Blocks")).toBeInTheDocument();
    expect(screen.getByText("External references")).toBeInTheDocument();
    expect(screen.queryByText("Delivery activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();
    // REEF-167: the canvas matches the issue detail sheet width so the widened
    // rail doesn't shrink the main column.
    expect(screen.getByTestId("new-issue-dialog")).toHaveClass(
      "max-w-[min(94vw,1080px)]",
    );
    // REEF-075: the description owns the main column, so it is no longer pushed
    // below the Planning metadata (which now sits in the right rail). Planning
    // therefore follows Description in document order, not the reverse.
    expect(
      screen
        .getByText("Description")
        .compareDocumentPosition(screen.getByText("Planning")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lays out the rail metadata as property rows and keeps Labels stacked (REEF-167)", async () => {
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));
    await screen.findByText("New Issue");

    // Details + People + Planning fields are each one property row (fixed label
    // + full-width value), matching the issue detail rail — not `grid-cols-2`
    // half-cells. Probe a representative field from each group.
    for (const label of [
      "Type",
      "Priority",
      "Assignee",
      "Start date",
      "Severity",
    ]) {
      expect(
        screen.getByLabelText(label).closest('[data-slot="issue-field-row"]'),
        `${label} should sit in an IssueFieldRow`,
      ).not.toBeNull();
    }

    // Labels stays stacked (label above a wrapping chip input), so its label is
    // not inside a property row.
    expect(
      screen.getByText("Labels").closest('[data-slot="issue-field-row"]'),
    ).toBeNull();
  });

  it("confirms before discarding a dirty draft, then closes on confirm", async () => {
    const user = userEvent.setup();
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));
    await screen.findByText("New Issue");

    // Make the draft dirty so a dismiss should be confirmed.
    await user.type(screen.getByTestId("new-issue-title-input"), "Draft work");

    // Cancel now opens the discard confirmation instead of closing outright.
    await user.click(screen.getByTestId("new-issue-cancel"));
    expect(
      await screen.findByTestId("discard-draft-confirm"),
    ).toBeInTheDocument();
    expect(mockViewStore.state.newIssueDialogOpen).toBe(true);

    // Keeping the draft dismisses the confirmation and leaves the dialog open.
    await user.click(screen.getByTestId("discard-draft-cancel"));
    expect(
      screen.queryByTestId("discard-draft-confirm"),
    ).not.toBeInTheDocument();
    expect(mockViewStore.state.newIssueDialogOpen).toBe(true);

    // Discarding closes the new-issue dialog.
    await user.click(screen.getByTestId("new-issue-cancel"));
    await user.click(await screen.findByTestId("discard-draft-confirm-button"));
    expect(mockViewStore.state.newIssueDialogOpen).toBe(false);
  });

  it("confirms discard when only an uncommitted child draft has content", async () => {
    const user = userEvent.setup();
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));
    await screen.findByText("New Issue");

    // Type an external reference URL but does not click "Add reference", so it
    // stays in the refs editor's local draft and does not reach the form values.
    // The close path should still treat the dialog as dirty.
    await user.type(
      screen.getByLabelText("External reference"),
      "https://example.com/spec",
    );
    await user.click(screen.getByTestId("new-issue-cancel"));
    expect(
      await screen.findByTestId("discard-draft-confirm"),
    ).toBeInTheDocument();
    expect(mockViewStore.state.newIssueDialogOpen).toBe(true);
  });

  it("surfaces an empty-title submit inline (no toast) and focuses the title input", async () => {
    const user = userEvent.setup();
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));
    await screen.findByText("New Issue");

    // The button stays enabled (until the request starts) so clicking it runs
    // validation instead of being inert.
    await user.click(screen.getByTestId("new-issue-submit"));

    expect(await screen.findByTestId("new-issue-error")).toHaveTextContent(
      "Title is required.",
    );
    expect(screen.getByTestId("new-issue-title-input")).toHaveFocus();
    // Form-submit errors are inline just — does not a toast.
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastDefault).not.toHaveBeenCalled();
  });

  it("suppresses the shared dialog close X while keeping Cancel as a dismiss path (REEF-111)", async () => {
    const user = userEvent.setup();
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));

    await screen.findByText("New Issue");
    // The header already owns the top-right action row, so the built-in
    // DialogContent close X (sr label "Close") is opted out.
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();

    // The footer Cancel remains a working dismiss path.
    await user.click(screen.getByTestId("new-issue-cancel"));
    expect(mockViewStore.state.newIssueDialogOpen).toBe(false);
  });

  it("lets the user add external references while creating an issue", async () => {
    const user = userEvent.setup();
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));

    await screen.findByText("New Issue");
    const deliveryLinks = screen.getByText("Delivery links").closest("section");
    expect(deliveryLinks).not.toBeNull();
    const refs = within(deliveryLinks as HTMLElement);
    await user.type(
      refs.getByLabelText("External reference"),
      "https://example.com/spec",
    );
    await user.type(refs.getByLabelText("Title"), "Spec");
    await user.click(refs.getByRole("button", { name: "Add reference" }));

    expect(refs.getAllByText("URL").length).toBeGreaterThan(0);
    expect(refs.getByText("Spec")).toBeInTheDocument();
  });
});
