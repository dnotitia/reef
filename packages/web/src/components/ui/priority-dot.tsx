import { PRIORITY_COLORS } from "@/components/fields/fieldKit";
import {
  useEnrichmentEmptyLabels,
  usePriorityLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Priority } from "@reef/core";
import { useTranslations } from "next-intl";

interface PriorityDotProps {
  priority: Priority | null;
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
  const priorityLabels = usePriorityLabels();
  const emptyLabels = useEnrichmentEmptyLabels();
  const t = useTranslations("components.priorityDot");
  const isUnset = priority === null;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={
        decorative
          ? undefined
          : t("ariaLabel", {
              value: isUnset ? emptyLabels.noPriority : priorityLabels[priority],
            })
      }
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : isUnset ? emptyLabels.noPriority : priorityLabels[priority]}
      className={cn(
        "inline-block shrink-0 rounded-full",
        isUnset
          ? "border border-muted-foreground/60"
          : PRIORITY_COLORS[priority],
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

interface PriorityBadgeProps {
  priority: Priority | null;
  size?: number;
  className?: string;
}

export function PriorityBadge({ priority, size, className }: PriorityBadgeProps) {
  const priorityLabels = usePriorityLabels();
  const emptyLabels = useEnrichmentEmptyLabels();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <PriorityDot priority={priority} size={size} decorative />
      <span>{priority ? priorityLabels[priority] : emptyLabels.noPriority}</span>
    </span>
  );
}
