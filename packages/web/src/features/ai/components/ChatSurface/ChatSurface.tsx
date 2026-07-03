"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import type { ChatAssistantTurn, ChatTurn } from "@/features/ai/chat/chatTypes";
import type { ChatStatus } from "@/features/ai/hooks/useWorkspaceChat";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";
import { ChatCitations } from "./ChatCitations";
import { ChatMarkdown } from "./ChatMarkdown";
import { ToolStepTrace } from "./ToolStepTrace";

export interface ChatSurfaceProps {
  /** Structured conversation turns from `useWorkspaceChat`. */
  messages: ChatTurn[];
  sendMessage: (input: { text: string }) => void | Promise<void>;
  status: ChatStatus;
  /** Aborts an in-flight stream — wired to the submit button while busy. */
  stop?: () => void;

  /** Active workspace, used to build vault-scoped issue deep links. */
  vault: string;
  /** Issue ids already loaded — the answer deep-links these (AC3). */
  knownIssueIds: ReadonlySet<string>;

  /** Rendered when `messages` is empty. */
  emptyState?: ReactNode;

  composerPlaceholder?: string;
  /** Rendered just above the composer input — the current-issue context chip. */
  contextChip?: ReactNode;
  /** Forces the composer disabled regardless of `status` (e.g. AI unavailable). */
  composerDisabled?: boolean;

  inputTestId?: string;
  submitTestId?: string;

  className?: string;
}

/**
 * Presentational chat shell: a `Conversation` of structured turns plus a
 * `PromptInput` composer. Owns no chat state — the caller supplies the
 * `useWorkspaceChat()` result. Assistant turns render the tool-call trace
 * (transparency), the Markdown answer with reef-mention deep links, and the
 * document citations (REEF-361).
 */
export function ChatSurface({
  messages,
  sendMessage,
  status,
  stop,
  vault,
  knownIssueIds,
  emptyState,
  composerPlaceholder,
  contextChip,
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
          {messages.map((m) =>
            m.role === "assistant" ? (
              <Message key={m.id} from="assistant">
                <MessageContent>
                  <AssistantTurn
                    turn={m}
                    vault={vault}
                    knownIssueIds={knownIssueIds}
                  />
                </MessageContent>
              </Message>
            ) : (
              <Message key={m.id} from="user">
                <MessageContent>
                  <span data-testid="user-message">{m.text}</span>
                </MessageContent>
              </Message>
            ),
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={handleSubmit}
        className="border-t border-border-subtle"
      >
        {contextChip && <div className="px-3 pt-2">{contextChip}</div>}
        <PromptInputBody className="px-3 py-2">
          <PromptInputTextarea
            data-testid={inputTestId}
            placeholder={composerPlaceholder}
            // A placeholder is not an accessible name; label the message input
            // explicitly for screen readers.
            aria-label={composerPlaceholder}
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

function AssistantTurn({
  turn,
  vault,
  knownIssueIds,
}: {
  turn: ChatAssistantTurn;
  vault: string;
  knownIssueIds: ReadonlySet<string>;
}) {
  const t = useTranslations("ai");

  // The answer deep-links the loaded issue list plus the issues this turn's own
  // tools proved real (AC3).
  const mentionIds = useMemo(() => {
    if (turn.referencedIssueIds.length === 0) return knownIssueIds;
    const merged = new Set(knownIssueIds);
    for (const id of turn.referencedIssueIds) merged.add(id);
    return merged;
  }, [knownIssueIds, turn.referencedIssueIds]);

  const isThinking =
    turn.streaming && !turn.text && turn.toolSteps.length === 0;

  return (
    <div data-testid="assistant-message" className="flex flex-col gap-2.5">
      <ToolStepTrace steps={turn.toolSteps} streaming={turn.streaming} />

      {isThinking && (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span className="size-1.5 rounded-full bg-ai-subtle-foreground motion-safe:animate-pulse" />
          {t("chatThinking")}
        </p>
      )}

      {turn.text && (
        <ChatMarkdown
          vault={vault}
          knownIssueIds={mentionIds}
          isAnimating={turn.streaming}
        >
          {turn.text}
        </ChatMarkdown>
      )}

      {turn.errorMessage && (
        <p role="alert" className="text-xs text-destructive">
          {turn.errorMessage}
        </p>
      )}

      <ChatCitations citations={turn.citations} />
    </div>
  );
}
