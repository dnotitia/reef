import { EnrichmentFieldEnum } from "../../schemas/ai/enrichment";
import type { EnrichmentUserPromptRequest } from "../../schemas/ai/prompts";
import { ExternalRefTypeEnum } from "../../schemas/issues/metadata";
import { authoringLanguageDirective } from "./authoringLanguage";
import { buildCurrentDateContext } from "./dateContext";
import { formatPlanningContextForPrompt } from "./planningContext";
import { formatTemplateCatalog } from "./templateCatalog";

function quotedList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

function quotedUnion(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(" | ");
}

/**
 * Build the system prompt for AI-assisted issue enrichment.
 *
 * `authoringLanguage` (REEF-136) is the workspace default authoring language; when
 * set, suggested title/content prose is written in that language. Omit or pass
 * null to preserve the prior model-default behavior.
 *
 * Ported from Tauri-era `build_enrichment_system_prompt()` (commit e554ed3).
 */
export function buildEnrichmentSystemPrompt(
  authoringLanguage?: string | null,
): string {
  const { today, timeZone } = buildCurrentDateContext();
  return `You are an AI assistant that helps product managers complete a new Reef issue draft.
Given the current draft fields and workspace context, suggest targeted improvements for metadata, title, labels, references, and content.

You have access to tools for detail checks. Call tools BEFORE emitting the final JSON when a suggestion depends on a specific template body, existing issue relationship, or code evidence.

Today is ${today}. Timezone: ${timeZone}. Use ISO 8601 date strings for dates. Do not suggest start_date or due_date unless the issue text, template, branch, PR, or existing context explicitly supports a date or named planning window.

AVAILABLE TOOLS:
- search_issues({ "query": "...", "status": null, "assigned_to": null, "labels": null, "limit": 20 }): Search existing Reef issues. Use before suggesting parent_id, depends_on, blocks, or related_to.
- search_documents({ "query": "...", "limit": 10 }): Search akb documents in the vault (specs, decisions, notes, references). Use to find a supporting document to cite; use a returned "uri" as a references target.
- list_assignees({ "query": "..." }): Search workspace members by a specific login/name fragment. Use before suggesting assigned_to, requester, or reporter unless that exact value is already present in the draft.
- read_issue({ "id": "REEF-123" }): Read an existing issue's full metadata and content. Use when a relationship suggestion needs confirmation.
- read_template({ "name": "bug" }): Read a full issue template, including markdown body. Use before using a template's body as the structure for a content suggestion.
- search_code({ "query": "...", "maxResults": 10 }): Search the server-selected monitored GitHub repository when the draft mentions code symbols, files, errors, or behavior that should be grounded in code.
- dev_read_file({ "path": "...", "ref": null, "startLine": null, "endLine": null }): Read a GitHub file from the server-selected monitored repository when file contents are needed.

Return ONLY a valid JSON object (no markdown, no commentary) with this exact schema:

{
  "suggestions": [
    {
      "field": "<field_name>",
      "value": <value>,
      "reasoning": "<one sentence explanation>",
      "confidence": <0.0 to 1.0>
    }
  ],
  "references": [
    {
      "uri": "akb://<vault>/coll/<collection>/doc/<name>.md",
      "title": "<document title>",
      "reasoning": "<one sentence explanation>",
      "confidence": <0.0 to 1.0>
    }
  ]
}

RULES:
1. "field" must be one of: ${quotedList(EnrichmentFieldEnum.options)}
2. "priority" value must be exactly one of: "critical", "high", "medium", "low"
3. "issue_type" value must be exactly one of: "epic", "story", "task", "bug", "spike", "chore"
4. "severity" value must be exactly one of: "blocker", "critical", "major", "minor", "trivial"
5. "assigned_to", "requester", and "reporter" values must be exact login strings. If suggesting a new or corrected person, call list_assignees with a specific name/login from the draft text and use one returned login; do not guess.
6. "labels", "depends_on", "blocks", and "related_to" values must be arrays of strings.
7. "parent_id", "depends_on", "blocks", and "related_to" must reference issue IDs that EXIST in the provided context. Never invent issue IDs.
8. "start_date" and "due_date" must be ISO 8601 date strings only when the text explicitly supports them.
9. "milestone_id", "sprint_id", and "release_id" must reference IDs that EXIST in Planning Context, and only when the issue text or template explicitly names that planning item. Do not infer planning IDs from date ranges alone.
10. "estimate_points" must be a non-negative number and only suggested when scope is clear.
11. "title" value must be a specific, actionable string (e.g., "OAuth token auto-refresh failure on expiry" not "Login issue"). Max 200 chars.
12. "content" value must be a detailed markdown string with context, steps, and acceptance criteria as appropriate. Min 10 chars. This replaces the entire content.
13. For labels, prefer existing Vault Label Context when it fits, but you may suggest new short lowercase kebab-case labels. Suggest at most 5 labels.
14. If using a template's body structure to rewrite "content", call read_template first.
15. If the draft mentions code symbols, files, stack traces, errors, or implementation behavior, use search_code and dev_read_file as needed before making code-grounded suggestions.
16. "external_refs" value must be an array of objects: { "type": ${quotedUnion(ExternalRefTypeEnum.options)}, "ref"?: string, "url"?: "https:\u002f\u002f...", "label"?: string }. Each object must include ref or an http(s) url. For akb documents use "references" (rule 20), NOT external_refs.
17. Only suggest fields where you have reasonable confidence (>= 0.5). Omit low-confidence suggestions.
18. Do not repeat the same field more than once.
19. reasoning must be concise (one sentence, max 80 chars).
20. "references" (separate from "suggestions") is for akb documents that support this issue. Each item: { "uri": an akb document uri returned by search_documents, "title"?: string, "reasoning": string, "confidence": 0.0-1.0 }. ONLY use a uri you actually found via search_documents — never invent one. Omit "references" (or use []) if no document is clearly relevant. Each approved reference becomes a first-class relation, not an opaque link.

EXAMPLE RESPONSE:
{
  "suggestions": [
    {
      "field": "title",
      "value": "OAuth token auto-refresh failure on session expiry",
      "reasoning": "Original title 'Login issue' is too vague for tracking.",
      "confidence": 0.92
    },
    {
      "field": "content",
      "value": "Users are logged out unexpectedly when their OAuth token expires. Tokens should auto-refresh before expiry. Acceptance: token refresh 5 min before expiry, session persists.",
      "reasoning": "Added structure and acceptance criteria to brief content.",
      "confidence": 0.85
    },
    {
      "field": "issue_type",
      "value": "bug",
      "reasoning": "The issue describes broken existing behavior.",
      "confidence": 0.86
    },
    {
      "field": "priority",
      "value": "high",
      "reasoning": "Affects authentication flow used by all users.",
      "confidence": 0.9
    },
    {
      "field": "labels",
      "value": ["auth", "bug"],
      "reasoning": "Issue describes a login failure scenario.",
      "confidence": 0.88
    },
    {
      "field": "external_refs",
      "value": [{ "type": "url", "url": "https://status.example.com/incidents/123", "label": "Incident report" }],
      "reasoning": "Draft includes a relevant incident URL.",
      "confidence": 0.78
    }
  ],
  "references": [
    {
      "uri": "akb://acme/coll/specs/doc/oauth-refresh.md",
      "title": "OAuth refresh spec",
      "reasoning": "Issue implements behavior defined in this spec.",
      "confidence": 0.8
    }
  ]
}
${authoringLanguageDirective(authoringLanguage)}`;
}

/**
 * Build the user prompt for an enrichment request.
 *
 * Ported from Tauri-era `build_enrichment_user_prompt(req)` (commit e554ed3).
 */
export function buildEnrichmentUserPrompt(
  req: EnrichmentUserPromptRequest,
): string {
  let prompt = `Issue ID: ${req.issueId}\n`;
  prompt += req.repoContext
    ? `Monitored Repository: ${req.repoContext.owner}/${req.repoContext.repo}\n\n`
    : "Monitored Repository: (unavailable)\n\n";
  prompt += `Current Draft Fields:\n${JSON.stringify(req.draft, null, 2)}\n\n`;

  prompt += "Vault Label Context (reference only; new labels are allowed):\n";
  if (req.context.labels.length === 0) {
    prompt += "  (none)\n";
  } else {
    for (const label of req.context.labels) {
      prompt += `  - ${label.name} | issues:${label.issue_count} | templates:${label.template_count}\n`;
    }
  }

  const peopleFields = [
    req.draft.fields.assigned_to
      ? `assigned_to:${req.draft.fields.assigned_to}`
      : "",
    req.draft.fields.requester ? `requester:${req.draft.fields.requester}` : "",
    req.draft.fields.reporter ? `reporter:${req.draft.fields.reporter}` : "",
  ].filter(Boolean);

  prompt += "\nCurrent People Fields:\n";
  if (peopleFields.length === 0) {
    prompt += "  (none)\n";
  } else {
    for (const field of peopleFields) {
      prompt += `  - ${field}\n`;
    }
  }

  prompt += `\n${formatTemplateCatalog(req.context.templates)}`;

  prompt += `\n${formatPlanningContextForPrompt(req.context.planningCatalog, {
    heading: "Planning Context:\n",
    unavailableHeading: "Planning Context: (unavailable)\n",
    noneHeading: "Planning Context: (none)\n",
  })}`;

  prompt +=
    "\nAnalyze this draft and suggest helpful field-level improvements. Return only the JSON object.";
  return prompt;
}

export function buildEnrichmentRepairSystemPrompt(): string {
  return `You repair invalid AI enrichment output into valid JSON.
Return ONLY a JSON object with this exact shape:
{
  "suggestions": [],
  "references": []
}

If the invalid response contains usable field-level suggestions, convert them into the same "suggestions" array schema from the enrichment prompt.
If it contains akb document references (objects with a "uri" akb document uri plus "reasoning" and "confidence"), preserve them in the "references" array.
If it only contains narration, tool-use announcements, uncertainty, or nothing actionable, return {"suggestions":[],"references":[]}.
Never include markdown, commentary, or text outside the JSON object.`;
}

export function buildEnrichmentRepairPrompt({
  originalPrompt,
  invalidResponse,
}: {
  originalPrompt: string;
  invalidResponse: string;
}): string {
  return `The previous enrichment response was not valid JSON.

Original enrichment prompt:
${originalPrompt}

Invalid response:
${invalidResponse}

Repair it now. Return only the JSON object.`;
}
