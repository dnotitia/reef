import type { ChatAssistantTurn, ChatTurn } from "@/features/ai/chat/chatTypes";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// ai-elements primitives lean on streamdown / radix scroll-area / textarea
// auto-sizing — none of which add value here. Stub them down to the surface
// area ChatSurface actually exercises (role, prop wiring, submit forwarding).
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: ReactNode }) => (
    <div data-testid="conversation">{children}</div>
  ),
  ConversationContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="conversation-content">{children}</div>
  ),
  ConversationScrollButton: () => null,
}));

vi.mock("@/components/ai-elements/message", () => ({
  Message: ({
    children,
    from,
  }: {
    children: ReactNode;
    from: "user" | "assistant" | "system";
  }) => <div data-testid={`message-${from}`}>{children}</div>,
  MessageContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// The Markdown answer renderer wraps Streamdown; stub it so the test focuses on
// ChatSurface composition, not markdown rendering.
vi.mock("./ChatMarkdown", () => ({
  ChatMarkdown: ({ children }: { children: string }) => (
    <div data-testid="assistant-markdown">{children}</div>
  ),
}));

vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInput: ({
    children,
    onSubmit,
  }: {
    children: ReactNode;
    onSubmit: (m: { text: string; files: never[] }) => void | Promise<void>;
  }) => (
    <form
      data-testid="prompt-input"
      onSubmit={(e) => {
        e.preventDefault();
        const textarea =
          e.currentTarget.querySelector<HTMLTextAreaElement>("textarea");
        const text = textarea?.value ?? "";
        void onSubmit({ text, files: [] });
      }}
    >
      {children}
    </form>
  ),
  PromptInputBody: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PromptInputFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PromptInputSubmit: ({
    "data-testid": testId,
  }: { "data-testid"?: string }) => (
    <button type="submit" data-testid={testId ?? "prompt-input-submit"} />
  ),
  PromptInputTextarea: ({
    placeholder,
    disabled,
    "data-testid": testId,
  }: { placeholder?: string; disabled?: boolean; "data-testid"?: string }) => (
    <textarea
      data-testid={testId ?? "prompt-input-textarea"}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}));

import { ChatSurface, type ChatSurfaceProps } from "./ChatSurface";

function render(ui: ReactElement) {
  return rtlRender(<IntlTestProvider>{ui}</IntlTestProvider>);
}

function renderSurface(props: Partial<ChatSurfaceProps> = {}) {
  return render(
    <ChatSurface
      messages={[]}
      sendMessage={vi.fn()}
      status="ready"
      vault="reef-e2e"
      knownIssueIds={new Set()}
      {...props}
    />,
  );
}

const userTurn = (id: string, text: string): ChatTurn => ({
  id,
  role: "user",
  text,
});

const assistantTurn = (
  id: string,
  overrides: Partial<ChatAssistantTurn> = {},
): ChatTurn => ({
  id,
  role: "assistant",
  text: "",
  toolSteps: [],
  citations: [],
  referencedIssueIds: [],
  streaming: false,
  errorMessage: null,
  ...overrides,
});

describe("ChatSurface", () => {
  it("renders the empty state when there are no messages", () => {
    renderSurface({ emptyState: <p data-testid="empty">No messages yet</p> });
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

  it("renders user and assistant messages with correct variants", () => {
    renderSurface({
      messages: [
        userTurn("1", "hi"),
        assistantTurn("2", { text: "hello there" }),
      ],
    });
    expect(screen.getByTestId("message-user")).toHaveTextContent("hi");
    expect(screen.getByTestId("user-message")).toHaveTextContent("hi");
    // The assistant turn is wrapped in a div carrying assistant-message so E2E
    // selectors target the assistant role without depending on Streamdown.
    expect(screen.getByTestId("assistant-message")).toHaveTextContent(
      "hello there",
    );
    expect(screen.getByTestId("assistant-markdown")).toHaveTextContent(
      "hello there",
    );
  });

  it("calls sendMessage with the trimmed text on submit", () => {
    const sendMessage = vi.fn();
    renderSurface({ sendMessage, inputTestId: "surface-input" });
    const textarea = screen.getByTestId("surface-input") as HTMLTextAreaElement;
    textarea.value = "  ping  ";
    fireEvent.submit(screen.getByTestId("prompt-input"));
    expect(sendMessage).toHaveBeenCalledWith({ text: "ping" });
  });

  it("ignores empty submissions", () => {
    const sendMessage = vi.fn();
    renderSurface({ sendMessage });
    fireEvent.submit(screen.getByTestId("prompt-input"));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("surfaces an assistant turn error via role=alert", () => {
    renderSurface({
      messages: [assistantTurn("2", { errorMessage: "upstream timeout" })],
    });
    expect(screen.getByRole("alert")).toHaveTextContent("upstream timeout");
  });

  it("disables the composer textarea while streaming", () => {
    renderSurface({ status: "streaming", inputTestId: "surface-input" });
    expect(screen.getByTestId("surface-input")).toBeDisabled();
  });

  it("respects composerDisabled even when status is ready", () => {
    renderSurface({ composerDisabled: true, inputTestId: "surface-input" });
    expect(screen.getByTestId("surface-input")).toBeDisabled();
  });

  it("forwards placeholder and testid props to the composer", () => {
    renderSurface({
      composerPlaceholder: "Type a question",
      inputTestId: "surface-input",
      submitTestId: "surface-send",
    });
    expect(screen.getByTestId("surface-input")).toHaveAttribute(
      "placeholder",
      "Type a question",
    );
    expect(screen.getByTestId("surface-send")).toBeInTheDocument();
  });
});
