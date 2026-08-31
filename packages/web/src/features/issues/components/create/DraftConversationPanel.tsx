"use client";

import {
  ChatSurface,
  type ChatSurfaceProps,
} from "@/features/ai/components/ChatSurface";
import type { ChatStatus } from "@/features/ai/hooks/useWorkspaceChat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquare, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";

type DraftConversationPanelProps = Pick<
  ChatSurfaceProps,
  "messages" | "sendMessage" | "stop" | "vault" | "knownIssueIds"
> & {
  status: ChatStatus;
  disabled?: boolean;
  onClose: () => void;
};

/**
 * The AI column for an unsaved New Issue draft. ChatSurface owns the
 * conversation rendering and composer; this wrapper owns only the create
 * surface's title, context, and close affordance.
 */
export function DraftConversationPanel({
  messages,
  sendMessage,
  status,
  stop,
  vault,
  knownIssueIds,
  disabled = false,
  onClose,
}: DraftConversationPanelProps) {
  const t = useTranslations("issues.create");
  const isBusy = status === "submitted" || status === "streaming";

  return (
    <section
      aria-labelledby="draft-conversation-heading"
      aria-busy={isBusy}
      data-testid="draft-conversation-panel"
      data-chat-status={status}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-ai-border bg-surface-elevated"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ai-border bg-ai-subtle/50 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-ai/10 text-ai-subtle-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="draft-conversation-heading"
              className="font-display text-sm font-semibold text-foreground"
            >
              {t("conversationHeading")}
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {t("conversationDescription")}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:bg-ai-subtle hover:text-foreground"
          aria-label={t("closeConversation")}
          title={t("closeConversation")}
          data-testid="draft-conversation-close"
          onClick={onClose}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </header>

      <div className="shrink-0 border-b border-ai-border/70 px-3 py-2">
        <div
          data-testid="draft-conversation-context"
          className="flex items-center gap-1.5 text-[11px] text-ai-subtle-foreground"
        >
          <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("conversationContext")}</span>
        </div>
      </div>

      <ChatSurface
        messages={messages}
        sendMessage={sendMessage}
        status={status}
        stop={stop}
        vault={vault}
        knownIssueIds={knownIssueIds}
        emptyState={
          <p className="px-3 pt-8 text-center text-sm text-muted-foreground">
            {t("conversationEmpty")}
          </p>
        }
        composerPlaceholder={t("conversationPlaceholder")}
        composerDisabled={disabled}
        inputTestId="new-issue-chat-input"
        submitTestId="new-issue-chat-send"
        className={cn("min-h-0", disabled && "opacity-80")}
      />
    </section>
  );
}
