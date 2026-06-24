import { DUE_COLORS } from "@/components/fields/fieldKit";
import { useDueLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { DueFacet } from "@reef/core/fields";
import { CalendarClock, CalendarX, type LucideIcon } from "lucide-react";

/**
 * Shared due-facet leaf. The Due filter buckets an issue by deadline STATE
 * (overdue / due soon), not by a concrete date — so it gets its own glyph+color
 * language instead of reusing `DateDisplay`, which renders an actual YYYY-MM-DD.
 * Each value is encoded REDUNDANTLY by a distinct glyph AND a color
 * (color-blind-safe): a calendar-with-X for the missed deadline, a
 * calendar-with-clock for the approaching one. Mirrors how `SeverityBadge` /
 * `StatusBadge` split the bare glyph from the labelled badge, so the Due option
 * reads identically to the other facet leaves sitting beside it in a filter
 * dropdown. The label is locale-resolved via `useDueLabels()` (REEF-292); the
 * color class lives in `DUE_COLORS`.
 */
const DUE_ICON: Record<DueFacet, LucideIcon> = {
  overdue: CalendarX,
  due_soon: CalendarClock,
};

interface DueIconProps {
  due: DueFacet;
  className?: string;
  /**
   * When false (default) the glyph is exposed to assistive tech with an
   * aria-label, for icon contexts. Set true when a visible label sits
   * beside it (e.g. `DueBadge`, dropdown rows) so the label is the single
   * accessible name and the glyph does not double-announce.
   */
  decorative?: boolean;
}

/**
 * Per-due-state glyph. An `size-*` class makes the icon immune to ancestor
 * `[&_svg:not([class*='size-'])]` sizing rules (cmdk command items, Radix
 * dropdown items), so it renders identically on every surface.
 */
export function DueIcon({ due, className, decorative = false }: DueIconProps) {
  const dueLabels = useDueLabels();
  const Icon = DUE_ICON[due];
  return (
    <Icon
      className={cn("size-3.5 shrink-0", DUE_COLORS[due], className)}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `Due: ${dueLabels[due]}`}
      aria-hidden={decorative ? true : undefined}
    />
  );
}

interface DueBadgeProps {
  due: DueFacet;
  className?: string;
}

export function DueBadge({ due, className }: DueBadgeProps) {
  const dueLabels = useDueLabels();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <DueIcon due={due} decorative />
      <span>{dueLabels[due]}</span>
    </span>
  );
}
