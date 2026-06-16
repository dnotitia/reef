import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
} from "@/components/fields/fieldKit";
import { cn } from "@/lib/utils";
import type { Priority } from "@reef/core";

interface PriorityDotProps {
  priority: Priority;
  size?: number;
  className?: string;
  /**
   * When true the dot is decorative (aria-hidden, no role/label) — pair with a
   * visible label (e.g. `PriorityBadge`) so the label is the single accessible
   * name. Defaults to false for icon-only contexts (board, dropdown rows).
   */
  decorative?: boolean;
}

export function PriorityDot({
  priority,
  size = 8,
  className,
  decorative = false,
}: PriorityDotProps) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `Priority: ${PRIORITY_LABELS[priority]}`}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : PRIORITY_LABELS[priority]}
      className={cn(
        "inline-block shrink-0 rounded-full",
        PRIORITY_COLORS[priority],
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

interface PriorityBadgeProps {
  priority: Priority;
  size?: number;
  className?: string;
}

export function PriorityBadge({ priority, size, className }: PriorityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <PriorityDot priority={priority} size={size} decorative />
      <span>{PRIORITY_LABELS[priority]}</span>
    </span>
  );
}

export { PRIORITY_LABELS, PRIORITY_OPTIONS };
