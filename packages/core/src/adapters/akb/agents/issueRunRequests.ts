import { NotFoundError, SchemaValidationError } from "../../../errors";
import { resolveIssueRunRequestEligibility } from "../../../models";
import {
  type DevelopmentProfileCatalog,
  type IssueRunActiveRunSummary,
  IssueRunActiveRunSummarySchema,
  type IssueRunRequestEligibility,
  type IssueRunRequestEligibilityReason,
  IssueRunWorkspaceRoleEnum,
  renderDevelopmentBranchTemplate,
} from "../../../schemas/ai";
import {
  AgentRunRecordSchema,
  WorkEventSchema,
} from "../../../schemas/ai/runRecords";
import { IssueTypeEnum, StatusEnum } from "../../../schemas/issues";
import {
  REEF_ISSUES_TABLE,
  ensureDocumentResponse,
  issuePathFor,
  makeIssueResourceLabel,
  quoteText,
  rowToIssue,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import type { ReadIssueRunRequestContextParams } from "../core/types";
import { listIssueRelations } from "../issues/issueRelations";
import { listVaults } from "../workspace/vaults";
import { listDevelopmentTargets } from "./developmentTargets";
import { createQueuedIssueRun, readActiveAgentRunForIssue } from "./runRecords";

export interface GetIssueRunRequestEligibilityParams {
  adapter: ReadIssueRunRequestContextParams["adapter"];
  vault: string;
  id: string;
  actor: string;
  catalog: DevelopmentProfileCatalog;
}

export interface RequestQueuedIssueRunParams
  extends GetIssueRunRequestEligibilityParams {
  githubId: number;
  requestId: string;
  now?: Date;
}

export type RequestQueuedIssueRunResult =
  | {
      kind: "created" | "replayed";
      run_id: string;
      status: "queued";
      created: boolean;
    }
  | { kind: "conflict"; run_id: string }
  | { kind: "rejected"; reason: IssueRunRequestEligibilityReason };

/**
 * Read the row-owned eligibility fields even when the linked document is
 * missing or malformed. That distinction lets GET eligibility fail closed with
 * `issue_document_unavailable` instead of turning a row-backed issue into a 404.
 */
export async function readIssueRunRequestContext(
  params: ReadIssueRunRequestContextParams,
) {
  const { adapter, vault, id } = params;
  return withSpan(
    "akb.read_issue_run_request_context",
    { vault, reef_id: id },
    async () => {
      const response = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(REEF_ISSUES_TABLE)} WHERE reef_id = ${quoteText(
          id,
          "reef_id",
        )} LIMIT 1`,
      );
      const row = response.kind === "table_query" ? response.items[0] : null;
      if (!row) {
        throw new NotFoundError({ resource: makeIssueResourceLabel(id) });
      }
      const issue = rowToIssue(row);
      const documentUri =
        typeof row.document_uri === "string" && row.document_uri.length > 0
          ? row.document_uri
          : null;
      if (documentUri == null) {
        return {
          issue,
          document_uri: null,
          commit_hash: null,
          document_available: false,
        };
      }
      try {
        const payload = await adapter.request(
          `/api/v1/documents/${encodeURIComponent(vault)}/${issuePathFor(id)}`,
          { resource: makeIssueResourceLabel(id) },
        );
        const document = ensureDocumentResponse(payload);
        return {
          issue,
          document_uri: documentUri,
          commit_hash: document.current_commit ?? null,
          document_available: true,
        };
      } catch (error) {
        if (
          error instanceof NotFoundError ||
          error instanceof SchemaValidationError
        ) {
          return {
            issue,
            document_uri: documentUri,
            commit_hash: null,
            document_available: false,
          };
        }
        throw error;
      }
    },
  );
}

async function evaluateIssueRunRequest(
  params: GetIssueRunRequestEligibilityParams,
) {
  const { adapter, vault, id, actor, catalog } = params;
  const [context, relations, targets, vaultResult] = await Promise.all([
    readIssueRunRequestContext({ adapter, vault, id }),
    listIssueRelations(adapter, vault),
    listDevelopmentTargets({ adapter, vault, catalog }),
    listVaults({ adapter }),
  ]);
  const rawRole = vaultResult.vaults.find((item) => item.name === vault)?.role;
  const parsedRole = IssueRunWorkspaceRoleEnum.safeParse(rawRole);
  const role = parsedRole.success ? parsedRole.data : null;
  const dependencyStatuses = new Map(
    relations.map((relation) => [relation.id, relation.status]),
  );
  const resolveEligibility = (activeRun: IssueRunActiveRunSummary | null) =>
    resolveIssueRunRequestEligibility({
      actor,
      role,
      issue: {
        assigned_to: context.issue.assigned_to ?? null,
        archived_at: context.issue.archived_at ?? null,
        depends_on: context.issue.depends_on ?? [],
        issue_type: IssueTypeEnum.parse(context.issue.issue_type),
        status: StatusEnum.parse(context.issue.status),
      },
      dependencyStatuses,
      documentAvailable: context.document_available,
      targets,
      catalog,
      activeRun,
    });
  const authorizationEligibility = resolveEligibility(null);
  const authorizationReason = authorizationEligibility.reasons[0];
  if (
    authorizationReason === "not_authorized" ||
    authorizationReason === "not_assignee"
  ) {
    return {
      context,
      targets,
      activeRun: null,
      eligibility: authorizationEligibility,
    };
  }
  const activeResult = await readActiveAgentRunForIssue({
    adapter,
    vault,
    reefId: id,
  });
  const activeRun = activeResult.run
    ? IssueRunActiveRunSummarySchema.parse({
        run_id: activeResult.run.run_id,
        status: activeResult.run.status,
        phase: activeResult.run.phase,
      })
    : null;
  const eligibility = resolveEligibility(activeRun);
  return { context, targets, activeRun, eligibility };
}

export async function getIssueRunRequestEligibility(
  params: GetIssueRunRequestEligibilityParams,
): Promise<IssueRunRequestEligibility> {
  return (await evaluateIssueRunRequest(params)).eligibility;
}

export async function requestQueuedIssueRun(
  params: RequestQueuedIssueRunParams,
): Promise<RequestQueuedIssueRunResult> {
  const evaluated = await evaluateIssueRunRequest(params);
  const reason = evaluated.eligibility.reasons[0];
  if (reason === "not_authorized" || reason === "not_assignee") {
    return { kind: "rejected", reason };
  }
  const active = evaluated.activeRun;
  if (active != null) return { kind: "conflict", run_id: active.run_id };

  const selectedOption = evaluated.eligibility.target_options.find(
    (option) => option.github_id === params.githubId,
  );
  const selectedTarget = evaluated.targets.find(
    (target) => target.repo.github_id === params.githubId,
  );
  const selectedReason = selectedTarget?.eligibility.reason;
  if (reason != null) return { kind: "rejected", reason };
  if (selectedOption == null || selectedTarget?.config == null) {
    return {
      kind: "rejected",
      reason: selectedReason ?? "target_missing",
    };
  }

  const requestedAt = (params.now ?? new Date()).toISOString();
  const runId = `run-${params.requestId}`;
  const workEventId = `work-${params.requestId}`;
  const branch = renderDevelopmentBranchTemplate(
    selectedOption.branch_template,
    { issue_id: params.id, run_id: runId },
  );
  const run = AgentRunRecordSchema.parse({
    run_id: runId,
    reef_id: params.id,
    active_reef_id: params.id,
    work_event_id: workEventId,
    task_id: "reef.issue.run",
    vault: params.vault,
    status: "queued",
    phase: "queued",
    attempt_number: 1,
    target: {
      github_id: selectedOption.github_id,
      repo: selectedOption.repo,
      base_ref: null,
      branch,
      recipe_path: selectedOption.recipe_path,
      runner_profile: selectedOption.runner_profile.id,
      permission_profile: selectedOption.permission_profile.id,
      worktree_path: null,
      head_sha: null,
      pull_request_url: null,
    },
    input: {
      issue_id: params.id,
      document_uri: evaluated.context.document_uri,
      issue_commit_hash: evaluated.context.commit_hash,
      requested_by: params.actor,
      requested_at: requestedAt,
    },
    result: null,
    error: null,
    queued_at: requestedAt,
    state_updated_at: requestedAt,
    meta: { source: "reef-web:issue-run", request_id: params.requestId },
  });
  const event = WorkEventSchema.parse({
    work_event_id: workEventId,
    reef_id: params.id,
    event_type: "issue.run.requested",
    event_key: `issue.run.requested:${params.requestId}`,
    occurred_at: requestedAt,
    payload: {
      run_id: runId,
      task_id: "reef.issue.run",
      github_id: selectedOption.github_id,
    },
    meta: { actor: params.actor, source: "reef-web:issue-run" },
  });
  const result = await createQueuedIssueRun({
    adapter: params.adapter,
    vault: params.vault,
    run,
    event,
  });
  if (result.kind === "conflict") {
    return { kind: "conflict", run_id: result.run.run_id };
  }
  return {
    kind: result.kind,
    run_id: result.run.run_id,
    status: "queued",
    created: result.kind === "created",
  };
}
