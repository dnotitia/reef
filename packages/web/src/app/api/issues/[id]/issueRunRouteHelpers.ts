import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import type { IssueRunRequestEligibilityReason } from "@reef/core";

const ERROR_KEYS = {
  not_authorized: "issueRun.notAuthorized",
  not_assignee: "issueRun.notAssignee",
  issue_archived: "issueRun.issueArchived",
  issue_document_unavailable: "issueRun.documentUnavailable",
  issue_type_not_runnable: "issueRun.typeNotRunnable",
  issue_status_not_todo: "issueRun.statusNotTodo",
  unresolved_dependencies: "issueRun.dependenciesUnresolved",
  target_missing: "issueRun.targetMissing",
  target_disabled: "issueRun.targetDisabled",
  target_invalid: "issueRun.targetInvalid",
  profile_unavailable: "issueRun.profileUnavailable",
  run_already_active: "issueRun.alreadyActive",
} as const satisfies Record<IssueRunRequestEligibilityReason, string>;

export function issueRunReasonStatus(
  reason: IssueRunRequestEligibilityReason,
): 403 | 409 | 422 {
  if (reason === "not_authorized" || reason === "not_assignee") return 403;
  if (reason === "run_already_active") return 409;
  return 422;
}

export async function issueRunErrorResponse(
  reason: IssueRunRequestEligibilityReason,
  options: { runId?: string } = {},
): Promise<Response> {
  const status = issueRunReasonStatus(reason);
  const localized = await localizedErrorResponse(ERROR_KEYS[reason], status);
  const body = (await localized.json()) as { error: string };
  return Response.json(
    {
      error: body.error,
      code: reason,
      ...(options.runId ? { run_id: options.runId } : {}),
    },
    { status },
  );
}
