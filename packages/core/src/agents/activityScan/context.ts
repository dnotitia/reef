import type { Span } from "@opentelemetry/api";
import type { AkbAdapter } from "../../adapters/akb";
import {
  listPlanningCatalog as akbListPlanningCatalog,
  listTemplates as akbListTemplates,
} from "../../adapters/akb";
import type { Template } from "../../schemas/issues/template";
import type { PlanningCatalog } from "../../schemas/planning/catalog";

type AttributeSpan = Pick<Span, "setAttribute">;

export async function fetchIssueTemplateContext(
  akbAdapter: AkbAdapter,
  vault: string,
  span: AttributeSpan,
): Promise<Template[]> {
  try {
    const entries = await akbListTemplates({ adapter: akbAdapter, vault });
    const templates = entries.map((entry) => entry.template);
    span.setAttribute("issue_templates.fetched", templates.length);
    return templates;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    span.setAttribute("issue_templates.fetch_failed", true);
    span.setAttribute("issue_templates.fetch_error", detail.slice(0, 200));
    return [];
  }
}

export async function fetchPlanningCatalogContext(
  akbAdapter: AkbAdapter,
  vault: string,
  span: AttributeSpan,
): Promise<PlanningCatalog | undefined> {
  try {
    const catalog = await akbListPlanningCatalog({
      adapter: akbAdapter,
      vault,
    });
    span.setAttribute("planning.sprints.fetched", catalog.sprints.length);
    span.setAttribute("planning.milestones.fetched", catalog.milestones.length);
    span.setAttribute("planning.releases.fetched", catalog.releases.length);
    return catalog;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    span.setAttribute("planning.fetch_failed", true);
    span.setAttribute("planning.fetch_error", detail.slice(0, 200));
    return undefined;
  }
}
