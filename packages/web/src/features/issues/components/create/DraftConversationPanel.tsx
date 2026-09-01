"use client";

import {
  ChatSurface,
  type ChatSurfaceProps,
} from "@/features/ai/components/ChatSurface";
import type { ChatStatus } from "@/features/ai/hooks/useWorkspaceChat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

function subscribeToViewport(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

function getViewportWidth() {
  return window.innerWidth;
}

function getServerViewportWidth() {
  return 0;
}

type DraftConversationPanelProps = Pick<
  ChatSurfaceProps,
  | "messages"
  | "composerText"
  | "onComposerTextChange"
  | "sendMessage"
  | "stop"
  | "vault"
  | "knownIssueIds"
> & {
  status: ChatStatus;
  disabled?: boolean;
  onClose: () => void;
};

/**
 * The AI column for an unsaved New Issue draft. ChatSurface owns the
 * conversation rendering and composer; this wrapper owns the desktop title
 * and close affordance.
 */
export function DraftConversationPanel({
  messages,
  composerText,
  onComposerTextChange,
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
  const isDesktop =
    useSyncExternalStore(
      subscribeToViewport,
      getViewportWidth,
      getServerViewportWidth,
    ) >= 900;

  return (
    <section
      id="draft-conversation-panel"
      aria-label={t("conversationHeading")}
      aria-busy={isBusy}
      data-testid="draft-conversation-panel"
      data-chat-status={status}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden min-[900px]:border-l min-[900px]:border-border-subtle min-[900px]:pl-5"
    >
      {isDesktop ? (
        <header className="flex shrink-0 items-center justify-between gap-3 pb-2">
          <h2 className="font-display text-sm font-semibold text-foreground">
            {t("conversationHeading")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            aria-label={t("closeConversation")}
            data-testid="draft-conversation-close"
            onClick={onClose}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </header>
      ) : null}

      <ChatSurface
        messages={messages}
        composerText={composerText}
        onComposerTextChange={onComposerTextChange}
        sendMessage={sendMessage}
        status={status}
        stop={stop}
        vault={vault}
        knownIssueIds={knownIssueIds}
        composerPlaceholder={t("conversationPlaceholder")}
        composerDisabled={disabled}
        inputTestId="new-issue-chat-input"
        submitTestId="new-issue-chat-send"
        className={cn("min-h-0", disabled && "opacity-80")}
      />
    </section>
  );
}
