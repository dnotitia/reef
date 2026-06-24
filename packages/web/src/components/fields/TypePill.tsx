import { ISSUE_TYPE_COLORS } from "@/components/fields/fieldKit";
import { useIssueTypeLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { IssueType } from "@reef/core";
import {
  Bookmark,
  Bug,
  FlaskConical,
  Layers,
  type LucideIcon,
  SquareCheck,
  Wrench,
} from "lucide-react";

/**
 * Shared issue-type pill. Each type is encoded REDUNDANTLY by a distinct glyph
 * AND a color (color-blind-safe, mirrors how `StatusIcon` pairs shape + color)
 * so epic/bug/story are distinguishable pre-attentively, not just by reading the
 * label. The `variant` reproduces each surface's pill chrome; the icon size is
 * tuned per surface. The `badge` variant is the chrome-less form (glyph + label,
 * no border/background) for dropdown option rows, so the type option reads
 * identically to the `StatusBadge` / `PriorityBadge` / `SeverityBadge` leaves
 * sitting beside it. The label is locale-resolved via `useIssueTypeLabels()`
 * (REEF-292); the color classes live in `ISSUE_TYPE_COLORS` (default "task").
 */
export type TypePillVariant =
  | "kanban"
  | "list"
  | "detail"
  | "activity"
  | "badge";

const VARIANT_CLASS: Record<TypePillVariant, string> = {
  kanban:
    "inline-flex items-center gap-1 shrink-0 rounded-sm border border-border/70 bg-surface-subtle px-1.5 py-px text-[10px] font-medium leading-none",
  list: "inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground",
  detail:
    "inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground",
  activity:
    "inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5",
  // Chrome-less: mirrors the StatusBadge / PriorityBadge / SeverityBadge leaves
  // so all four fields speak one glyph+label language inside dropdown rows.
  badge: "inline-flex items-center gap-1.5 text-xs text-foreground/80",
};

/** Per-type glyph. Shape carries meaning independent of color. */
const TYPE_ICON: Record<IssueType, LucideIcon> = {
  epic: Layers,
  story: Bookmark,
  task: SquareCheck,
  bug: Bug,
  spike: FlaskConical,
  chore: Wrench,
};

/**
 * Icon size as a Tailwind class (not the lucide `size` prop, which renders a
 * width/height *attribute*). A `size-*` class makes the glyph immune to ancestor
 * `[&_svg:not([class*='size-'])]` sizing rules (e.g. inside a cmdk command item),
 * so the pill renders identically on every surface, including the dropdowns.
 */
const ICON_SIZE_CLASS: Record<TypePillVariant, string> = {
  kanban: "size-[11px]",
  list: "size-3",
  detail: "size-3",
  activity: "size-3",
  // 14px to line up with SeverityBadge's glyph in the same dropdown.
  badge: "size-3.5",
};

interface TypePillProps {
  type: IssueType | null | undefined;
  variant?: TypePillVariant;
  className?: string;
  /**
   * Classes for the label span — e.g. a container-query `@max-[…]:hidden` so a
   * dense row can drop to a glyph-form type when its column is too narrow for
   * the label (REEF-285). The glyph still carries the type via shape + color.
   */
  labelClassName?: string;
}

export function TypePill({
  type,
  variant = "list",
  className,
  labelClassName,
}: TypePillProps) {
  const issueTypeLabels = useIssueTypeLabels();
  const resolved = type ?? "task";
  const Icon = TYPE_ICON[resolved];
  return (
    <span className={cn(VARIANT_CLASS[variant], className)}>
      {/* Redundant with the visible label, so hidden from the a11y tree. */}
      <Icon
        className={cn(
          "shrink-0",
          ICON_SIZE_CLASS[variant],
          ISSUE_TYPE_COLORS[resolved],
        )}
        aria-hidden="true"
      />
      <span className={labelClassName}>{issueTypeLabels[resolved]}</span>
    </span>
  );
}
