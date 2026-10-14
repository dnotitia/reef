import type { ClosedReason, IssueUpdatePatch, Status } from "@reef/core";

export function buildStatusPatch(
  nextStatus: Status,
  closedReason: ClosedReason = "completed",
): IssueUpdatePatch {
  if (nextStatus === "closed") {
    return { status: nextStatus, closed_reason: closedReason };
  }
  return { status: nextStatus };
}
