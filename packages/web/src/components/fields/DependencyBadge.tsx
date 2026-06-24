import { DEPENDENCY_COLORS } from "@/components/fields/fieldKit";
import { useDependencyLabels } from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type { DependencyFacet } from "@reef/core/fields";
import { Ban, type LucideIcon, Split } from "lucide-react";

/**
 * Shared dependency-facet leaf. The Dependency filter buckets an issue by its
 * direction in the blocker graph: `blocked` (waiting on others) vs `blocking`
 * (holding others up). This is distinct from `BlockedBadge`, which counts a
 * single issue's unresolved blockers — the facet has two directions and no
 * count. Each value is encoded REDUNDANTLY by a distinct glyph AND a color
 * (color-blind-safe): a `Ban` glyph (halted, does not proceed) for blocked, a
 * `Split` glyph (fans out to others) for blocking. Mirrors how `SeverityBadge` /
 * `StatusBadge` split the bare glyph from the labelled badge, so the Dependency
 * option reads identically to the other facet leaves sitting beside it in a
 * filter dropdown. The label is locale-resolved via `useDependencyLabels()`
 * (REEF-292); the color class lives in `DEPENDENCY_COLORS`.
 */
const DEPENDENCY_ICON: Record<DependencyFacet, LucideIcon> = {
  blocked: Ban,
  blocking: Split,
};

interface DependencyIconProps {
  dependency: DependencyFacet;
  className?: string;
  /**
   * When false (default) the glyph is exposed to assistive tech with an
   * aria-label, for icon contexts. Set true when a visible label sits
   * beside it (e.g. `DependencyBadge`, dropdown rows) so the label is the single
   * accessible name and the glyph does not double-announce.
   */
  decorative?: boolean;
}

/**
 * Per-direction glyph. An `size-*` class makes the icon immune to ancestor
 * `[&_svg:not([class*='size-'])]` sizing rules (cmdk command items, Radix
 * dropdown items), so it renders identically on every surface.
 */
export function DependencyIcon({
  dependency,
  className,
  decorative = false,
}: DependencyIconProps) {
  const dependencyLabels = useDependencyLabels();
  const Icon = DEPENDENCY_ICON[dependency];
  return (
    <Icon
      className={cn(
        "size-3.5 shrink-0",
        DEPENDENCY_COLORS[dependency],
        className,
      )}
      role={decorative ? undefined : "img"}
      aria-label={
        decorative ? undefined : `Dependency: ${dependencyLabels[dependency]}`
      }
      aria-hidden={decorative ? true : undefined}
    />
  );
}

interface DependencyBadgeProps {
  dependency: DependencyFacet;
  className?: string;
}

export function DependencyBadge({
  dependency,
  className,
}: DependencyBadgeProps) {
  const dependencyLabels = useDependencyLabels();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-foreground/80",
        className,
      )}
    >
      <DependencyIcon dependency={dependency} decorative />
      <span>{dependencyLabels[dependency]}</span>
    </span>
  );
}
