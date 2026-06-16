import { cn } from "@/lib/utils";

/**
 * Renders an AI suggestion's confidence as a small dot + percentage, using the
 * shared `ai-*` design tokens. The dot dims below the high-confidence
 * threshold (80%) so low-confidence suggestions read as less assertive.
 *
 * Shared between the Activity Hub draft cards and the inline issue-enrichment
 * review UI — keep it presentation.
 */
export function ConfidenceBadge({
  confidence,
  className,
  compact = false,
}: {
  confidence: number;
  className?: string;
  /** Render the dot + "NN%" — for tight inline contexts. */
  compact?: boolean;
}) {
  const pct = Math.round(confidence * 100);
  const isHigh = pct >= 80;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-ai-subtle-foreground",
        className,
      )}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-ai"
        style={{ opacity: isHigh ? 1 : 0.6 }}
        aria-hidden="true"
      />
      {compact ? `${pct}%` : `${pct}% confidence`}
    </span>
  );
}
