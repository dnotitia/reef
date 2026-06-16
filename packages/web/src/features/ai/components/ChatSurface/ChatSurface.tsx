"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { getMessageText } from "@/lib/uiMessage";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";

// Same status values returned by the current useChat hook. Keep this narrow so
// ChatSurface depends on the states it renders.
type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export interface ChatSurfaceProps {
  /** Output of `useChat()` — caller owns the chat session and transport. */
  messages: UIMessage[];
  sendMessage: (input: { text: string }) => void | Promise<void>;
  status: ChatStatus;
  /** Aborts an in-flight stream — wired to the submit button while busy. */
  stop?: () => void;
  error?: Error | null;

  /** Rendered when `messages` is empty. */
  emptyState?: ReactNode;

  composerPlaceholder?: string;
  /**
   * Forces the composer disabled regardless of `status`. Used by callers that
   * need to suppress input for reasons orthogonal to streaming (e.g. AI is
   * unavailable in this deployment).
   */
  composerDisabled?: boolean;

  /** Forwarded to PromptInputTextarea so callers preserve existing testids. */
  inputTestId?: string;
  /** Forwarded to PromptInputSubmit so callers preserve existing testids. */
  submitTestId?: string;

  className?: string;
}

/**
 * Presentational chat shell: a `Conversation` of `Message`s plus a
 * `PromptInput` composer. Owns no chat state — the caller supplies the
 * `useChat()` result and binds whatever transport / store / credentials it
 * needs.
 *
 * Caller is responsible for the surrounding chrome (dialog frame, header,
 * close button, AI-unavailable banner). That keeps ChatSurface reusable
 * across surfaces with different layouts (the floating Ask AI panel, future
 * side-panel surfaces, etc.).
 */
export function ChatSurface({
  messages,
  sendMessage,
  status,
  stop,
  error,
  emptyState,
  composerPlaceholder,
  composerDisabled,
  inputTestId,
  submitTestId,
  className,
}: ChatSurfaceProps) {
  const isBusy = status === "submitted" || status === "streaming";

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();
    if (!text) return;
    await sendMessage({ text });
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="px-3 py-3">
          {messages.length === 0 && emptyState}
          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.role === "assistant" ? (
                  // Wrap MessageResponse so E2E selectors can target the
                  // assistant turn — Streamdown does not forward arbitrary
                  // attributes onto its root.
                  <div data-testid="assistant-message">
                    <MessageResponse>{getMessageText(m)}</MessageResponse>
                  </div>
                ) : (
                  <span data-testid="user-message">{getMessageText(m)}</span>
                )}
              </MessageContent>
            </Message>
          ))}
          {error && (
            <div role="alert" className="text-xs text-destructive">
              {error.message}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={handleSubmit}
        className="border-t border-border-subtle"
      >
        <PromptInputBody className="px-3 py-2">
          <PromptInputTextarea
            data-testid={inputTestId}
            placeholder={composerPlaceholder}
            disabled={composerDisabled || isBusy}
          />
        </PromptInputBody>
        <PromptInputFooter className="px-3 pb-2">
          <PromptInputSubmit
            status={status}
            onStop={stop}
            data-testid={submitTestId}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
