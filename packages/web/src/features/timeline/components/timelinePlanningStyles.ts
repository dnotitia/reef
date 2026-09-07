import type { TimelineSprintBand } from "../lib/timelineLayout";

export function timelineSprintBandClasses(
  status: TimelineSprintBand["status"],
): string {
  return status === "active"
    ? "border-planning-active/50 bg-planning-active/15 text-planning-active"
    : "border-planning-closed/40 bg-planning-closed/10 text-planning-closed";
}
