import {
  type RenderOptions,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, options);
}

// ─── Module mocks ────────────────────────────────────────────────────────────

// AskAiDialog reads the current route (REEF-360) via next/navigation.
vi.mock("next/navigation", () => ({
  usePathname: () => "/reef-acme/issues",
}));

const useAiAvailableMock = vi.fn();
vi.mock("@/features/settings/hooks/useAiAvailable", () => ({
  useAiAvailable: () => useAiAvailableMock(),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: vi.fn(),
}));

// AskAiDialog reads the active vault for the chat run's X-Reef-Vault header
// (REEF-315).
vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}));

// The conversation controller (REEF-361). Mock it so these tests stay focused
// on AskAiDialog's own responsibilities (store wiring, close/clear handlers,
// message count callback) rather than the agent-run stack.
const useWorkspaceChatMock = vi.fn();
vi.mock("../hooks/useWorkspaceChat", () => ({
  useWorkspaceChat: (...args: unknown[]) => useWorkspaceChatMock(...args),
}));

// AskAiDialog now delegates its conversation+composer area to ChatSurface.
vi.mock("./ChatSurface", () => ({
  ChatSurface: ({
    emptyState,
    composerPlaceholder,
    composerDisabled,
    contextChip,
    inputTestId,
    submitTestId,
  }: {
    emptyState?: ReactNode;
    composerPlaceholder?: string;
    composerDisabled?: boolean;
    contextChip?: ReactNode;
    inputTestId?: string;
    submitTestId?: string;
  }) => (
    <div
      data-testid="chat-surface"
      data-composer-disabled={composerDisabled ? "true" : "false"}
      data-composer-placeholder={composerPlaceholder ?? ""}
      data-input-testid={inputTestId ?? ""}
      data-submit-testid={submitTestId ?? ""}
    >
      <div data-testid="chat-surface-empty">{emptyState}</div>
      <div data-testid="chat-surface-context">{contextChip}</div>
    </div>
  ),
}));

import { useAskAiStore } from "../stores/useAskAiStore";
import { AskAiDialog } from "./AskAiDialog";

function setChatReturn(overrides: Partial<Record<string, unknown>> = {}) {
  useWorkspaceChatMock.mockReturnValue({
    messages: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    status: "ready",
    messageCount: 0,
    ...overrides,
  });
}

describe("AskAiDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAskAiStore.setState({
      isOpen: true,
      seenMessageCount: 0,
      issueContext: null,
    });
    setChatReturn();
    useAiAvailableMock.mockReturnValue({
      isAvailable: true,
      isLoading: false,
    });
  });

  it("renders the panel marked open and visible", () => {
    render(<AskAiDialog />);
    const dialog = screen.getByTestId("ask-ai-dialog");
    expect(dialog).toHaveAttribute("aria-hidden", "false");
    expect(dialog.className).toContain("opacity-100");
  });

  it("renders the panel hidden when the store is closed", () => {
    useAskAiStore.setState({ isOpen: false, seenMessageCount: 0 });
    render(<AskAiDialog />);
    const dialog = screen.getByTestId("ask-ai-dialog");
    expect(dialog).toHaveAttribute("aria-hidden", "true");
    expect(dialog.className).toContain("opacity-0");
    expect(dialog.className).toContain("pointer-events-none");
  });

  it("close button flips the store closed", () => {
    render(<AskAiDialog />);
    expect(useAskAiStore.getState().isOpen).toBe(true);
    fireEvent.click(screen.getByTestId("ask-ai-close"));
    expect(useAskAiStore.getState().isOpen).toBe(false);
  });

  it("clears the conversation when the new-chat button is pressed", () => {
    const clear = vi.fn();
    setChatReturn({ clear });
    render(<AskAiDialog />);
    fireEvent.click(screen.getByTestId("ask-ai-new-chat"));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("shows the AI-unavailable banner when deployment AI config is missing", () => {
    useAiAvailableMock.mockReturnValue({
      isAvailable: false,
      isLoading: false,
    });
    render(<AskAiDialog />);
    expect(screen.getByTestId("ai-unavailable-banner")).toBeInTheDocument();
    // ChatSurface is not rendered in the unavailable state — the banner takes
    // its place entirely.
    expect(screen.queryByTestId("chat-surface")).toBeNull();
  });

  it("Escape closes the panel when open", () => {
    render(<AskAiDialog />);
    expect(useAskAiStore.getState().isOpen).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAskAiStore.getState().isOpen).toBe(false);
  });

  it("forwards message count up via onMessageCountChange", () => {
    setChatReturn({ messageCount: 2 });
    const onMessageCountChange = vi.fn();
    render(<AskAiDialog onMessageCountChange={onMessageCountChange} />);
    expect(onMessageCountChange).toHaveBeenCalledWith(2);
  });

  it("syncs seenMessageCount when the panel opens", () => {
    setChatReturn({ messageCount: 2 });
    useAskAiStore.setState({ isOpen: true, seenMessageCount: 0 });
    render(<AskAiDialog />);
    expect(useAskAiStore.getState().seenMessageCount).toBe(2);
  });

  it("passes the empty-state primer and existing testids through to ChatSurface", () => {
    render(<AskAiDialog />);
    const surface = screen.getByTestId("chat-surface");
    expect(surface).toHaveAttribute("data-input-testid", "ask-ai-input");
    expect(surface).toHaveAttribute("data-submit-testid", "ask-ai-send");
    expect(surface).toHaveAttribute(
      "data-composer-placeholder",
      "Ask about your project…",
    );
    expect(screen.getByTestId("chat-surface-empty")).toHaveTextContent(
      "Ask about your codebase",
    );
  });

  it("shows no context chip when there is no grounded issue", () => {
    render(<AskAiDialog />);
    expect(screen.queryByTestId("ask-ai-context-chip")).toBeNull();
  });

  it("renders the issue context chip when the store has a grounded issue (REEF-360)", () => {
    useAskAiStore.setState({
      isOpen: true,
      seenMessageCount: 0,
      issueContext: { reefId: "REEF-360" },
    });
    render(<AskAiDialog />);
    const chip = screen.getByTestId("ask-ai-context-chip");
    expect(chip).toHaveTextContent("REEF-360");
  });

  it("removing the context chip clears the grounded issue (context-free)", () => {
    useAskAiStore.setState({
      isOpen: true,
      seenMessageCount: 0,
      issueContext: { reefId: "REEF-360" },
    });
    render(<AskAiDialog />);
    fireEvent.click(screen.getByTestId("ask-ai-context-remove"));
    expect(useAskAiStore.getState().issueContext).toBeNull();
  });
});
