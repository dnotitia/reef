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

const useChatMock = vi.fn();
vi.mock("@ai-sdk/react", () => ({
  useChat: (...args: unknown[]) => useChatMock(...args),
}));

// `ai` is imported by AskAiDialog for DefaultChatTransport; stub so the
// component module imports cleanly under jsdom.
vi.mock("ai", () => ({
  DefaultChatTransport: class {},
}));

const useAiAvailableMock = vi.fn();
vi.mock("@/features/settings/hooks/useAiAvailable", () => ({
  useAiAvailable: () => useAiAvailableMock(),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: vi.fn(),
}));

// AskAiDialog now delegates its conversation+composer area to ChatSurface.
// Stub the component to expose a single testid and reflect its key props back
// out as attributes — that keeps these tests focused on AskAiDialog's own
// responsibilities (store wiring, close handlers, message count callback)
// without depending on ai-elements internals (covered in ChatSurface.test.tsx).
vi.mock("./ChatSurface", () => ({
  ChatSurface: ({
    emptyState,
    composerPlaceholder,
    composerDisabled,
    inputTestId,
    submitTestId,
  }: {
    emptyState?: ReactNode;
    composerPlaceholder?: string;
    composerDisabled?: boolean;
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
    </div>
  ),
}));

import { useAskAiStore } from "../stores/useAskAiStore";
import { AskAiDialog } from "./AskAiDialog";

function setUseChatReturn(overrides: Partial<Record<string, unknown>> = {}) {
  useChatMock.mockReturnValue({
    messages: [],
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
    stop: vi.fn(),
    status: "ready",
    error: undefined,
    ...overrides,
  });
}

describe("AskAiDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAskAiStore.setState({ isOpen: true, seenMessageCount: 0 });
    setUseChatReturn();
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

  it("clears messages when the new-chat button is pressed", () => {
    const setMessages = vi.fn();
    setUseChatReturn({ setMessages });
    render(<AskAiDialog />);
    fireEvent.click(screen.getByTestId("ask-ai-new-chat"));
    expect(setMessages).toHaveBeenCalledWith([]);
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
    setUseChatReturn({
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    });
    const onMessageCountChange = vi.fn();
    render(<AskAiDialog onMessageCountChange={onMessageCountChange} />);
    expect(onMessageCountChange).toHaveBeenCalledWith(2);
  });

  it("syncs seenMessageCount when the panel opens", () => {
    setUseChatReturn({
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    });
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
      "Ask about your project...",
    );
    expect(screen.getByTestId("chat-surface-empty")).toHaveTextContent(
      "Ask about your codebase",
    );
  });
});
