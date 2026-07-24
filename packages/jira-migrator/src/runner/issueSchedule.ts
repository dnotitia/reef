import type { JiraIssueImportPlan } from "../issues/importPlan.js";

export const issueReferences = (plan: JiraIssueImportPlan): string[] => {
  const desired = plan.desired.issue;
  return desired
    ? [
        desired.parent_id,
        ...(desired.depends_on ?? []),
        ...(desired.blocks ?? []),
        ...(desired.related_to ?? []),
      ].filter((id): id is string => typeof id === "string")
    : [];
};

export function scheduleIssuePlansForApply(
  plans: readonly JiraIssueImportPlan[],
): {
  plans: JiraIssueImportPlan[];
  blockedIssueIds: Set<string>;
} {
  const planByIssueId = new Map(
    plans.flatMap((plan) =>
      plan.desired.issue ? [[plan.desired.issue.id, plan] as const] : [],
    ),
  );
  const pending = new Set(planByIssueId.keys());
  const scheduled: JiraIssueImportPlan[] = [];
  while (pending.size > 0) {
    let progressed = false;
    for (const plan of plans) {
      const desired = plan.desired.issue;
      if (!desired || !pending.has(desired.id)) continue;
      const dependencies = [desired.parent_id].filter(
        (id): id is string => typeof id === "string" && planByIssueId.has(id),
      );
      if (dependencies.some((id) => pending.has(id))) continue;
      scheduled.push(plan);
      pending.delete(desired.id);
      progressed = true;
    }
    if (!progressed) break;
  }
  const blockedIssueIds = new Set(pending);
  scheduled.push(
    ...plans.filter(
      (plan) =>
        !plan.desired.issue || blockedIssueIds.has(plan.desired.issue.id),
    ),
  );
  return { plans: scheduled, blockedIssueIds };
}
