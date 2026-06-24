import { EnumBadge } from "@/components/fields/EnumBadge";
import {
  MILESTONE_STATUS_COLORS,
  RELEASE_STATUS_COLORS,
  SPRINT_STATUS_COLORS,
} from "@/components/fields/planningFieldKit";
import {
  useMilestoneStatusLabels,
  useReleaseStatusLabels,
  useSprintStatusLabels,
} from "@/i18n/fieldLabels";

/** Planning entity kinds, by their catalog collection name. */
export type PlanningStatusKind = "sprints" | "milestones" | "releases";

/** Neutral fallback for an unexpected status value (defensive — data is schema-validated). */
const NEUTRAL_COLOR = "text-status-closed";

const STATUS_COLORS_BY_KIND = {
  sprints: SPRINT_STATUS_COLORS,
  milestones: MILESTONE_STATUS_COLORS,
  releases: RELEASE_STATUS_COLORS,
} as const;

/**
 * Resolve a planning status to its display label + dot color. The label map is
 * passed in already locale-resolved (REEF-292) — color classes stay pure web
 * data. Falls back to the raw value / neutral color for unknown statuses so a
 * schema drift degrades gracefully instead of throwing.
 */
export function planningStatusMeta(
  kind: PlanningStatusKind,
  status: string,
  labels: Record<string, string>,
): { label: string; colorClass: string } {
  const colors = STATUS_COLORS_BY_KIND[kind] as Record<string, string>;
  return {
    label: labels[status] ?? status,
    colorClass: colors[status] ?? NEUTRAL_COLOR,
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
  const sprintLabels = useSprintStatusLabels();
  const milestoneLabels = useMilestoneStatusLabels();
  const releaseLabels = useReleaseStatusLabels();
  const labels =
    kind === "sprints"
      ? sprintLabels
      : kind === "milestones"
        ? milestoneLabels
        : releaseLabels;
  const { label, colorClass } = planningStatusMeta(kind, status, labels);
  return (
    <EnumBadge label={label} colorClass={colorClass} className={className} />
  );
}
