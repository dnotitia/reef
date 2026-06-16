"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      data-testid="offline-banner"
      // biome-ignore lint/a11y/useSemanticElements: <output> is technically an alternative for role="status", but it conveys "form calculation result" semantics in screen readers; a generic ambient banner is better expressed as a labelled status div per the WAI-ARIA pattern for live regions.
      role="status"
      aria-live="polite"
      className="flex w-full items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-700 dark:text-amber-200"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        You're offline — viewing cached data. Changes will sync when you
        reconnect.
      </span>
    </div>
  );
}
