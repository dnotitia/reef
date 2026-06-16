import {
  type RenderOptions,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, options);
}

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
  MessageResponse: ({ children }: { children: ReactNode }) => (
    <div data-testid="streamdown-response">{children}</div>
  ),
}));

vi.mock("@/components/ai-elements/prompt-input", () => ({
  // The real PromptInput accepts {text, files} from a form submit — for the
  // test stub we synthesize a text submit when the form fires.
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

import type { UIMessage } from "ai";
import { ChatSurface } from "./ChatSurface";

const userMsg = (id: string, text: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const assistantMsg = (id: string, text: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

describe("ChatSurface", () => {
  it("renders the empty state when there are no messages", () => {
    render(
      <ChatSurface
        messages={[]}
        sendMessage={vi.fn()}
        status="ready"
        emptyState={<p data-testid="empty">No messages yet</p>}
      />,
    );
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

  it("renders user and assistant messages with correct variants", () => {
    render(
      <ChatSurface
        messages={[userMsg("1", "hi"), assistantMsg("2", "hello there")]}
        sendMessage={vi.fn()}
        status="ready"
      />,
    );
    expect(screen.getByTestId("message-user")).toHaveTextContent("hi");
    expect(screen.getByTestId("message-assistant")).toHaveTextContent(
      "hello there",
    );
    // user message has the data-testid="user-message" attribute (kept for
    // existing test selectors elsewhere in the codebase).
    expect(screen.getByTestId("user-message")).toHaveTextContent("hi");
    // assistant turn is wrapped in a div carrying assistant-message so E2E
    // selectors can target the assistant role without depending on
    // Streamdown's root attributes.
    expect(screen.getByTestId("assistant-message")).toHaveTextContent(
      "hello there",
    );
    // The inner Streamdown stand-in still receives the children.
    expect(screen.getByTestId("streamdown-response")).toHaveTextContent(
      "hello there",
    );
  });

  it("calls sendMessage with the trimmed text on submit", async () => {
    const sendMessage = vi.fn();
    render(
      <ChatSurface
        messages={[]}
        sendMessage={sendMessage}
        status="ready"
        inputTestId="surface-input"
        submitTestId="surface-send"
      />,
    );
    const textarea = screen.getByTestId("surface-input") as HTMLTextAreaElement;
    textarea.value = "  ping  ";
    fireEvent.submit(screen.getByTestId("prompt-input"));
    expect(sendMessage).toHaveBeenCalledWith({ text: "ping" });
  });

  it("ignores empty submissions", () => {
    const sendMessage = vi.fn();
    render(
      <ChatSurface messages={[]} sendMessage={sendMessage} status="ready" />,
    );
    fireEvent.submit(screen.getByTestId("prompt-input"));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("surfaces the error message via role=alert", () => {
    render(
      <ChatSurface
        messages={[]}
        sendMessage={vi.fn()}
        status="error"
        error={new Error("upstream timeout")}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("upstream timeout");
  });

  it("disables the composer textarea while streaming", () => {
    render(
      <ChatSurface
        messages={[]}
        sendMessage={vi.fn()}
        status="streaming"
        inputTestId="surface-input"
      />,
    );
    expect(screen.getByTestId("surface-input")).toBeDisabled();
  });

  it("respects composerDisabled even when status is ready", () => {
    render(
      <ChatSurface
        messages={[]}
        sendMessage={vi.fn()}
        status="ready"
        composerDisabled
        inputTestId="surface-input"
      />,
    );
    expect(screen.getByTestId("surface-input")).toBeDisabled();
  });

  it("forwards placeholder and testid props to the composer", () => {
    render(
      <ChatSurface
        messages={[]}
        sendMessage={vi.fn()}
        status="ready"
        composerPlaceholder="Type a question"
        inputTestId="surface-input"
        submitTestId="surface-send"
      />,
    );
    expect(screen.getByTestId("surface-input")).toHaveAttribute(
      "placeholder",
      "Type a question",
    );
    expect(screen.getByTestId("surface-send")).toBeInTheDocument();
  });
});
