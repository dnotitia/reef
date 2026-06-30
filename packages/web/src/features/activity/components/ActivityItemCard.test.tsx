import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityFeedItem } from "../types";

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
    readOnly,
  }: {
    value: string;
    onChange: (markdown: string) => void;
    placeholder?: string;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid="mock-markdown-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
    />
  ),
}));

vi.mock("@/components/AssigneeCombobox", () => ({
  AssigneeCombobox: ({
    id,
    label = "Assignee",
    value,
    onChange,
  }: {
    id?: string;
    label?: string;
    value: string;
    onChange: (login: string) => void;
  }) => (
    <input
      id={id}
      aria-label={label}
      data-testid="mock-assignee-combobox"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("@/features/planning/components/PlanningItemCombobox", () => ({
  PlanningItemCombobox: ({
    kind,
    label,
    value,
    onChange,
    testId,
  }: {
    kind: string;
    label?: string;
    value: string;
    onChange: (id: string) => void;
    testId?: string;
  }) => (
    <input
      aria-label={label ?? kind}
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { ActivityItemCard } from "./ActivityItemCard";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

const makeDraft = (id = "reef-draft-0000000000000001") => ({
  id,
  kind: "draft" as const,
  proposal: {
    operation: "create" as const,
    create: {
      fields: {
        title: "Test Draft Title",
        issue_type: "task" as const,
      },
      content: "Test description",
    },
  },
  repo: "owner/repo",
  fingerprint: `owner/repo:commit:${id}`,
  provenance: {
    type: "commit" as const,
    ref: "abc123",
    repo: "owner/repo",
    actor: "actor",
    detectedAt: "2026-04-13T10:00:00.000Z",
  },
  confidence: 0.87,
  reasoning: "Test reasoning",
  status: "pending" as const,
  created_at: "2026-04-13T10:00:00.000Z",
  detected_at: "2026-04-13T10:00:00.000Z",
});

const makeStatusChange = (id = "reef-status-0123456789abcdef") => ({
  id,
  kind: "status_change" as const,
  repo: "owner/repo",
  fingerprint: `REEF-101:${id}`,
  proposal: {
    operation: "update" as const,
    update: {
      issue_id: "REEF-101",
      patch: { status: "done" as const },
    },
  },
  issue_title: "Polish activity feed review experience",
  from_status: "in_review" as const,
  rationale: "Unified the review cards for AI-generated inbox items.",
  evidence: [
    { type: "pr" as const, ref: "294", repo: "owner/repo", actor: "dev" },
  ],
  confidence: 0.91,
  status: "pending" as const,
  created_at: "2026-04-13T10:30:00.000Z",
  detected_at: "2026-04-13T10:00:00.000Z",
});

const aiDraftItem: ActivityFeedItem = {
  id: "reef-draft-0000000000000001",
  type: "ai_draft",
  timestamp: "2026-04-13T10:00:00.000Z",
  draft: makeDraft("reef-draft-0000000000000001"),
};

const aiStatusChangeItem: ActivityFeedItem = {
  id: "reef-status-0123456789abcdef",
  type: "ai_status_change",
  timestamp: "2026-04-13T10:30:00.000Z",
  issueId: "REEF-101",
  issueTitle: "Polish activity feed review experience",
  statusChange: makeStatusChange("reef-status-0123456789abcdef"),
};

describe("ActivityItemCard", () => {
  describe("ai_draft", () => {
    it("renders draft title and confidence badge", () => {
      render(wrap(<ActivityItemCard item={aiDraftItem} />));

      expect(screen.getByTestId("activity-item-ai_draft")).toBeInTheDocument();
      expect(screen.getByText("Test Draft Title")).toBeInTheDocument();
      expect(screen.getByText(/87% confidence/)).toBeInTheDocument();
    });

    it("renders Approve and Dismiss buttons", () => {
      render(wrap(<ActivityItemCard item={aiDraftItem} />));

      expect(
        screen.getByRole("button", { name: /Approve/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Dismiss/i }),
      ).toBeInTheDocument();
    });

    it("calls onApproveDraft when Approve is clicked", async () => {
      const onApprove = vi.fn().mockResolvedValueOnce(undefined);
      const user = userEvent.setup();

      render(
        wrap(
          <ActivityItemCard item={aiDraftItem} onApproveDraft={onApprove} />,
        ),
      );

      await user.click(screen.getByRole("button", { name: /Approve/i }));

      expect(onApprove).toHaveBeenCalledWith(
        makeDraft("reef-draft-0000000000000001"),
      );
    });

    it("calls onDismissDraft with draft id when Dismiss is clicked", async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();

      render(
        wrap(
          <ActivityItemCard item={aiDraftItem} onDismissDraft={onDismiss} />,
        ),
      );

      await user.click(screen.getByRole("button", { name: /Dismiss/i }));

      expect(onDismiss).toHaveBeenCalledWith("reef-draft-0000000000000001");
    });

    it("shows approving state when isApproving is true", () => {
      render(wrap(<ActivityItemCard item={aiDraftItem} isApproving />));

      expect(screen.getByRole("button", { name: /Approving/i })).toBeDisabled();
    });

    it("renders provenance, implementation refs, and related issues as links", () => {
      const draft = makeDraft("reef-draft-0000000000000002");
      const item: ActivityFeedItem = {
        id: draft.id,
        type: "ai_draft",
        timestamp: draft.created_at,
        draft: {
          ...draft,
          proposal: {
            ...draft.proposal,
            create: {
              ...draft.proposal.create,
              fields: {
                ...draft.proposal.create.fields,
                parent_id: "REEF-100",
                depends_on: ["REEF-101"],
                blocks: ["REEF-102"],
                related_to: ["REEF-103"],
                implementation_refs: [
                  {
                    type: "pull_request" as const,
                    repo: "owner/repo",
                    ref: "294",
                    url: "https://github.com/owner/repo/pull/294",
                    title: "Polish activity cards",
                  },
                  {
                    type: "commit" as const,
                    repo: "owner/repo",
                    ref: "abcdef1234567890",
                  },
                  {
                    type: "branch" as const,
                    repo: "owner/repo",
                    ref: "feature/from-fork",
                  },
                ],
              },
            },
          },
        },
      };

      render(wrap(<ActivityItemCard item={item} />));

      expect(
        screen.getByRole("link", { name: "commit abc123" }),
      ).toHaveAttribute("href", "https://github.com/owner/repo/commit/abc123");
      expect(screen.getByRole("link", { name: "PR 294" })).toHaveAttribute(
        "href",
        "https://github.com/owner/repo/pull/294",
      );
      expect(
        screen.getByRole("link", { name: "commit abcdef1" }),
      ).toHaveAttribute(
        "href",
        "https://github.com/owner/repo/commit/abcdef1234567890",
      );
      expect(
        screen.queryByRole("link", { name: "branch feature/from-fork" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("branch feature/from-fork")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "parent REEF-100" }),
      ).toHaveAttribute("href", "/issues/REEF-100");
      expect(
        screen.getByRole("link", { name: "depends REEF-101" }),
      ).toHaveAttribute("href", "/issues/REEF-101");
      expect(
        screen.getByRole("link", { name: "blocks REEF-102" }),
      ).toHaveAttribute("href", "/issues/REEF-102");
      expect(
        screen.getByRole("link", { name: "related REEF-103" }),
      ).toHaveAttribute("href", "/issues/REEF-103");
    });

    it("edits drafts with the shared issue draft field syntax", async () => {
      const onSave = vi.fn().mockResolvedValueOnce(undefined);
      const user = userEvent.setup();

      render(
        wrap(<ActivityItemCard item={aiDraftItem} onSaveDraftEdits={onSave} />),
      );

      await user.click(screen.getByTestId("draft-edit"));

      expect(screen.getByText("Labels")).toBeInTheDocument();
      expect(screen.getByTestId("draft-edit-labels")).toHaveAttribute(
        "placeholder",
        "Add a label and press Enter…",
      );
      expect(screen.getByTestId("draft-edit-description")).toContainElement(
        screen.getByTestId("mock-markdown-editor"),
      );

      fireEvent.change(screen.getByTestId("draft-edit-title"), {
        target: { value: "Updated draft" },
      });
      fireEvent.change(screen.getByTestId("draft-edit-labels"), {
        target: { value: " bug, feature ,, " },
      });
      fireEvent.blur(screen.getByTestId("draft-edit-labels"));
      fireEvent.change(screen.getByLabelText("Assignee"), {
        target: { value: "alice" },
      });
      fireEvent.change(screen.getByTestId("draft-edit-sprint"), {
        target: { value: "11111111-1111-4111-8111-111111111111" },
      });
      fireEvent.change(screen.getByTestId("draft-edit-milestone"), {
        target: { value: "22222222-2222-4222-8222-222222222222" },
      });
      fireEvent.change(screen.getByTestId("draft-edit-release"), {
        target: { value: "33333333-3333-4333-8333-333333333333" },
      });
      fireEvent.change(screen.getByTestId("mock-markdown-editor"), {
        target: { value: "# Heading" },
      });
      await user.click(screen.getByTestId("draft-save"));

      expect(onSave).toHaveBeenCalledWith("reef-draft-0000000000000001", {
        fields: {
          title: "Updated draft",
          issue_type: "task",
          priority: null,
          assigned_to: "alice",
          requester: null,
          reporter: null,
          start_date: null,
          due_date: null,
          milestone_id: "22222222-2222-4222-8222-222222222222",
          sprint_id: "11111111-1111-4111-8111-111111111111",
          release_id: "33333333-3333-4333-8333-333333333333",
          estimate_points: null,
          severity: null,
          parent_id: null,
          depends_on: undefined,
          blocks: undefined,
          related_to: undefined,
          labels: ["bug", "feature"],
        },
        content: "# Heading",
      });
    });
  });

  describe("ai_status_change", () => {
    it("renders rationale, linked issue, transition, and evidence count", () => {
      render(wrap(<ActivityItemCard item={aiStatusChangeItem} />));

      expect(
        screen.getByTestId("activity-item-ai_status_change"),
      ).toBeInTheDocument();
      expect(screen.getByText("AI Status Change")).toBeInTheDocument();
      expect(screen.getByText("REEF-101")).toBeInTheDocument();
      expect(
        screen.getByTestId("status-change-transition"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Unified the review cards for AI-generated inbox items.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("1 commit / PR")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "pr 294" })).toHaveAttribute(
        "href",
        "https://github.com/owner/repo/pull/294",
      );
    });

    it("calls onApproveStatusChange when Approve is clicked", async () => {
      const onApprove = vi.fn().mockResolvedValueOnce(undefined);
      const user = userEvent.setup();

      render(
        wrap(
          <ActivityItemCard
            item={aiStatusChangeItem}
            onApproveStatusChange={onApprove}
          />,
        ),
      );

      await user.click(screen.getByRole("button", { name: /Approve/i }));

      expect(onApprove).toHaveBeenCalledWith(
        makeStatusChange("reef-status-0123456789abcdef"),
      );
    });

    it("shows updating state when isApproving is true", () => {
      render(wrap(<ActivityItemCard item={aiStatusChangeItem} isApproving />));

      expect(screen.getByRole("button", { name: /Updating/i })).toBeDisabled();
    });

    it("calls onDismissStatusChange with the id when Dismiss is clicked", async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();

      render(
        wrap(
          <ActivityItemCard
            item={aiStatusChangeItem}
            onDismissStatusChange={onDismiss}
          />,
        ),
      );

      await user.click(screen.getByRole("button", { name: /Dismiss/i }));

      expect(onDismiss).toHaveBeenCalledWith("reef-status-0123456789abcdef");
    });

    it("edits the target status and calls onSaveStatusChange on Save", async () => {
      const onSave = vi.fn().mockResolvedValueOnce(undefined);
      const user = userEvent.setup();

      render(
        wrap(
          <ActivityItemCard
            item={aiStatusChangeItem}
            onSaveStatusChange={onSave}
          />,
        ),
      );

      // The target Select is just rendered in edit mode.
      expect(
        screen.queryByTestId("status-change-target"),
      ).not.toBeInTheDocument();

      await user.click(screen.getByTestId("status-change-edit"));

      await user.click(screen.getByTestId("status-change-target"));
      await user.click(
        await screen.findByRole("option", { name: "In Progress" }),
      );

      await user.click(screen.getByTestId("status-change-save"));

      expect(onSave).toHaveBeenCalledWith(
        "reef-status-0123456789abcdef",
        "in_progress",
      );
    });
  });
});
