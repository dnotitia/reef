"use client";

import { useTranslations } from "next-intl";

interface UnreviewedSummaryCardProps {
  draftCount: number;
  statusChangeCount: number;
  onDismiss: () => void;
}

/**
 * Summary card shown at the top of the Activity feed when the PM returns after
 * a period of absence. Uses brand-tinted surface to read as "important but
 * informational" against the neutral feed.
 */
export function UnreviewedSummaryCard({
  draftCount,
  statusChangeCount,
  onDismiss,
}: UnreviewedSummaryCardProps) {
  const t = useTranslations("activity");

  if (draftCount === 0 && statusChangeCount === 0) {
    return null;
  }

  const parts: string[] = [];
  if (draftCount > 0) {
    parts.push(t("newDraftsPart", { count: draftCount }));
  }
  if (statusChangeCount > 0) {
    parts.push(t("statusChangesPart", { count: statusChangeCount }));
  }

  return (
    <div
      data-testid="unreviewed-summary-card"
      className="rounded-md border border-brand/30 bg-brand/5 px-4 py-3 flex items-center justify-between gap-4"
    >
      <p className="text-sm text-foreground">
        <span className="font-semibold">{t("summaryLabel")}</span>{" "}
        {parts.join(", ")}.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-medium text-brand-foreground transition-colors duration-150 hover:opacity-90"
      >
        {t("gotIt")}
      </button>
    </div>
  );
}
