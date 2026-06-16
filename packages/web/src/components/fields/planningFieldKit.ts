/**
 * planningFieldKit — web-side planning field metadata. Re-exports the
 * framework-agnostic planning labels/options from core and owns the web
 * concern that should not live in core: Tailwind color classes (REEF-018 split —
 * enum/label/option data in core, color classes in web).
 *
 * Plain data module (no React); import it directly. Mirrors `fieldKit.ts` for
 * issue fields, reusing the shared `--status-*` tokens so planning status
 * indicators share the visual language of the issue StatusBadge.
 */
import type {
  MilestoneStatus,
  ReleaseStatus,
  SprintStatus,
} from "@reef/core/fields/planning";

export {
  SPRINT_STATUS_LABELS,
  SPRINT_STATUS_OPTIONS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_OPTIONS,
  RELEASE_STATUS_LABELS,
  RELEASE_STATUS_OPTIONS,
  type SprintStatus,
  type MilestoneStatus,
  type ReleaseStatus,
} from "@reef/core/fields/planning";

/** Tailwind text-color classes per sprint status (consumed as the dot color). */
export const SPRINT_STATUS_COLORS: Record<SprintStatus, string> = {
  planned: "text-status-open",
  active: "text-status-in-progress",
  closed: "text-status-closed",
};

/** Tailwind text-color classes per milestone status. */
export const MILESTONE_STATUS_COLORS: Record<MilestoneStatus, string> = {
  open: "text-status-open",
  closed: "text-status-done",
};

/** Tailwind text-color classes per release status. */
export const RELEASE_STATUS_COLORS: Record<ReleaseStatus, string> = {
  planned: "text-status-open",
  in_progress: "text-status-in-progress",
  released: "text-status-done",
};
