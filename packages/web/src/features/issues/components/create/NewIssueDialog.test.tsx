import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { mockMarkdownMentionConfig } = vi.hoisted(() => ({
  mockMarkdownMentionConfig: { current: null as unknown },
}));

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    mentionConfig,
    placeholder,
    sourcePlaceholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    mentionConfig?: unknown;
    placeholder?: string;
    sourcePlaceholder?: string;
  }) => {
    mockMarkdownMentionConfig.current = mentionConfig;
    return (
      <>
        <span data-testid="markdown-wysiwyg-placeholder">{placeholder}</span>
        <button type="button">Source</button>
        <textarea
          data-testid="markdown-source-textarea"
          value={value}
          placeholder={sourcePlaceholder ?? placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </>
    );
  },
}));

const { mockViewStore } = vi.hoisted(() => ({
  mockViewStore: {
    state: {
      newIssueDialogOpen: false,
      newIssueDialogContext: null as unknown,
    },
  },
}));

const { mockEnrichmentState } = vi.hoisted(() => ({
  mockEnrichmentState: {
    exposeParentOverride: false,
  },
}));

vi.mock("@/features/ui/stores/useViewStore", () => ({
  useViewStore: <T,>(
    selector: (s: {
      newIssueDialogOpen: boolean;
      newIssueDialogContext: unknown;
      closeNewIssueDialog: () => void;
    }) => T,
  ): T =>
    selector({
      newIssueDialogOpen: mockViewStore.state.newIssueDialogOpen,
      newIssueDialogContext: mockViewStore.state.newIssueDialogContext,
      closeNewIssueDialog: () => {
        mockViewStore.state.newIssueDialogOpen = false;
        mockViewStore.state.newIssueDialogContext = null;
      },
    }),
}));

vi.mock("./useNewIssueEnrichment", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useNewIssueEnrichment: ({
      formApi,
    }: {
      formApi: { setParentId: (value: string) => void };
    }) => ({
      enrichment: {
        counts: { pending: 0, accepted: 0 },
        dismissAll: vi.fn(),
        reset: vi.fn(),
      },
      enrichMutation: {
        error: null,
        isPending: false,
        isSuccess: false,
        data: null,
        mutate: vi.fn(),
        reset: vi.fn(),
      },
      enrichError: undefined,
      enrichIsEmpty: false,
      showEnrichmentBar: false,
      buildEnrichmentRequest: vi.fn(() => null),
      handleAcceptAll: vi.fn(),
      handleEnrichClick: vi.fn(),
      renderEnrichable: (field: unknown, control: ReactNode) =>
        React.createElement(
          React.Fragment,
          null,
          mockEnrichmentState.exposeParentOverride && field === "title"
            ? React.createElement(
                "button",
                {
                  type: "button",
                  "data-testid": "force-hidden-parent",
                  onClick: () => formApi.setParentId("REEF-999"),
                },
                "Force hidden parent",
              )
            : null,
          control,
        ),
      renderFieldLabel: (_field: unknown, htmlFor: string, text: string) =>
        React.createElement(
          "label",
          {
            className: "text-xs font-medium text-muted-foreground",
            htmlFor,
          },
          text,
        ),
    }),
  };
});

// Keep this integration test focused on New Issue ownership and request
// grounding; ChatSurface's rendering and retry affordance have their own
// component tests.
vi.mock("@/features/ai/components/ChatSurface", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  interface Props {
    messages: readonly { role: string; text: string }[];
    sendMessage: (input: { text: string }) => void;
    inputTestId?: string;
    submitTestId?: string;
  }
  return {
    ChatSurface: ({
      messages,
      sendMessage,
      inputTestId,
      submitTestId,
    }: Props) => {
      const [text, setText] = React.useState("");
      return React.createElement(
        "div",
        { "data-testid": "mock-new-issue-chat-surface" },
        React.createElement(
          "div",
          { "data-testid": "mock-new-issue-chat-messages" },
          messages.map((message, index) =>
            React.createElement(
              "span",
              { key: `${message.role}-${index}` },
              message.text,
            ),
          ),
        ),
        React.createElement("textarea", {
          "data-testid": inputTestId,
          value: text,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setText(event.target.value),
        }),
        React.createElement(
          "button",
          {
            type: "button",
            "data-testid": submitTestId,
            onClick: () => sendMessage({ text }),
          },
          "Send chat",
        ),
      );
    },
  };
});

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

import { apiFetch } from "@/lib/apiClient";
import { DEFAULT_CONFIG, type IssueMetadata } from "@reef/core";
import { NewIssueDialog } from "./NewIssueDialog";

const mockApiFetch = vi.mocked(apiFetch);

const CREATED_SUB_ISSUE: IssueMetadata = {
  id: "REEF-401",
  title: "Child work",
  status: "todo",
  issue_type: "task",
  priority: "high",
  parent_id: "REEF-352",
  sprint_id: "00000000-0000-4000-8000-000000000006",
  milestone_id: "00000000-0000-4000-8000-0000000000a6",
  labels: ["authoring", "ux"],
  created_at: "2026-07-07T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-07-07T00:00:00.000Z",
  updated_by: "alice",
};

function installDefaultApiMocks() {
  mockApiFetch.mockImplementation((url, init) => {
    if (url === "/api/issues" && init?.method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ issue: CREATED_SUB_ISSUE }), {
          status: 201,
        }),
      );
    }
    if (url === "/api/agents/runs" && init?.method === "POST") {
      const events = [
        {
          event_id: "chat:started",
          run_id: "chat:run",
          task_id: "chat.workspace",
          seq: 0,
          created_at: "2026-07-07T00:00:00.000Z",
          metadata: {},
          type: "run.started",
          run_status: "running",
          input: {},
        },
        {
          event_id: "chat:delta",
          run_id: "chat:run",
          task_id: "chat.workspace",
          seq: 1,
          created_at: "2026-07-07T00:00:00.000Z",
          metadata: {},
          type: "model.delta",
          delta: "Advice",
          channel: "text",
        },
        {
          event_id: "chat:completed",
          run_id: "chat:run",
          task_id: "chat.workspace",
          seq: 2,
          created_at: "2026-07-07T00:00:01.000Z",
          metadata: {},
          type: "run.completed",
          run_status: "completed",
          artifact_ids: [],
          usage: {},
        },
      ];
      return Promise.resolve(
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
    }
    if (typeof url === "string" && url.startsWith("/api/config")) {
      return Promise.resolve(
        new Response(JSON.stringify({ config: DEFAULT_CONFIG }), {
          status: 200,
        }),
      );
    }
    if (typeof url === "string" && url.startsWith("/api/issues?")) {
      return Promise.resolve(
        new Response(JSON.stringify({ issues: [] }), { status: 200 }),
      );
    }
    if (typeof url === "string" && url.startsWith("/api/issues/relations")) {
      return Promise.resolve(
        new Response(JSON.stringify({ relations: [] }), { status: 200 }),
      );
    }
    if (typeof url === "string" && url.startsWith("/api/planning")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            sprints: [
              {
                id: "00000000-0000-4000-8000-000000000006",
                name: "Sprint 6",
                status: "active",
                start_date: null,
                end_date: null,
                goal: "",
                meta: {},
              },
            ],
            milestones: [
              {
                id: "00000000-0000-4000-8000-0000000000a6",
                name: "PM-M6",
                status: "open",
                target_date: null,
                meta: {},
              },
            ],
            releases: [],
          }),
          { status: 200 },
        ),
      );
    }
    if (typeof url === "string" && url.startsWith("/api/templates")) {
      return Promise.resolve(
        new Response(JSON.stringify({ templates: [] }), { status: 200 }),
      );
    }
    if (typeof url === "string" && url.startsWith("/api/vault-members")) {
      return Promise.resolve(
        new Response(JSON.stringify({ users: [] }), { status: 200 }),
      );
    }
    if (typeof url === "string" && url.startsWith("/api/issues/similar")) {
      return Promise.resolve(
        new Response(JSON.stringify({ issues: [] }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
}

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("NewIssueDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkdownMentionConfig.current = null;
    mockViewStore.state.newIssueDialogOpen = false;
    mockViewStore.state.newIssueDialogContext = null;
    mockEnrichmentState.exposeParentOverride = false;
    installDefaultApiMocks();
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
    expect(screen.getByLabelText("Start")).toBeInTheDocument();
    expect(screen.getByLabelText("Due")).toBeInTheDocument();
    expect(screen.getByLabelText("Parent")).toBeInTheDocument();
    expect(screen.getByLabelText("Blocks")).toBeInTheDocument();
    expect(screen.getByText("External references")).toBeInTheDocument();
    expect(screen.queryByText("Delivery activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();
    // REEF-167: the canvas matches the issue detail sheet width so the widened
    // rail doesn't shrink the main column.
    expect(screen.getByTestId("new-issue-dialog")).toHaveClass(
      "max-w-[min(94vw,1200px)]",
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

  it("keeps one scrollable form body and reflows header actions", async () => {
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));

    await screen.findByText("New Issue");
    const dialog = screen.getByTestId("new-issue-dialog");
    const header = screen.getByTestId("new-issue-dialog-header");
    const actions = screen.getByTestId("new-issue-dialog-actions");
    const body = screen.getByTestId("new-issue-dialog-body");
    const footer = screen.getByTestId("new-issue-dialog-footer");

    expect(dialog).toHaveClass(
      "grid",
      "min-h-0",
      "grid-rows-[auto_minmax(0,1fr)_auto]",
      "max-h-[calc(100dvh-2rem)]",
      "overflow-hidden",
      "pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
    );
    expect(dialog.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
    expect(body).toHaveClass(
      "min-w-0",
      "min-h-0",
      "overflow-y-auto",
      "overscroll-contain",
    );
    expect(header).toHaveClass("min-w-0");
    expect(actions).toHaveClass(
      "w-full",
      "min-w-0",
      "flex-wrap",
      "sm:w-auto",
      "sm:shrink-0",
    );
    expect(footer).toHaveClass("items-center", "sm:flex-row", "sm:justify-end");
    expect(
      body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("passes the unified reference search config to the issue body editor", async () => {
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));

    await screen.findByText("New Issue");
    const config = mockMarkdownMentionConfig.current as {
      issues: readonly unknown[];
      searchDocuments?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<unknown>;
      peopleSectionLabel: string;
      issuesSectionLabel: string;
      documentsSectionLabel: string;
    } | null;
    expect(config?.issues).toEqual([]);
    expect(typeof config?.searchDocuments).toBe("function");
    expect(config).toMatchObject({
      peopleSectionLabel: "People",
      issuesSectionLabel: "Issues",
      documentsSectionLabel: "Documents",
    });
  });

  it.each([
    {
      locale: "en" as const,
      wysiwyg: "Describe the issue or type / to insert a block…",
      source: "Describe the issue…",
    },
    {
      locale: "ko" as const,
      wysiwyg: "이슈를 설명하거나 /를 입력해 블록을 추가하세요…",
      source: "이슈를 설명하세요…",
    },
  ])(
    "passes separate localized WYSIWYG and Source placeholders ($locale)",
    async ({ locale, wysiwyg, source }) => {
      mockViewStore.state.newIssueDialogOpen = true;
      render(
        <IntlTestProvider locale={locale}>
          {wrap(<NewIssueDialog />)}
        </IntlTestProvider>,
      );

      await screen.findByText(locale === "en" ? "New Issue" : "새 이슈");
      expect(
        screen.getByTestId("markdown-wysiwyg-placeholder"),
      ).toHaveTextContent(wysiwyg);
      expect(screen.getByTestId("markdown-source-textarea")).toHaveAttribute(
        "placeholder",
        source,
      );
    },
  );

  it("creates a parent-locked sub-issue with inherited defaults and keeps adding", async () => {
    mockViewStore.state.newIssueDialogOpen = true;
    mockViewStore.state.newIssueDialogContext = {
      kind: "subIssue",
      parent: { id: "REEF-352", title: "Parent story" },
      defaults: {
        priority: "high",
        sprintId: "00000000-0000-4000-8000-000000000006",
        milestoneId: "00000000-0000-4000-8000-0000000000a6",
        labels: ["authoring", "ux"],
      },
    };
    render(wrap(<NewIssueDialog />));

    expect(await screen.findByText("New sub-issue")).toBeInTheDocument();
    expect(screen.getByTestId("new-issue-parent-locked")).toHaveTextContent(
      "REEF-352",
    );
    expect(screen.getByTestId("new-issue-parent-locked")).toHaveTextContent(
      "Parent story",
    );
    fireEvent.change(screen.getByTestId("new-issue-title-input"), {
      target: { value: "Child work" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    fireEvent.change(screen.getByTestId("markdown-source-textarea"), {
      target: { value: "Draft body" },
    });
    fireEvent.click(screen.getByTestId("create-and-add-another"));
    fireEvent.click(screen.getByTestId("new-issue-submit"));

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) => url === "/api/issues" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const postCall = mockApiFetch.mock.calls.find(
      ([url, init]) => url === "/api/issues" && init?.method === "POST",
    );
    expect(JSON.parse(postCall?.[1]?.body as string)).toEqual({
      vault: "reef-acme",
      prefix: "REEF",
      create: {
        content: "Draft body",
        fields: {
          title: "Child work",
          issue_type: "task",
          status: "todo",
          priority: "high",
          sprint_id: "00000000-0000-4000-8000-000000000006",
          milestone_id: "00000000-0000-4000-8000-0000000000a6",
          parent_id: "REEF-352",
          labels: ["authoring", "ux"],
        },
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("new-issue-title-input")).toHaveValue(""),
    );
    expect(screen.getByTestId("markdown-source-textarea")).toHaveValue("");
    expect(mockViewStore.state.newIssueDialogOpen).toBe(true);
  });

  it("forces the locked parent into the submit payload even if hidden state changes", async () => {
    const user = userEvent.setup();
    mockEnrichmentState.exposeParentOverride = true;
    mockViewStore.state.newIssueDialogOpen = true;
    mockViewStore.state.newIssueDialogContext = {
      kind: "subIssue",
      parent: { id: "REEF-352", title: "Parent story" },
      defaults: {
        priority: "high",
        sprintId: "00000000-0000-4000-8000-000000000006",
        milestoneId: null,
        labels: [],
      },
    };
    render(wrap(<NewIssueDialog />));

    await screen.findByText("New sub-issue");
    await user.click(screen.getByTestId("force-hidden-parent"));
    await user.type(screen.getByTestId("new-issue-title-input"), "Guarded");
    await user.click(screen.getByTestId("new-issue-submit"));

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) => url === "/api/issues" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const postCall = mockApiFetch.mock.calls.find(
      ([url, init]) => url === "/api/issues" && init?.method === "POST",
    );
    const fields = JSON.parse(postCall?.[1]?.body as string).create.fields;
    expect(fields.parent_id).toBe("REEF-352");
  });

  it("omits status when a sub-issue clears the inherited sprint", async () => {
    const user = userEvent.setup();
    mockViewStore.state.newIssueDialogOpen = true;
    mockViewStore.state.newIssueDialogContext = {
      kind: "subIssue",
      parent: { id: "REEF-352", title: "Parent story" },
      defaults: {
        priority: "high",
        sprintId: "00000000-0000-4000-8000-000000000006",
        milestoneId: "00000000-0000-4000-8000-0000000000a6",
        labels: ["authoring", "ux"],
      },
    };
    render(wrap(<NewIssueDialog />));

    await screen.findByText("New sub-issue");
    await user.click(await screen.findByLabelText("Sprint: Sprint 6"));
    await user.click(await screen.findByRole("option", { name: /No sprint/i }));
    fireEvent.change(screen.getByTestId("new-issue-title-input"), {
      target: { value: "Backlog child" },
    });
    fireEvent.click(screen.getByTestId("new-issue-submit"));

    await waitFor(() =>
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) => url === "/api/issues" && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const postCall = mockApiFetch.mock.calls.find(
      ([url, init]) => url === "/api/issues" && init?.method === "POST",
    );
    const fields = JSON.parse(postCall?.[1]?.body as string).create.fields;
    expect(fields).toMatchObject({
      title: "Backlog child",
      parent_id: "REEF-352",
      priority: "high",
      milestone_id: "00000000-0000-4000-8000-0000000000a6",
      labels: ["authoring", "ux"],
    });
    expect(fields).not.toHaveProperty("sprint_id");
    expect(fields).not.toHaveProperty("status");
  });

  it("lays out the rail metadata as property rows and keeps Labels stacked (REEF-167)", async () => {
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));
    await screen.findByText("New Issue");

    // Details + People + Planning + Parent/Relations fields are each one
    // property row (fixed label + full-width value), matching the issue detail
    // rail — not `grid-cols-2` half-cells. Probe representative fields.
    for (const label of [
      "Type",
      "Priority",
      "Assignee",
      "Start",
      "Severity",
      "Parent",
      "Blocks",
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

  it("grounds each chat turn in the latest draft while manual create stays independent", async () => {
    const user = userEvent.setup();
    mockViewStore.state.newIssueDialogOpen = true;
    render(wrap(<NewIssueDialog />));
    await screen.findByText("New Issue");

    await user.type(
      screen.getByTestId("new-issue-title-input"),
      "First draft title",
    );
    await user.click(screen.getByTestId("new-issue-chat-trigger"));
    await user.type(
      screen.getByTestId("markdown-source-textarea"),
      "First draft body",
    );
    await user.type(
      screen.getByTestId("new-issue-chat-input"),
      "What should I improve?",
    );
    await user.click(screen.getByTestId("new-issue-chat-send"));

    await waitFor(() => {
      expect(
        mockApiFetch.mock.calls.filter(
          ([url, init]) =>
            url === "/api/agents/runs" && init?.method === "POST",
        ),
      ).toHaveLength(1);
    });
    const firstRun = JSON.parse(
      mockApiFetch.mock.calls.find(
        ([url, init]) => url === "/api/agents/runs" && init?.method === "POST",
      )?.[1]?.body as string,
    );
    expect(firstRun.input.draft).toMatchObject({
      fields: { title: "First draft title" },
      content: "First draft body",
    });

    await user.clear(screen.getByTestId("new-issue-title-input"));
    await user.type(
      screen.getByTestId("new-issue-title-input"),
      "Edited draft title",
    );
    await user.clear(screen.getByTestId("markdown-source-textarea"));
    await user.type(
      screen.getByTestId("markdown-source-textarea"),
      "Edited draft body",
    );
    await user.clear(screen.getByTestId("new-issue-chat-input"));
    await user.type(screen.getByTestId("new-issue-chat-input"), "And now?");
    await user.click(screen.getByTestId("new-issue-chat-send"));

    await waitFor(() => {
      expect(
        mockApiFetch.mock.calls.filter(
          ([url, init]) =>
            url === "/api/agents/runs" && init?.method === "POST",
        ),
      ).toHaveLength(2);
    });
    const runBodies = mockApiFetch.mock.calls
      .filter(
        ([url, init]) => url === "/api/agents/runs" && init?.method === "POST",
      )
      .map(([, init]) => JSON.parse(init?.body as string));
    expect(runBodies[1]?.input.draft).toMatchObject({
      fields: { title: "Edited draft title" },
      content: "Edited draft body",
    });
    expect(runBodies[1]?.input.messages).toHaveLength(3);

    await user.click(screen.getByTestId("new-issue-submit"));
    await waitFor(() => {
      expect(
        mockApiFetch.mock.calls.some(
          ([url, init]) => url === "/api/issues" && init?.method === "POST",
        ),
      ).toBe(true);
    });
    const createCall = mockApiFetch.mock.calls.find(
      ([url, init]) => url === "/api/issues" && init?.method === "POST",
    );
    const createBody = JSON.parse(createCall?.[1]?.body as string);
    expect(createBody.create).toMatchObject({
      content: "Edited draft body",
      fields: { title: "Edited draft title" },
    });
    expect(createBody).not.toHaveProperty("chat");
    expect(createBody).not.toHaveProperty("draft");
  }, 15_000);

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
