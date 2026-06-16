import type {
  ClosedReason,
  IssueMetadata,
  IssueUpdatePatch,
  Status,
} from "@reef/core";

export function buildStatusPatch(
  _issue: IssueMetadata,
  nextStatus: Status,
  _now?: string,
  closedReason: ClosedReason = "completed",
): IssueUpdatePatch {
  const patch: IssueUpdatePatch = {
    status: nextStatus,
  };

  if (nextStatus === "closed") {
    return {
      ...patch,
      closed_reason: closedReason,
    };
  }

  return patch;
}
