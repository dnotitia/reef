import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

// The header breadcrumb + sub-issue rows now call the drill hook (REEF-270),
// which reads router + the live query, so the detail tree needs both navigation
// primitives stubbed. An empty `useSearchParams` keeps relation hrefs bare.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ vault: "reef-acme" }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";
import { toast } from "sonner";
import { formatAbsoluteTime } from "../../lib/formatRelativeTime";
import { IssueDetail } from "./IssueDetail";

const mockApiFetch = vi.mocked(apiFetch);
const mockToastDismiss = vi.mocked(toast.dismiss);
const mockToastError = vi.mocked(toast.error);
const mockToastSuccess = vi.mocked(toast.success);

const SAMPLE: IssueMetadata = {
  id: "REEF-001",
  title: "Sample title",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

const SPRINT_ID = "11111111-1111-4111-8111-111111111111";
const PLANNING_CATALOG = {
  sprints: [
    {
      id: SPRINT_ID,
      name: "Sprint 2",
      status: "planned",
      start_date: null,
      end_date: null,
      goal: "",
      capacity_points: null,
    },
  ],
  milestones: [],
  releases: [],
};

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function wrapStrict(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </StrictMode>
  );
}

function wrapWithClient(queryClient: QueryClient, ui: ReactNode) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("IssueDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: GET /api/issues/REEF-001 returns the sample
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: SAMPLE, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [SAMPLE] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/planning?vault=")) {
        return new Response(JSON.stringify(PLANNING_CATALOG), { status: 200 });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
  });

  it("requests /api/issues/{id}?vault={vault} on mount", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001?vault=reef-acme",
    );
  });

  it("renders the issue title input populated from the loaded issue", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    expect(await screen.findByDisplayValue("Sample title")).toBeInTheDocument();
  });

  it("copies the canonical deep link from the actions menu and toasts success", async () => {
    // userEvent.setup() installs its own navigator.clipboard stub, so define
    // ours afterwards to win. jsdom has no clipboard by default (not a secure
    // context), which is exactly why the handler guards it.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");

    await user.click(screen.getByTestId("issue-more-trigger"));
    await user.click(await screen.findByTestId("issue-copy-link"));

    // Rebuilt from vault + id (not window.location), and free of the ephemeral
    // ?view= query — the clean shareable deep link the base route resolves.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/workspace/reef-acme/issues/REEF-001`,
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    // Simulate an insecure context / no Clipboard API — the guard should keep
    // the copy from throwing and surface an error toast instead.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");

    await user.click(screen.getByTestId("issue-more-trigger"));
    await user.click(await screen.findByTestId("issue-copy-link"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("shows the last-edited relative time in the header", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");
    const edited = await screen.findByTestId("issue-updated-at");
    expect(edited).toHaveTextContent(/Edited/);
    // Absolute timestamp is preserved on hover for precision — now the active
    // locale's UTC-pinned format (REEF-294), not the viewer's system locale.
    expect(edited).toHaveAttribute(
      "title",
      expect.stringContaining(formatAbsoluteTime(SAMPLE.updated_at, "en")),
    );
  });

  it("forwards vault to AssigneeCombobox (which then hits /api/vault-members)", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");
    // AssigneeCombobox renders eagerly with vault prop — its data fetch is gated
    // on user opening the popover, so just verify the combobox container exists.
    expect(await screen.findAllByTestId("assignee-combobox")).toHaveLength(3);
  });

  function patchCalls() {
    return mockApiFetch.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
  }

  it("auto-saves the title with a PATCH when edited and blurred", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    const input = await screen.findByDisplayValue("Sample title");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const [url, init] = patchCalls()[0];
    expect(url).toBe("/api/issues/REEF-001");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.update).toMatchObject({
      issue_id: "REEF-001",
      patch: { title: "Renamed title" },
    });
  });

  it("does not PATCH for a no-op title blur (only real changes commit)", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    const input = await screen.findByDisplayValue("Sample title");

    // Blur without changing the title — should not commit.
    fireEvent.blur(input);
    // Then make a genuine edit so there is a deterministic PATCH to await.
    // Proving the negative by contrast: if the no-op blur had committed, we'd
    // see 2 PATCHes (or the first would carry the unchanged title) instead of
    // exactly the one real change below.
    fireEvent.change(input, { target: { value: "Changed title" } });
    fireEvent.blur(input);

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toMatchObject({
      issue_id: "REEF-001",
      patch: { title: "Changed title" },
    });
  });

  it("shows a saved indicator after a successful auto-save", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    const input = await screen.findByDisplayValue("Sample title");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
        "Saved",
      ),
    );
  });

  it("does not let a stale save completion mark the next issue as saved", async () => {
    const pendingSave = deferred<Response>();
    const nextIssue: IssueMetadata = {
      ...SAMPLE,
      id: "REEF-002",
      title: "Second title",
      updated_at: "2026-05-02T00:00:00.000Z",
    };
    mockApiFetch.mockImplementation(async (url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (method === "PATCH" && u === "/api/issues/REEF-001") {
        return pendingSave.promise;
      }
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: SAMPLE, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues/REEF-002")) {
        return new Response(
          JSON.stringify({ issue: nextIssue, content: "## second" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [SAMPLE, nextIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      wrapWithClient(
        queryClient,
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    const input = await screen.findByDisplayValue("Sample title");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
        "Saving",
      ),
    );

    view.rerender(
      wrapWithClient(
        queryClient,
        <IssueDetail issueId="REEF-002" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Second title");

    pendingSave.resolve(
      new Response(
        JSON.stringify({
          issue: { ...SAMPLE, title: "Renamed title" },
          content: "## body",
        }),
        { status: 200 },
      ),
    );
    await pendingSave.promise;
    await Promise.resolve();

    expect(screen.queryByTestId("issue-save-status")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Second title")).toBeInTheDocument();
  });

  it("dismisses a failed save toast so stale retry cannot replay on the next issue", async () => {
    const nextIssue: IssueMetadata = {
      ...SAMPLE,
      id: "REEF-002",
      title: "Second title",
      updated_at: "2026-05-02T00:00:00.000Z",
    };
    mockApiFetch.mockImplementation(async (url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (method === "PATCH" && u === "/api/issues/REEF-001") {
        return new Response(JSON.stringify({ error: "save boom" }), {
          status: 500,
        });
      }
      if (method === "PATCH" && u === "/api/issues/REEF-002") {
        return new Response(JSON.stringify({ error: "stale retry" }), {
          status: 500,
        });
      }
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: SAMPLE, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues/REEF-002")) {
        return new Response(
          JSON.stringify({ issue: nextIssue, content: "## second" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [SAMPLE, nextIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      wrapWithClient(
        queryClient,
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    const input = await screen.findByDisplayValue("Sample title");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);
    await screen.findByTestId("issue-save-retry");

    const retryToast = mockToastError.mock.calls.at(-1)?.[1] as
      | { action?: { onClick?: () => void } }
      | undefined;
    expect(retryToast?.action?.onClick).toBeTypeOf("function");

    view.rerender(
      wrapWithClient(
        queryClient,
        <IssueDetail issueId="REEF-002" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Second title");
    expect(mockToastDismiss).toHaveBeenCalledWith("save:REEF-001");

    retryToast?.action?.onClick?.();
    await Promise.resolve();

    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0][0]).toBe("/api/issues/REEF-001");
    expect(screen.queryByTestId("issue-save-status")).not.toBeInTheDocument();
  });

  it("shows a retryable 'Not saved' chip on auto-save failure and retries the same commit", async () => {
    let patchCount = 0;
    mockApiFetch.mockImplementation(async (url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (method === "PATCH" && u === "/api/issues/REEF-001") {
        patchCount += 1;
        if (patchCount === 1) {
          return new Response(JSON.stringify({ error: "save boom" }), {
            status: 500,
          });
        }
        return new Response(
          JSON.stringify({
            issue: { ...SAMPLE, title: "Renamed title" },
            content: "## body",
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues/REEF-001/provenance")) {
        return new Response(
          JSON.stringify({
            snapshot: {
              doc_id: "d-1",
              title: "Sample title",
              path: "issues/REEF-001.md",
              vault: "reef-acme",
              uri: "akb://reef-acme/issues/REEF-001.md",
              created_by: "alice",
              created_at: SAMPLE.created_at,
              updated_at: SAMPLE.updated_at,
              current_commit: "abc1234",
              relations: [],
            },
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: SAMPLE, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [SAMPLE] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    const input = await screen.findByDisplayValue("Sample title");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);

    // Failure surfaces as the "Not saved · Retry" chip (idle → saving → error).
    const retry = await screen.findByTestId("issue-save-retry");
    expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
      "Not saved",
    );
    expect(patchCount).toBe(1);
    expect(input).toHaveValue("Renamed title");

    // Retry re-runs the same commit and resolves to "Saved".
    fireEvent.click(retry);
    await waitFor(() => expect(patchCount).toBe(2));
    await waitFor(() =>
      expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
        "Saved",
      ),
    );

    const patchBodies = patchCalls().map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    );
    expect(patchBodies).toHaveLength(2);
    expect(patchBodies[0].update.patch).toEqual({ title: "Renamed title" });
    expect(patchBodies[1].update.patch).toEqual({ title: "Renamed title" });
  });

  it("keeps an earlier field's failure surfaced when a later, unrelated field saves", async () => {
    // title save fails; a subsequent priority change succeeds. The unrelated
    // success should not clear the title failure or falsely claim "Saved".
    const prioritizedIssue: IssueMetadata = { ...SAMPLE, priority: "high" };
    let titleAttempts = 0;
    mockApiFetch.mockImplementation(async (url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (method === "PATCH" && u === "/api/issues/REEF-001") {
        const patch = JSON.parse(String((init as RequestInit).body)).update
          .patch as Record<string, unknown>;
        if ("title" in patch) {
          titleAttempts += 1;
          return new Response(JSON.stringify({ error: "title boom" }), {
            status: 500,
          });
        }
        return new Response(
          JSON.stringify({ issue: prioritizedIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues/REEF-001/provenance")) {
        return new Response(
          JSON.stringify({
            snapshot: {
              doc_id: "d-1",
              title: "Sample title",
              path: "issues/REEF-001.md",
              vault: "reef-acme",
              uri: "akb://reef-acme/issues/REEF-001.md",
              created_by: "alice",
              created_at: SAMPLE.created_at,
              updated_at: SAMPLE.updated_at,
              current_commit: "abc1234",
              relations: [],
            },
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: prioritizedIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [prioritizedIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    const input = await screen.findByDisplayValue("Sample title");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);

    // Title failure surfaces as "Not saved · Retry".
    await screen.findByTestId("issue-save-retry");
    expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
      "Not saved",
    );

    // A different field (priority) now saves successfully.
    await user.click(screen.getByTestId("issue-priority-select"));
    await user.click(
      await screen.findByRole("option", { name: "No priority" }),
    );
    await waitFor(() =>
      expect(
        patchCalls().some(([, init]) => {
          const p = JSON.parse(String((init as RequestInit).body)).update.patch;
          return "priority" in p;
        }),
      ).toBe(true),
    );

    // The unrelated success should not flip to "Saved"; the title failure and its
    // Retry stay put.
    expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
      "Not saved",
    );
    expect(screen.getByTestId("issue-save-retry")).toBeInTheDocument();
    expect(titleAttempts).toBe(1);
  });

  it("retries every still-unsaved field (not the latest) before reporting Saved", async () => {
    // Both title and priority fail. Retry should replay BOTH; just once both
    // succeed does the chip report "Saved" — a single-slot model would lose the
    // earlier failure and falsely show Saved after retrying one.
    const prioritized: IssueMetadata = { ...SAMPLE, priority: "high" };
    const fail = { title: true, priority: true };
    let titlePatches = 0;
    let priorityPatches = 0;
    mockApiFetch.mockImplementation(async (url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (method === "PATCH" && u === "/api/issues/REEF-001") {
        const patch = JSON.parse(String((init as RequestInit).body)).update
          .patch as Record<string, unknown>;
        if ("title" in patch) {
          titlePatches += 1;
          if (fail.title) {
            return new Response(JSON.stringify({ error: "t boom" }), {
              status: 500,
            });
          }
          return new Response(
            JSON.stringify({
              issue: { ...prioritized, title: "Renamed title" },
              content: "## body",
            }),
            { status: 200 },
          );
        }
        if ("priority" in patch) {
          priorityPatches += 1;
          if (fail.priority) {
            return new Response(JSON.stringify({ error: "p boom" }), {
              status: 500,
            });
          }
          return new Response(
            JSON.stringify({ issue: prioritized, content: "## body" }),
            { status: 200 },
          );
        }
      }
      if (u.startsWith("/api/issues/REEF-001/provenance")) {
        return new Response(
          JSON.stringify({
            snapshot: {
              doc_id: "d-1",
              title: "Sample title",
              path: "issues/REEF-001.md",
              vault: "reef-acme",
              uri: "akb://reef-acme/issues/REEF-001.md",
              created_by: "alice",
              created_at: SAMPLE.created_at,
              updated_at: SAMPLE.updated_at,
              current_commit: "abc1234",
              relations: [],
            },
          }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: prioritized, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [prioritized] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    const input = await screen.findByDisplayValue("Sample title");
    fireEvent.change(input, { target: { value: "Renamed title" } });
    fireEvent.blur(input);
    await screen.findByTestId("issue-save-retry");

    // Second independent failure (priority) — both are now unsaved.
    await user.click(screen.getByTestId("issue-priority-select"));
    await user.click(
      await screen.findByRole("option", { name: "No priority" }),
    );
    await waitFor(() => expect(priorityPatches).toBe(1));
    expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
      "Not saved",
    );

    // Let both succeed, then retry once: it should replay both fields.
    fail.title = false;
    fail.priority = false;
    fireEvent.click(screen.getByTestId("issue-save-retry"));

    await waitFor(() =>
      expect(screen.getByTestId("issue-save-status")).toHaveTextContent(
        "Saved",
      ),
    );
    expect(titlePatches).toBe(2);
    expect(priorityPatches).toBe(2);
  });

  it("clears the assignee with null when Unassigned is selected", async () => {
    const assignedIssue: IssueMetadata = { ...SAMPLE, assigned_to: "alice" };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: assignedIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [assignedIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.click(screen.getByLabelText("Assignee: alice"));
    await user.click(await screen.findByRole("option", { name: "Unassigned" }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { assigned_to: null },
    });
  });

  it("clears the priority with null when No priority is selected", async () => {
    const prioritizedIssue: IssueMetadata = { ...SAMPLE, priority: "high" };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: prioritizedIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [prioritizedIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.click(screen.getByTestId("issue-priority-select"));
    await user.click(
      await screen.findByRole("option", { name: "No priority" }),
    );

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { priority: null },
    });
  });

  it("auto-saves planning selections with the detail panel vault", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/planning?vault=reef-acme",
      ),
    );

    await user.click(screen.getByLabelText("Sprint"));
    await user.click(await screen.findByRole("option", { name: /Sprint 2/ }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { sprint_id: SPRINT_ID },
    });
  });

  it("commits blocks relationships from the detail panel", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.type(screen.getByLabelText("Blocks"), "reef-002");
    await user.click(screen.getByRole("button", { name: "Add Blocks" }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { blocks: ["REEF-002"] },
    });
  });

  it("commits implementation refs from delivery activity edits", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    expect(screen.getByText("Delivery activity")).toBeInTheDocument();
    expect(screen.getByText("External references")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Activity reference"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://github.com/acme/app/pull/123" },
    });
    fireEvent.change(screen.getByLabelText("Activity title"), {
      target: { value: "Ship checkout flow" },
    });
    await user.click(screen.getByRole("button", { name: "Add activity" }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: {
        implementation_refs: [
          {
            type: "pull_request",
            ref: "123",
            url: "https://github.com/acme/app/pull/123",
            title: "Ship checkout flow",
          },
        ],
      },
    });
  });

  it("sends a status patch when status is changed from the detail panel", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.click(screen.getByTestId("issue-status-select"));
    await user.click(
      await screen.findByRole("option", { name: /In Progress/i }),
    );

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { status: "in_progress" },
    });
  });

  it("auto-saves an in-progress issue when moved to in review", async () => {
    const inProgressIssue: IssueMetadata = {
      ...SAMPLE,
      status: "in_progress",
    };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: inProgressIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [inProgressIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.click(screen.getByTestId("issue-status-select"));
    await user.click(await screen.findByRole("option", { name: /In Review/i }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { status: "in_review" },
    });
  });

  it("keeps detail auto-save active after React StrictMode effect replay", async () => {
    const inProgressIssue: IssueMetadata = {
      ...SAMPLE,
      status: "in_progress",
      start_date: "2026-06-15",
    };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: inProgressIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [inProgressIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/planning?vault=")) {
        return new Response(JSON.stringify(PLANNING_CATALOG), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const user = userEvent.setup();
    render(
      wrapStrict(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.click(screen.getByTestId("issue-status-select"));
    await user.click(await screen.findByRole("option", { name: /In Review/i }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(
      JSON.parse(String((patchCalls()[0][1] as RequestInit).body)).update,
    ).toEqual({
      issue_id: "REEF-001",
      patch: { status: "in_review" },
    });

    await user.click(screen.getByLabelText("Start: Jun 15, 2026"));
    await user.click(await screen.findByTestId("calendar-day-2026-06-16"));

    await waitFor(() => expect(patchCalls()).toHaveLength(2));
    expect(
      JSON.parse(String((patchCalls()[1][1] as RequestInit).body)).update,
    ).toEqual({
      issue_id: "REEF-001",
      patch: { start_date: "2026-06-16" },
    });
  });

  it("syncs untouched draft fields from a newer query snapshot", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const inProgressIssue: IssueMetadata = {
      ...SAMPLE,
      status: "in_progress",
    };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: inProgressIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [inProgressIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    render(
      wrapWithClient(
        queryClient,
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    expect(
      within(screen.getByTestId("issue-status-select")).getByText(
        "In Progress",
      ),
    ).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(["issues", "detail", "reef-acme", "REEF-001"], {
        issue: { ...inProgressIssue, status: "in_review" },
        content: "## body",
      });
    });

    await waitFor(() =>
      expect(
        within(screen.getByTestId("issue-status-select")).getByText(
          "In Review",
        ),
      ).toBeInTheDocument(),
    );
    expect(patchCalls()).toHaveLength(0);
  });

  it("preserves dirty draft fields when syncing a newer query snapshot", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const inProgressIssue: IssueMetadata = {
      ...SAMPLE,
      status: "in_progress",
    };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: inProgressIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [inProgressIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    render(
      wrapWithClient(
        queryClient,
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    const title = await screen.findByTestId("issue-title-input");
    fireEvent.change(title, { target: { value: "Local title draft" } });

    act(() => {
      queryClient.setQueryData(["issues", "detail", "reef-acme", "REEF-001"], {
        issue: {
          ...inProgressIssue,
          title: "Server title update",
          status: "in_review",
        },
        content: "## body",
      });
    });

    await waitFor(() =>
      expect(
        within(screen.getByTestId("issue-status-select")).getByText(
          "In Review",
        ),
      ).toBeInTheDocument(),
    );
    expect(title).toHaveValue("Local title draft");
    expect(patchCalls()).toHaveLength(0);
  });

  it("asks for a close reason before closing from the detail panel", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.click(screen.getByTestId("issue-status-select"));
    await user.click(await screen.findByRole("option", { name: /Closed/i }));

    expect(await screen.findByTestId("close-issue-dialog")).toBeInTheDocument();
    expect(patchCalls()).toHaveLength(0);

    await user.click(screen.getByTestId("closed-reason-select"));
    await user.click(await screen.findByRole("option", { name: /Duplicate/i }));
    await user.click(screen.getByTestId("close-issue-confirm"));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { status: "closed", closed_reason: "duplicate" },
    });
  });

  it("clears closed metadata when a closed issue is reopened", async () => {
    const closedIssue: IssueMetadata = {
      ...SAMPLE,
      status: "closed",
      closed_at: "2026-05-20T00:00:00.000Z",
      closed_reason: "completed",
    };
    mockApiFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/issues/REEF-001")) {
        return new Response(
          JSON.stringify({ issue: closedIssue, content: "## body" }),
          { status: 200 },
        );
      }
      if (u.startsWith("/api/issues?vault=")) {
        return new Response(JSON.stringify({ issues: [closedIssue] }), {
          status: 200,
        });
      }
      if (u.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const user = userEvent.setup();
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );

    await screen.findByDisplayValue("Sample title");
    await user.click(screen.getByTestId("issue-status-select"));
    // `open`'s option label is "Todo" (REEF-109); the enum key stays `open`.
    await user.click(await screen.findByRole("option", { name: /Todo/i }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = JSON.parse(String((patchCalls()[0][1] as RequestInit).body));
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { status: "todo" },
    });
  });

  // REEF-149: the rail is a property list (fixed label + full-width value), not
  // a `grid-cols-2` of half-cells. These assert the row structure that frees the
  // date / planning value columns, so a regression back to the cramped grid is
  // caught even though jsdom does not measure pixel truncation.
  it("lays out rail scalar fields as label↔value property rows", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");

    // Type: the aria-labelledby span and the select trigger share one row.
    const typeRow = screen
      .getByTestId("issue-type-select")
      .closest('[data-slot="issue-field-row"]');
    expect(typeRow).not.toBeNull();
    expect(
      within(typeRow as HTMLElement).getByText("Type"),
    ).toBeInTheDocument();

    // Start date: the <label> and the date trigger live in one row, so the date
    // value gets the full rail width instead of a ~134px half-cell.
    const startLabel = screen.getByText("Start");
    const startRow = startLabel.closest('[data-slot="issue-field-row"]');
    expect(startRow).not.toBeNull();
    expect(
      within(startRow as HTMLElement).getByTestId("date-picker-trigger"),
    ).toBeInTheDocument();
    // The fixed-width label is the lever that frees the value column.
    expect(startLabel.className).toContain("w-20");
  });

  it("keeps the rail's responsive stack + divider-flip contract (AC4)", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");

    // Below lg the rail stacks under main with a top divider; at lg it sits to
    // the side with a left divider.
    const aside = screen.getByTestId("issue-detail-sidebar");
    expect(aside.className).toContain("border-t");
    expect(aside.className).toContain("lg:border-l");
    expect(aside.className).toContain("lg:border-t-0");
  });

  it("uses a typographic ellipsis in the labels placeholder (WIG)", async () => {
    render(
      wrap(
        <IssueDetail issueId="REEF-001" vault="reef-acme" onClose={() => {}} />,
      ),
    );
    await screen.findByDisplayValue("Sample title");
    expect(
      screen.getByPlaceholderText("Add a label and press Enter…"),
    ).toBeInTheDocument();
  });
});
