import { EnumBadge } from "@/components/fields/EnumBadge";
import {
  MILESTONE_STATUS_COLORS,
  MILESTONE_STATUS_LABELS,
  RELEASE_STATUS_COLORS,
  RELEASE_STATUS_LABELS,
  SPRINT_STATUS_COLORS,
  SPRINT_STATUS_LABELS,
} from "@/components/fields/planningFieldKit";

/** Planning entity kinds, by their catalog collection name. */
export type PlanningStatusKind = "sprints" | "milestones" | "releases";

/** Neutral fallback for an unexpected status value (defensive — data is schema-validated). */
const NEUTRAL_COLOR = "text-status-closed";

/**
 * Resolve a planning status to its display label + dot color. Falls back to the
 * raw value / neutral color for unknown statuses so a schema drift degrades
 * gracefully instead of throwing.
 */
export function planningStatusMeta(
  kind: PlanningStatusKind,
  status: string,
): { label: string; colorClass: string } {
  if (kind === "sprints") {
    return {
      label:
        SPRINT_STATUS_LABELS[status as keyof typeof SPRINT_STATUS_LABELS] ??
        status,
      colorClass:
        SPRINT_STATUS_COLORS[status as keyof typeof SPRINT_STATUS_COLORS] ??
        NEUTRAL_COLOR,
    };
  }
  if (kind === "milestones") {
    return {
      label:
        MILESTONE_STATUS_LABELS[
          status as keyof typeof MILESTONE_STATUS_LABELS
        ] ?? status,
      colorClass:
        MILESTONE_STATUS_COLORS[
          status as keyof typeof MILESTONE_STATUS_COLORS
        ] ?? NEUTRAL_COLOR,
    };
  }
  return {
    label:
      RELEASE_STATUS_LABELS[status as keyof typeof RELEASE_STATUS_LABELS] ??
      status,
    colorClass:
      RELEASE_STATUS_COLORS[status as keyof typeof RELEASE_STATUS_COLORS] ??
      NEUTRAL_COLOR,
  };
}

interface PlanningStatusBadgeProps {
  kind: PlanningStatusKind;
  status: string;
  className?: string;
}

/** Color-coded dot + label for a planning entity's status. */
export function PlanningStatusBadge({
  kind,
  status,
  className,
}: PlanningStatusBadgeProps) {
  const { label, colorClass } = planningStatusMeta(kind, status);
  return (
    <EnumBadge label={label} colorClass={colorClass} className={className} />
  );
}
