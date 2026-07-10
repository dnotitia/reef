import type {
  DevelopmentProfileCatalog,
  DevelopmentTargetItem,
} from "../schemas/ai/developmentTargets";
import {
  type IssueRunActiveRunSummary,
  type IssueRunRequestEligibility,
  type IssueRunRequestEligibilityReason,
  IssueRunRequestEligibilitySchema,
  type IssueRunTargetOption,
  type IssueRunWorkspaceRole,
} from "../schemas/ai/issueRunRequests";
import type { IssueType, Status } from "../schemas/issues";
import { isResolvedStatus } from "./status";

const RUNNABLE_ISSUE_TYPES = new Set<IssueType>([
  "story",
  "task",
  "bug",
  "spike",
  "chore",
]);

const TARGET_REASON_PRIORITY = [
  "target_missing",
  "target_disabled",
  "target_invalid",
  "profile_unavailable",
] as const satisfies readonly IssueRunRequestEligibilityReason[];

export interface ResolveIssueRunRequestEligibilityInput {
  actor: string;
  role: IssueRunWorkspaceRole | null;
  issue: {
    assigned_to: string | null;
    archived_at: string | null;
    depends_on: string[];
    issue_type: IssueType;
    status: Status;
  };
  dependencyStatuses: ReadonlyMap<string, Status>;
  documentAvailable: boolean;
  targets: readonly DevelopmentTargetItem[];
  catalog: DevelopmentProfileCatalog;
  activeRun: IssueRunActiveRunSummary | null;
}

function safeTargetOptions(
  targets: readonly DevelopmentTargetItem[],
  catalog: DevelopmentProfileCatalog,
): IssueRunTargetOption[] {
  const runnerLabels = new Map(
    catalog.runner_profiles.map((profile) => [profile.id, profile.label]),
  );
  const permissionLabels = new Map(
    catalog.permission_profiles.map((profile) => [profile.id, profile.label]),
  );
  return targets.flatMap((item) => {
    const config = item.config;
    if (!item.eligibility.eligible || config == null) return [];
    if (
      config.recipe_path == null ||
      config.branch_template == null ||
      config.runner_profile == null ||
      config.permission_profile == null
    ) {
      return [];
    }
    const runnerLabel = runnerLabels.get(config.runner_profile);
    const permissionLabel = permissionLabels.get(config.permission_profile);
    if (runnerLabel == null || permissionLabel == null) return [];
    return [
      {
        github_id: item.repo.github_id,
        repo: `${item.repo.owner}/${item.repo.name}`,
        recipe_path: config.recipe_path,
        branch_template: config.branch_template,
        runner_profile: { id: config.runner_profile, label: runnerLabel },
        permission_profile: {
          id: config.permission_profile,
          label: permissionLabel,
        },
      },
    ];
  });
}

function targetReasons(
  targets: readonly DevelopmentTargetItem[],
  options: readonly IssueRunTargetOption[],
): IssueRunRequestEligibilityReason[] {
  if (options.length > 0) return [];
  if (targets.length === 0) return ["target_missing"];
  const observed = new Set(
    targets.flatMap((target) =>
      target.eligibility.reason == null ? [] : [target.eligibility.reason],
    ),
  );
  return TARGET_REASON_PRIORITY.filter((reason) => observed.has(reason));
}

/**
 * Pure server-owned eligibility policy for durable issue-run requests.
 * Deliberately accepts no issue body: prose headings and acceptance-criteria
 * formatting cannot affect whether a request is structurally safe to enqueue.
 */
export function resolveIssueRunRequestEligibility(
  input: ResolveIssueRunRequestEligibilityInput,
): IssueRunRequestEligibility {
  const reasons: IssueRunRequestEligibilityReason[] = [];
  const canWrite =
    input.role === "writer" || input.role === "admin" || input.role === "owner";
  if (!canWrite) reasons.push("not_authorized");
  if (
    input.role === "writer" &&
    input.issue.assigned_to != null &&
    input.issue.assigned_to !== input.actor
  ) {
    reasons.push("not_assignee");
  }
  if (input.issue.archived_at != null) reasons.push("issue_archived");
  if (!input.documentAvailable) reasons.push("issue_document_unavailable");
  if (!RUNNABLE_ISSUE_TYPES.has(input.issue.issue_type)) {
    reasons.push("issue_type_not_runnable");
  }
  if (input.issue.status !== "todo") reasons.push("issue_status_not_todo");
  if (
    input.issue.depends_on.some((dependencyId) => {
      const status = input.dependencyStatuses.get(dependencyId);
      return status == null || !isResolvedStatus(status);
    })
  ) {
    reasons.push("unresolved_dependencies");
  }

  const targetOptions = safeTargetOptions(input.targets, input.catalog);
  reasons.push(...targetReasons(input.targets, targetOptions));
  if (input.activeRun != null) reasons.push("run_already_active");

  return IssueRunRequestEligibilitySchema.parse({
    eligible: reasons.length === 0,
    reasons,
    target_options: targetOptions,
    default_target_github_id:
      targetOptions.length === 1 ? targetOptions[0]?.github_id : null,
    active_run: input.activeRun,
  });
}
