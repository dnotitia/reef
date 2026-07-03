"use client";

import { Button } from "@/components/ui/button";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useAiAvailable } from "@/features/settings/hooks/useAiAvailable";
import { VAULT_HEADER } from "@/lib/akb/headers";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FileText, MessageSquarePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { useAskAiStore } from "../stores/useAskAiStore";
import { ChatSurface } from "./ChatSurface";

interface AskAiDialogProps {
  /**
   * Reports the current message count up so AskAiFab can show an unread dot.
   * Decoupled from the store so the FAB doesn't need to know about useChat.
   */
  onMessageCountChange?: (count: number) => void;
}

/**
 * Floating Ask AI panel mounted globally by DashboardShell.
 *
 * Scope (Motivation 1): the PM queries their codebase with code as the source
 * of truth. The chat agent loop runs the grounding tools (`search_code`,
 * `dev_read_file`); issue authoring lives in the enrichment pipeline
 * (Motivation 2), not here.
 *
 * Stays mounted at all times so useChat history survives panel close/open —
 * visibility is toggled via opacity + pointer-events rather than conditional
 * render. The component still no-ops most of its work when closed.
 *
 * Credentials are picked up automatically by `apiFetch` (Authorization from
 * IndexedDB; deployment-managed LLM config server-side) so the dialog does not
 * has to read them itself. AI unavailability is handled at the FAB level —
 * when deployment AI config is missing, the FAB hides and the dialog does not opens.
 */
export function AskAiDialog({ onMessageCountChange }: AskAiDialogProps) {
  const t = useTranslations("ai");
  const common = useTranslations("common");
  const isOpen = useAskAiStore((s) => s.isOpen);
  const close = useAskAiStore((s) => s.close);
  const markSeen = useAskAiStore((s) => s.markSeen);
  const issueContext = useAskAiStore((s) => s.issueContext);
  const setIssueContext = useAskAiStore((s) => s.setIssueContext);
  const { isAvailable, isLoading: aiLoading } = useAiAvailable();
  // The route the PM is on — grounds the chat in where they are (REEF-360 AC2).
  const pathname = usePathname();
  // The chat Route Handler reads the workspace from `X-Reef-Vault`, not a
  // `?vault=` query. Source it from the URL `[vault]` segment (via useActiveVault)
  // so two tabs on different workspaces send chat to their own workspace rather
  // than sharing the Dexie pointer (REEF-315 — tab independence). apiFetch keeps
  // the Dexie value as a fallback when this is empty.
  const { vault } = useActiveVault();

  // Latest grounding hints (route + open issue) read at send time. Held in a
  // ref so the transport stays stable across route/context changes rather than
  // being rebuilt on every navigation — `prepareSendMessagesRequest` reads the
  // current values when a message is actually sent (REEF-360 AC2).
  const groundingRef = useRef<{ route: string | null; reefId: string | null }>({
    route: pathname ?? null,
    reefId: issueContext?.reefId ?? null,
  });
  groundingRef.current = {
    route: pathname ?? null,
    reefId: issueContext?.reefId ?? null,
  };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: apiFetch,
        headers: vault ? { [VAULT_HEADER]: vault } : undefined,
        prepareSendMessagesRequest: ({ messages, body, headers }) => ({
          body: {
            ...body,
            messages,
            route: groundingRef.current.route,
            reefId: groundingRef.current.reefId,
          },
          headers,
        }),
      }),
    [vault],
  );
  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    transport,
  });

  // ESC closes the panel — just registers when open to avoid trapping the
  // keystroke for other dialogs.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  // Mark messages as seen each time the panel opens.
  useEffect(() => {
    if (isOpen) markSeen(messages.length);
  }, [isOpen, messages.length, markSeen]);

  // Surface message count to FAB for the unread dot.
  useEffect(() => {
    onMessageCountChange?.(messages.length);
  }, [messages.length, onMessageCountChange]);

  function handleClearChat() {
    setMessages([]);
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> would imply modal semantics + Escape-to-close handled by the platform — we want non-modal floating behavior with our own ESC handler so the panel does not traps the page underneath.
      role="dialog"
      aria-label={t("title")}
      aria-modal="false"
      aria-hidden={!isOpen}
      data-testid="ask-ai-dialog"
      className={cn(
        "fixed bottom-20 right-5 z-40 flex flex-col",
        "h-[560px] w-[420px] max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2.5rem)]",
        "rounded-xl border border-border bg-elevated shadow-2xl shadow-foreground/10",
        "transition-[opacity,transform] duration-[var(--duration-base)] ease-[var(--ease-signature)] motion-reduce:transition-none",
        isOpen
          ? "opacity-100 translate-y-0"
          : "pointer-events-none opacity-0 translate-y-2",
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-2.5">
        <h2
          className="font-display text-sm font-semibold text-foreground"
          style={{ letterSpacing: "-0.01em" }}
        >
          {t("title")}
        </h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleClearChat}
            aria-label={t("newChat")}
            title={t("newChat")}
            data-testid="ask-ai-new-chat"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={close}
            aria-label={common("close")}
            title={t("closeEsc")}
            data-testid="ask-ai-close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {!isAvailable && !aiLoading ? (
        <div
          data-testid="ai-unavailable-banner"
          className="px-4 py-3 text-sm text-muted-foreground"
        >
          <p className="font-semibold text-foreground">
            {t("unavailableTitle")}
          </p>
          <p>{t("unavailableBody")}</p>
        </div>
      ) : (
        <ChatSurface
          messages={messages}
          sendMessage={sendMessage}
          status={status}
          stop={stop}
          error={error}
          emptyState={
            <p className="pt-8 text-center text-sm text-muted-foreground">
              {t("emptyState")}
            </p>
          }
          composerPlaceholder={t("composerPlaceholder")}
          composerDisabled={!isAvailable}
          inputTestId="ask-ai-input"
          submitTestId="ask-ai-send"
          contextChip={
            issueContext ? (
              <div
                data-testid="ask-ai-context-chip"
                aria-label={t("issueContextChipLabel", {
                  id: issueContext.reefId,
                })}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted-foreground"
              >
                <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="font-medium text-foreground" translate="no">
                  {issueContext.reefId}
                </span>
                <button
                  type="button"
                  onClick={() => setIssueContext(null)}
                  aria-label={t("removeIssueContext")}
                  title={t("removeIssueContext")}
                  data-testid="ask-ai-context-remove"
                  className="ml-0.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
