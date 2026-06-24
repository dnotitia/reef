"use client";

import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/relativeTime";
import { getLastScanAt } from "@/lib/storage/lastScan";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

interface ActivityRefreshButtonProps {
  /** "owner/repo" — used to read this repo's last-scan timestamp. */
  repo: string;
  /** Click handler — should call the detection mutation with source: "manual". */
  onRefresh: () => void;
  isScanning: boolean;
  /**
   * Bumped by the parent after each successful scan so this component re-reads
   * the last-scan timestamp without re-mounting. Cheap proxy for "scan just
   * completed" without coupling to the mutation result shape.
   */
  scanTick?: number;
}

/**
 * Manual refresh control for the Activity feed's auto-detection scan.
 *
 * Disabled while a scan is in flight (icon swaps to a spinner). The relative
 * "last scanned" label gives the user a sense of staleness without us needing
 * a dedicated SyncIndicator — that role is now covered by toasts (success) +
 * this button's label (steady-state).
 */
export function ActivityRefreshButton({
  repo,
  onRefresh,
  isScanning,
  scanTick = 0,
}: ActivityRefreshButtonProps) {
  const locale = useLocale();
  const t = useTranslations("activity");
  const [lastScan, setLastScan] = useState<string | undefined>(undefined);
  // Re-render every minute so "5m ago" doesn't stay frozen on a long-lived tab.
  const [now, setNow] = useState(() => Date.now());

  // biome-ignore lint/correctness/useExhaustiveDependencies: scanTick is intentional — it's a bump counter the parent increments after each successful scan to force a re-read of the persisted timestamp. The variable is unused inside the effect by design.
  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    void (async () => {
      const raw = await getLastScanAt(repo);
      if (!cancelled) setLastScan(raw);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, scanTick]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const relative = lastScan ? formatRelativeTime(lastScan, now, locale) : null;

  return (
    <div className="flex items-center gap-2">
      {relative && (
        <span
          data-testid="activity-last-scan"
          className="text-xs text-muted-foreground tabular-nums"
        >
          {t("scanned", { time: relative })}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={isScanning || !repo}
        data-testid="activity-refresh"
        aria-label={t("scanForNewActivity")}
        title={t("scanForNewActivity")}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        {isScanning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className={cn("h-3.5 w-3.5")} />
        )}
        <span>{t("refresh")}</span>
      </Button>
    </div>
  );
}
