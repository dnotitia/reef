import type {
  ChatDocumentCitation,
  ChatToolStep,
} from "@/features/ai/chat/chatTypes";
import { REEF_ID_PATTERN } from "@/lib/markdown/remarkReefMentions";

/**
 * Pure projections of chat tool state into the transparency surface (REEF-361
 * AC2/AC4): a stable i18n label key per tool, a one-line argument summary, a
 * result count, and the document citations / issue ids a turn's tools surfaced.
 * These never expose the full result payload — only the counts and the
 * caller-supplied query.
 */

/** i18n key segments the `ai.chatSteps.tool.*` catalog carries a label pair for. */
export type ToolLabelKey =
  | "searchIssues"
  | "searchDocuments"
  | "readIssue"
  | "readTemplate"
  | "listAssignees"
  | "searchCode"
  | "devReadFile"
  | "generic";

const TOOL_LABEL_KEYS: Record<string, ToolLabelKey> = {
  search_issues: "searchIssues",
  search_documents: "searchDocuments",
  read_issue: "readIssue",
  read_template: "readTemplate",
  list_assignees: "listAssignees",
  search_code: "searchCode",
  dev_read_file: "devReadFile",
};

/** Stable i18n key segment for a tool name; `generic` for anything unmapped. */
export function toolLabelKey(toolName: string): ToolLabelKey {
  return TOOL_LABEL_KEYS[toolName] ?? "generic";
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayField(
  record: Record<string, unknown> | null,
  key: string,
): unknown[] | null {
  const value = record?.[key];
  return Array.isArray(value) ? value : null;
}

/**
 * A short, human-meaningful summary of a tool call's arguments — the query
 * string, the issue id, the file path — or null when there is nothing worth
 * showing. This is the model/user-supplied argument, not a UI label.
 */
export function summarizeToolInput(step: ChatToolStep): string | null {
  const input = step.input;
  if (!input) return null;
  switch (step.toolName) {
    case "search_issues":
    case "search_documents":
    case "search_code":
      return stringField(input, "query");
    case "read_issue":
      return stringField(input, "id");
    case "read_template":
      return stringField(input, "name") ?? stringField(input, "issue_type");
    case "dev_read_file":
      return stringField(input, "path");
    default: {
      // Fall back to the first short string argument so an unknown tool still
      // shows something specific rather than nothing.
      for (const value of Object.values(input)) {
        if (typeof value === "string" && value.trim() && value.length <= 120) {
          return value.trim();
        }
      }
      return null;
    }
  }
}

/** Number of results a completed tool returned, or null when not countable. */
export function toolResultCount(step: ChatToolStep): number | null {
  if (step.status !== "completed") return null;
  const output = step.output;
  if (!output) return null;
  switch (step.toolName) {
    case "search_issues":
      return arrayField(output, "issues")?.length ?? null;
    case "search_documents":
      return arrayField(output, "documents")?.length ?? null;
    case "list_assignees":
      return arrayField(output, "assignees")?.length ?? null;
    case "search_code":
      return arrayField(output, "results")?.length ?? null;
    default:
      return null;
  }
}

/**
 * Deduped document citations from a turn's completed `search_documents` calls,
 * in first-seen order (AC4). The card renderer reads these instead of parsing
 * `akb://` URIs out of the answer prose.
 */
export function extractChatCitations(
  steps: ChatToolStep[],
): ChatDocumentCitation[] {
  const seen = new Set<string>();
  const citations: ChatDocumentCitation[] = [];
  for (const step of steps) {
    if (step.toolName !== "search_documents" || step.status !== "completed") {
      continue;
    }
    for (const doc of arrayField(step.output, "documents") ?? []) {
      if (typeof doc !== "object" || doc === null) continue;
      const record = doc as Record<string, unknown>;
      const uri = record.uri;
      if (typeof uri !== "string" || !uri || seen.has(uri)) continue;
      seen.add(uri);
      citations.push({
        uri,
        title: typeof record.title === "string" ? record.title : null,
        collection:
          typeof record.collection === "string" ? record.collection : null,
        docType: typeof record.doc_type === "string" ? record.doc_type : null,
      });
    }
  }
  return citations;
}

/**
 * Issue ids a turn's own tools proved real — `search_issues` hits and the
 * `read_issue` target. Unioned with the loaded issue list so the answer can
 * deep-link the very issues it grounded on (AC3).
 */
export function collectReferencedIssueIds(steps: ChatToolStep[]): string[] {
  const ids = new Set<string>();
  const addId = (value: unknown) => {
    if (typeof value !== "string") return;
    const match = value.toUpperCase().match(REEF_ID_PATTERN);
    if (match) for (const id of match) ids.add(id);
  };
  for (const step of steps) {
    if (step.status !== "completed") continue;
    if (step.toolName === "search_issues") {
      for (const issue of arrayField(step.output, "issues") ?? []) {
        if (issue && typeof issue === "object") {
          addId((issue as Record<string, unknown>).id);
        }
      }
    } else if (step.toolName === "read_issue") {
      const issue = step.output?.issue;
      if (issue && typeof issue === "object") {
        addId((issue as Record<string, unknown>).id);
      }
    }
  }
  return [...ids];
}
