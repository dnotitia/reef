import { cn } from "@/lib/utils";

interface EnumBadgeProps {
  /** Human-readable label (does not the raw enum identifier). */
  label: string;
  /**
   * Tailwind text-color token for the indicator dot (e.g. "text-status-open").
   * The dot uses `bg-current`, so this class drives its fill via currentColor.
   */
  colorClass: string;
  className?: string;
}

/**
 * Generic dot + label status indicator. Shares the visual language of the
 * issue `StatusBadge` / `PriorityBadge` (dot + muted label) for non-issue enums
 * such as planning sprint/milestone/release statuses, without coupling to the
 * issue `Status` type. Compose via `PlanningStatusBadge` for planning kinds.
 */
export function EnumBadge({ label, colorClass, className }: EnumBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-2 w-2 shrink-0 rounded-full bg-current",
          colorClass,
        )}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
