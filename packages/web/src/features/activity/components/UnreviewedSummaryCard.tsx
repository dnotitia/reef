"use client";

interface UnreviewedSummaryCardProps {
  draftCount: number;
  statusChangeCount: number;
  /** Recorded issue changes (REEF-063 events) since the last visit. */
  issueChangeCount: number;
  onDismiss: () => void;
}

/**
 * Summary card shown at the top of the Activity feed when the PM returns after
 * a period of absence. Uses brand-tinted surface to read as "important but
 * informational" against the neutral feed. Counts AI proposals (drafts +
 * status changes) and recorded issue changes separately so the line is not
 * mistaken for an AI-only summary (REEF-077).
 */
export function UnreviewedSummaryCard({
  draftCount,
  statusChangeCount,
  issueChangeCount,
  onDismiss,
}: UnreviewedSummaryCardProps) {
  if (draftCount === 0 && statusChangeCount === 0 && issueChangeCount === 0) {
    return null;
  }

  const parts: string[] = [];
  if (draftCount > 0) {
    parts.push(`${draftCount} new AI ${draftCount === 1 ? "draft" : "drafts"}`);
  }
  if (statusChangeCount > 0) {
    parts.push(
      `${statusChangeCount} AI status ${
        statusChangeCount === 1 ? "change" : "changes"
      }`,
    );
  }
  if (issueChangeCount > 0) {
    parts.push(
      `${issueChangeCount} issue ${
        issueChangeCount === 1 ? "change" : "changes"
      }`,
    );
  }

  return (
    <div
      data-testid="unreviewed-summary-card"
      className="rounded-md border border-brand/30 bg-brand/5 px-4 py-3 flex items-center justify-between gap-4"
    >
      <p className="text-sm text-foreground">
        <span className="font-semibold">Since you were last here:</span>{" "}
        {parts.join(", ")}.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-medium text-brand-foreground transition-colors duration-150 hover:opacity-90"
      >
        Got it
      </button>
    </div>
  );
}
