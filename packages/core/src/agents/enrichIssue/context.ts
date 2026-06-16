import type { AkbAdapter } from "../../adapters/akb";
import {
  listIssues,
  listPlanningCatalog,
  listTemplates,
  readConfig,
} from "../../adapters/akb";
import {
  AkbApiError,
  AuthError,
  NotFoundError,
  SchemaValidationError,
} from "../../errors";
import type {
  EnrichmentContext,
  EnrichmentLabelContext,
  EnrichmentRepoContext,
} from "../../schemas/ai/enrichment";
import type { IssueMetadata } from "../../schemas/issues/metadata";
import type { Template } from "../../schemas/issues/template";
import { extractErrorDetail } from "../../utils/extractErrorDetail";
import { templateToCatalogItem } from "../prompts/templateCatalog";

type AttributeSpan = {
  setAttribute: (key: string, value: string | number | boolean) => void;
};

export class WorkspaceBoundaryError extends Error {
  readonly boundaryCause: AuthError | NotFoundError | AkbApiError;

  constructor(boundaryCause: AuthError | NotFoundError | AkbApiError) {
    super(boundaryCause.message);
    this.name = "WorkspaceBoundaryError";
    this.boundaryCause = boundaryCause;
  }
}

async function safeContextPart<T>(
  span: AttributeSpan,
  name: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    const boundaryError = toWorkspaceBoundaryError(err);
    if (boundaryError) {
      throw boundaryError;
    }
    span.setAttribute(`enrichment.context.${name}.failed`, true);
    span.setAttribute(
      `enrichment.context.${name}.error`,
      extractErrorDetail(err).slice(0, 200),
    );
    return fallback;
  }
}

function toWorkspaceBoundaryError(err: unknown): WorkspaceBoundaryError | null {
  if (err instanceof AuthError || err instanceof NotFoundError) {
    return new WorkspaceBoundaryError(err);
  }
  if (
    err instanceof AkbApiError &&
    (err.status === 401 || err.status === 403 || err.status === 404)
  ) {
    return new WorkspaceBoundaryError(err);
  }
  return null;
}

export async function resolveVerifiedRepoContext({
  akbAdapter,
  vault,
  repoContext,
  span,
}: {
  akbAdapter: AkbAdapter | undefined;
  vault: string;
  repoContext: EnrichmentRepoContext | undefined;
  span: AttributeSpan;
}): Promise<EnrichmentRepoContext | undefined> {
  if (!repoContext || !akbAdapter) {
    return undefined;
  }

  let configResult: Awaited<ReturnType<typeof readConfig>>;
  try {
    configResult = await readConfig({ adapter: akbAdapter, vault });
  } catch (err) {
    const boundaryError = toWorkspaceBoundaryError(err);
    if (boundaryError) {
      throw boundaryError;
    }
    throw err;
  }
  const { config } = configResult;
  const requestedOwner = repoContext.owner.toLowerCase();
  const requestedRepo = repoContext.repo.toLowerCase();
  const monitoredRepo = config.monitored_repos.find(
    (repo) =>
      repo.owner.toLowerCase() === requestedOwner &&
      repo.name.toLowerCase() === requestedRepo,
  );

  if (!monitoredRepo) {
    span.setAttribute("enrichment.repo_context.rejected", true);
    throw new SchemaValidationError({
      field: "repoContext",
      issues: [
        "repoContext must reference a repository configured in monitored_repos",
      ],
    });
  }

  span.setAttribute("enrichment.repo_context.verified", true);
  return { owner: monitoredRepo.owner, repo: monitoredRepo.name };
}

function buildLabelContext(
  issues: readonly IssueMetadata[],
  templates: readonly Template[],
): EnrichmentLabelContext[] {
  const counts = new Map<
    string,
    { issue_count: number; template_count: number }
  >();
  const bump = (name: string, field: "issue_count" | "template_count") => {
    const label = name.trim();
    if (!label) return;
    const current = counts.get(label) ?? { issue_count: 0, template_count: 0 };
    current[field] += 1;
    counts.set(label, current);
  };

  for (const issue of issues) {
    for (const label of issue.labels ?? []) bump(label, "issue_count");
  }
  for (const template of templates) {
    for (const label of template.default_labels ?? []) {
      bump(label, "template_count");
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, ...count }))
    .sort(
      (a, b) =>
        b.issue_count + b.template_count - (a.issue_count + a.template_count) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 80);
}

export async function buildEnrichmentContext({
  akbAdapter,
  vault,
  span,
}: {
  akbAdapter: AkbAdapter | undefined;
  vault: string;
  span: AttributeSpan;
}): Promise<EnrichmentContext> {
  if (!akbAdapter) {
    return { labels: [], members: [], templates: [], knownIssueIds: [] };
  }

  const [issuesResult, templateEntries, planningCatalog] = await Promise.all([
    safeContextPart(
      span,
      "issues",
      () => listIssues({ adapter: akbAdapter, vault }),
      { issues: [] },
    ),
    safeContextPart(
      span,
      "templates",
      () => listTemplates({ adapter: akbAdapter, vault }),
      [],
    ),
    safeContextPart(
      span,
      "planning",
      () => listPlanningCatalog({ adapter: akbAdapter, vault }),
      undefined,
    ),
  ]);

  const issues = issuesResult.issues;
  const templates = templateEntries.map((entry) => entry.template);
  const labels = buildLabelContext(issues, templates);
  span.setAttribute("enrichment.context.issue_count", issues.length);
  span.setAttribute("enrichment.context.template_count", templates.length);
  span.setAttribute("enrichment.context.label_count", labels.length);

  return {
    labels,
    members: [],
    ...(planningCatalog ? { planningCatalog } : {}),
    templates: templates.map(templateToCatalogItem),
    knownIssueIds: issues.map((issue) => issue.id),
  };
}
