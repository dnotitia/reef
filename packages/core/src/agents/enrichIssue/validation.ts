import { LlmError, SchemaValidationError } from "../../errors";
import {
  type EnrichmentContext,
  type EnrichmentResult,
  EnrichmentResultSchema,
  type EnrichmentSuggestion,
  EnrichmentSuggestionSchema,
  type ReferenceSuggestion,
  ReferenceSuggestionSchema,
} from "../../schemas/ai/enrichment";
import { parseLenientJson } from "../../utils/parseLenientJson";

export function averageConfidence(
  suggestions: readonly EnrichmentSuggestion[],
): number | null {
  if (suggestions.length === 0) return null;
  return (
    suggestions.reduce((sum, suggestion) => sum + suggestion.confidence, 0) /
    suggestions.length
  );
}

export function rescueEmptyText(result: unknown): string | null {
  const obj = result as Record<string, unknown>;

  if (typeof obj.reasoning === "string" && obj.reasoning.trim()) {
    return obj.reasoning;
  }

  const response = obj.response as { messages?: unknown } | undefined;
  if (response && Array.isArray(response.messages)) {
    for (const msg of response.messages) {
      const m = msg as Record<string, unknown>;
      if (
        typeof m.reasoning_content === "string" &&
        m.reasoning_content.trim()
      ) {
        return m.reasoning_content;
      }
      const content = m.content;
      if (typeof content === "string" && content.trim()) return content;
      if (Array.isArray(content)) {
        for (const part of content) {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string" && p.text.trim()) return p.text;
        }
      }
    }
  }

  return null;
}

export function parseEnrichmentResponse(raw: string): unknown[] {
  if (!raw.trim()) {
    throw new LlmError({
      message:
        "Enrichment response was empty — the LLM produced no output. " +
        "Check the model and base URL in Settings.",
    });
  }

  const result = parseLenientJson(raw);
  if (!result.ok) {
    const detail =
      result.error instanceof Error
        ? result.error.message
        : String(result.error);
    throw new LlmError({
      message: `Enrichment response is not valid JSON: ${detail}`,
    });
  }
  const parsed = result.value;

  if (
    parsed &&
    typeof parsed === "object" &&
    "suggestions" in parsed &&
    Array.isArray((parsed as { suggestions: unknown }).suggestions)
  ) {
    return (parsed as { suggestions: unknown[] }).suggestions;
  }
  return [];
}

/**
 * Pull the optional `references` array out of the enrichment JSON (REEF-083
 * AC4). Lenient like `parseEnrichmentResponse`: a missing/invalid block yields
 * an empty list rather than failing the whole enrichment.
 */
export function parseEnrichmentReferences(raw: string): unknown[] {
  if (!raw.trim()) return [];
  const result = parseLenientJson(raw);
  if (!result.ok) return [];
  const parsed = result.value;
  if (
    parsed &&
    typeof parsed === "object" &&
    "references" in parsed &&
    Array.isArray((parsed as { references: unknown }).references)
  ) {
    return (parsed as { references: unknown[] }).references;
  }
  return [];
}

/**
 * Validate the raw reference proposals, dropping malformed entries (bad shape,
 * non-document URI) and de-duplicating by target URI — same degrade-gracefully
 * contract as `validateSuggestions`.
 */
export function validateReferences(raw: unknown[]): ReferenceSuggestion[] {
  const seen = new Set<string>();
  const out: ReferenceSuggestion[] = [];
  for (const item of raw) {
    const parsed = ReferenceSuggestionSchema.safeParse(item);
    if (!parsed.success) continue;
    if (seen.has(parsed.data.uri)) continue;
    seen.add(parsed.data.uri);
    out.push(parsed.data);
  }
  return out;
}

export interface ValidateSuggestionsOptions {
  context: EnrichmentContext;
}

export function validateSuggestions(
  raw: unknown[],
  options: ValidateSuggestionsOptions,
): EnrichmentSuggestion[] {
  const { context } = options;
  const knownIds = new Set(context.knownIssueIds);
  const planningIds = context.planningCatalog
    ? {
        milestoneIds: new Set(
          context.planningCatalog.milestones.map((i) => i.id),
        ),
        sprintIds: new Set(context.planningCatalog.sprints.map((i) => i.id)),
        releaseIds: new Set(context.planningCatalog.releases.map((i) => i.id)),
      }
    : null;
  const seenFields = new Set<string>();
  const out: EnrichmentSuggestion[] = [];

  for (const item of raw) {
    const parsed = EnrichmentSuggestionSchema.safeParse(item);
    if (!parsed.success) continue;
    if (seenFields.has(parsed.data.field)) continue;

    if (
      parsed.data.field === "depends_on" ||
      parsed.data.field === "blocks" ||
      parsed.data.field === "related_to"
    ) {
      const filtered = parsed.data.value.filter((id) => knownIds.has(id));
      if (filtered.length === 0) continue;
      out.push({ ...parsed.data, value: filtered });
    } else if (parsed.data.field === "parent_id") {
      if (!knownIds.has(parsed.data.value)) continue;
      out.push(parsed.data);
    } else if (
      parsed.data.field === "start_date" ||
      parsed.data.field === "due_date"
    ) {
      if (Number.isNaN(Date.parse(parsed.data.value))) continue;
      out.push(parsed.data);
    } else if (parsed.data.field === "milestone_id") {
      if (!planningIds?.milestoneIds.has(parsed.data.value)) continue;
      out.push(parsed.data);
    } else if (parsed.data.field === "sprint_id") {
      if (!planningIds?.sprintIds.has(parsed.data.value)) continue;
      out.push(parsed.data);
    } else if (parsed.data.field === "release_id") {
      if (!planningIds?.releaseIds.has(parsed.data.value)) continue;
      out.push(parsed.data);
    } else if (parsed.data.field === "labels") {
      const normalized = [...new Set(parsed.data.value.map((l) => l.trim()))]
        .filter((label) => label.length > 0)
        .slice(0, 5);
      if (normalized.length === 0) continue;
      out.push({ ...parsed.data, value: normalized });
    } else {
      out.push(parsed.data);
    }
    seenFields.add(parsed.data.field);
  }

  return out;
}

export function parseEnrichmentResult(
  result: EnrichmentResult,
): EnrichmentResult {
  const parsed = EnrichmentResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new SchemaValidationError({
      field: "enrichmentResult",
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  return parsed.data;
}
