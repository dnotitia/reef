import { cn } from "@/lib/utils";
import {
  PLANNING_KIND_SINGULAR,
  type PlanningKind,
} from "@reef/core/fields/planning";
import { IterationCw, type LucideIcon, Milestone, Package } from "lucide-react";

/**
 * Canonical planning-kind glyph — one distinct mark per planning dimension
 * (sprint / milestone / release), mirroring how `StatusIcon` marks status and
 * `TypePill` marks issue type. The kind is carried by SHAPE, not color
 * (color-blind-safe, and so the muted planning tokens stay muted): an iteration
 * loop for a sprint, a signpost for a milestone, a package for a release.
 *
 * Used everywhere a planning kind appears — the planning page kind tabs, the
 * `PlanningItemCombobox` trigger, board card planning strip, list column
 * headers — so the same mark threads across all of them and a user who sees ◇
 * on a card recognizes it on the planning page. The icon→kind map lives here
 * (web presentation); the kind keys and labels are canonical in
 * `@reef/core/fields/planning`.
 *
 * Pair with a visible label and pass `decorative` so the glyph is hidden from
 * the a11y tree and the adjacent text is the single accessible name.
 */
const PLANNING_KIND_ICON: Record<PlanningKind, LucideIcon> = {
  sprints: IterationCw,
  milestones: Milestone,
  releases: Package,
};

interface PlanningKindIconProps {
  kind: PlanningKind;
  size?: number;
  /**
   * When true the glyph is decorative (aria-hidden, no role/label) — pair with
   * a visible label so the label is the single accessible name. Defaults to
   * false for icon contexts.
   */
  decorative?: boolean;
  className?: string;
}

export function PlanningKindIcon({
  kind,
  size = 14,
  decorative = false,
  className,
}: PlanningKindIconProps) {
  const Icon = PLANNING_KIND_ICON[kind];
  return (
    <Icon
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : PLANNING_KIND_SINGULAR[kind]}
      aria-hidden={decorative ? true : undefined}
      width={size}
      height={size}
      className={cn("inline-block shrink-0", className)}
    />
  );
}
