"use client";

import { useAiAvailable } from "@/features/settings/hooks/useAiAvailable";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useAskAiStore } from "../stores/useAskAiStore";

interface AskAiFabProps {
  /**
   * Number of assistant-side messages currently in the dialog. Used to compute
   * an unread dot when new replies arrive while the panel is closed. The
   * dialog passes this in so the FAB does not have to subscribe to useChat
   * itself.
   */
  messageCount?: number;
  /**
   * Called on hover/focus to warm the lazily-loaded Ask AI panel chunk before
   * the user clicks, so the panel is ready by open time. (REEF-097 AC3)
   */
  onPreload?: () => void;
}

function isMacLikeNavigator(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as unknown as {
    platform?: string;
    userAgent?: string;
    userAgentData?: { platform?: string };
  };
  const probe = `${nav.userAgentData?.platform ?? ""} ${nav.userAgent ?? ""} ${
    nav.platform ?? ""
  }`;
  return /Mac|iPhone|iPad/i.test(probe);
}

/**
 * Floating action button that toggles the global Ask AI panel.
 *
 * Hidden when deployment AI config is missing so issue browsing remains
 * available. When new assistant messages arrive while the panel is closed, a
 * small dot indicates unread activity.
 */
export function AskAiFab({ messageCount = 0, onPreload }: AskAiFabProps) {
  const isOpen = useAskAiStore((s) => s.isOpen);
  const seenCount = useAskAiStore((s) => s.seenMessageCount);
  const toggle = useAskAiStore((s) => s.toggle);
  const { isAvailable, isLoading } = useAiAvailable();

  if (isLoading || !isAvailable) return null;

  const hasUnread = !isOpen && messageCount > seenCount;
  const isMac = isMacLikeNavigator();
  const shortcut = isMac ? "⌘⇧A" : "Ctrl+Shift+A";

  return (
    <button
      type="button"
      onClick={toggle}
      onMouseEnter={onPreload}
      onFocus={onPreload}
      data-testid="ask-ai-fab"
      aria-label={`Ask AI (${shortcut})`}
      title={`Ask AI (${shortcut})`}
      aria-expanded={isOpen}
      className={cn(
        "fixed bottom-5 right-5 z-40",
        "inline-flex h-11 w-11 items-center justify-center rounded-full",
        "bg-brand text-brand-foreground shadow-lg shadow-brand/30",
        "transition-[transform,box-shadow,opacity] duration-[var(--duration-base)] ease-[var(--ease-signature)] motion-reduce:transition-none hover:shadow-brand/40 hover:shadow-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        isOpen && "scale-95 opacity-90",
      )}
    >
      <Sparkles className="h-4 w-4" />
      {hasUnread && (
        <span
          data-testid="ask-ai-unread-dot"
          aria-label="Unread messages"
          className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-brand-foreground ring-2 ring-background"
        />
      )}
      <span className="sr-only">Ask AI ({shortcut})</span>
    </button>
  );
}
