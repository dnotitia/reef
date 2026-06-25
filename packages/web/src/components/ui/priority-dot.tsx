import { PRIORITY_COLORS } from "@/components/fields/fieldKit";
import { usePriorityLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Priority } from "@reef/core";
import { useTranslations } from "next-intl";

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
  const priorityLabels = usePriorityLabels();
  const t = useTranslations("components.priorityDot");
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={
        decorative
          ? undefined
          : t("ariaLabel", { value: priorityLabels[priority] })
      }
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : priorityLabels[priority]}
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
  const priorityLabels = usePriorityLabels();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <PriorityDot priority={priority} size={size} decorative />
      <span>{priorityLabels[priority]}</span>
    </span>
  );
}
