"use client";

import {
  ChatSurface,
  type ChatSurfaceProps,
} from "@/features/ai/components/ChatSurface";
import type { ChatStatus } from "@/features/ai/hooks/useWorkspaceChat";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

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
};

/**
 * The AI column for an unsaved New Issue draft. ChatSurface owns the
 * conversation rendering and composer; this wrapper owns the desktop title
 * and focuses the composer when the column is opened.
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
}: DraftConversationPanelProps) {
  const t = useTranslations("issues.create");
  const panelRef = useRef<HTMLElement>(null);
  const isBusy = status === "submitted" || status === "streaming";
  // Keep the desktop heading out of the mobile DOM. The mobile view uses the
  // Draft/AI switcher as its only view chrome, so CSS-only hiding would leave
  // an extra panel header in that state.
  const isDesktop =
    useSyncExternalStore(
      subscribeToViewport,
      getViewportWidth,
      getServerViewportWidth,
    ) >= 900;

  useLayoutEffect(() => {
    panelRef.current
      ?.querySelector<HTMLTextAreaElement>("textarea")
      ?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      ref={panelRef}
      id="draft-conversation-panel"
      aria-label={t("conversationHeading")}
      aria-busy={isBusy}
      data-testid="draft-conversation-panel"
      data-chat-status={status}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden min-[900px]:border-l min-[900px]:border-ai-border min-[900px]:pl-5"
    >
      {isDesktop ? (
        <header className="flex shrink-0 items-center justify-between gap-3 pb-2">
          <h2 className="font-display text-sm font-semibold text-ai-subtle-foreground">
            {t("conversationHeading")}
          </h2>
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
