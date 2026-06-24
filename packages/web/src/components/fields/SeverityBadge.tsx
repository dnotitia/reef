import { SEVERITY_COLORS } from "@/components/fields/fieldKit";
import { useSeverityLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { Severity } from "@reef/core";
import {
  CircleAlert,
  Info,
  type LucideIcon,
  Minus,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";

/**
 * Shared severity leaf. severity is ORDINAL (blocker > critical > major > minor
 * > trivial), so it gets its own shape language — an escalating lucide alert
 * glyph plus a red→gray color ramp — kept deliberately distinct from the
 * priority dot so the two does not read as the same field. Mirrors how `TypePill`
 * pairs a lucide glyph with a color, and how `StatusIcon` / `StatusBadge` split
 * the bare glyph from the labelled badge. The label is locale-resolved via
 * `useSeverityLabels()` (REEF-292); the color class lives in `SEVERITY_COLORS`.
 */
const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  blocker: OctagonAlert,
  critical: TriangleAlert,
  major: CircleAlert,
  minor: Info,
  trivial: Minus,
};

interface SeverityIconProps {
  severity: Severity;
  className?: string;
  /**
   * When false (default) the glyph is exposed to assistive tech with an
   * aria-label, for icon contexts. Set true when a visible label sits
   * beside it (e.g. `SeverityBadge`, dropdown rows) so the label is the single
   * accessible name and the glyph does not double-announce.
   */
  decorative?: boolean;
}

/**
 * Per-severity glyph. An `size-*` class makes the icon immune to ancestor
 * `[&_svg:not([class*='size-'])]` sizing rules (cmdk command items, Radix
 * select items), so it renders identically on every surface.
 */
export function SeverityIcon({
  severity,
  className,
  decorative = false,
}: SeverityIconProps) {
  const severityLabels = useSeverityLabels();
  const Icon = SEVERITY_ICON[severity];
  return (
    <Icon
      className={cn("size-3.5 shrink-0", SEVERITY_COLORS[severity], className)}
      role={decorative ? undefined : "img"}
      aria-label={
        decorative ? undefined : `Severity: ${severityLabels[severity]}`
      }
      aria-hidden={decorative ? true : undefined}
    />
  );
}

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const severityLabels = useSeverityLabels();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <SeverityIcon severity={severity} decorative />
      <span>{severityLabels[severity]}</span>
    </span>
  );
}
