import { ZodError } from "zod";
import { NotFoundError, SchemaValidationError } from "../../../errors";
import {
  type ActivitySuggestion,
  ActivitySuggestionSchema,
  ActivitySuggestionStatusSchema,
  type ActivitySuggestionsResult,
} from "../../../schemas/activity/suggestion";
import {
  ACTIVITY_INBOX_COLLECTION,
  type AkbAdapter,
  type AkbSqlResponse,
  type DocumentResponse,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  activitySuggestionPathFor,
  decodeSettingsValue,
  deleteDocumentQuietly,
  ensureDocumentPutResponse,
  ensureDocumentResponse,
  isMissingTableError,
  quoteIdent,
  quoteJson,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import type {
  ListActivitySuggestionsParams,
  ReadActivitySuggestionParams,
  ReadActivitySuggestionResult,
  UpdateActivitySuggestionParams,
  UpdateActivitySuggestionStatusParams,
  WriteActivitySuggestionParams,
  WriteActivitySuggestionResult,
} from "../core/types";

function activitySuggestionDocumentTitle(
  suggestion: ActivitySuggestion,
): string {
  return suggestion.id;
}

function activitySuggestionDocumentSummary(
  suggestion: ActivitySuggestion,
): string {
  return suggestion.kind === "draft"
    ? suggestion.proposal.create.fields.title
    : suggestion.rationale;
}

function composeActivitySuggestionContent(body: string): string {
  const trimmedBody = body.replace(/\s+$/, "");
  return trimmedBody.length === 0 ? "" : `${trimmedBody}\n`;
}

function activitySuggestionDocumentBody(
  suggestion: ActivitySuggestion,
): string {
  if (suggestion.kind === "draft") {
    return composeActivitySuggestionContent(suggestion.proposal.create.content);
  }
  return composeActivitySuggestionContent(suggestion.rationale);
}

function activitySuggestionTags(suggestion: ActivitySuggestion): string[] {
  return [
    "reef-activity-suggestion",
    suggestion.kind === "draft" ? "reef-ai-draft" : "reef-ai-status-change",
  ];
}

function activitySource(suggestion: ActivitySuggestion): {
  source_type: string;
  source_ref: string;
  actor: string;
} {
  if (suggestion.kind === "draft") {
    return {
      source_type: suggestion.provenance.type,
      source_ref: suggestion.provenance.ref,
      actor: suggestion.provenance.actor,
    };
  }
  const first = suggestion.evidence[0];
  return {
    source_type: first?.type ?? "commit",
    source_ref: first?.ref ?? "",
    actor: first?.actor ?? "",
  };
}

function activitySuggestionIssueId(
  suggestion: ActivitySuggestion,
): string | undefined {
  return suggestion.kind === "status_change"
    ? suggestion.proposal.update.issue_id
    : undefined;
}

function activitySuggestionTitle(
  suggestion: ActivitySuggestion,
): string | undefined {
  return suggestion.kind === "draft"
    ? suggestion.proposal.create.fields.title
    : suggestion.issue_title;
}

function activitySuggestionSummary(
  suggestion: ActivitySuggestion,
): string | undefined {
  return suggestion.kind === "draft"
    ? suggestion.proposal.create.content.slice(0, 500)
    : suggestion.rationale;
}

function buildActivitySuggestionPutBody(
  vault: string,
  suggestion: ActivitySuggestion,
): Record<string, unknown> {
  return {
    vault,
    collection: ACTIVITY_INBOX_COLLECTION,
    title: activitySuggestionDocumentTitle(suggestion),
    content: activitySuggestionDocumentBody(suggestion),
    type: "reference",
    summary: activitySuggestionDocumentSummary(suggestion),
    tags: activitySuggestionTags(suggestion),
  };
}

function buildActivitySuggestionPatchBody(
  suggestion: ActivitySuggestion,
): Record<string, unknown> {
  return {
    title: activitySuggestionDocumentTitle(suggestion),
    content: activitySuggestionDocumentBody(suggestion),
    type: "reference",
    summary: activitySuggestionDocumentSummary(suggestion),
    tags: activitySuggestionTags(suggestion),
  };
}

function activitySuggestionRowFields(
  suggestion: ActivitySuggestion,
): Array<[string, string]> {
  const source = activitySource(suggestion);
  return [
    ["kind", quoteText(suggestion.kind, "suggestion kind")],
    ["status", quoteText(suggestion.status, "suggestion status")],
    [
      "fingerprint",
      quoteText(suggestion.fingerprint, "suggestion fingerprint"),
    ],
    ["repo", quoteText(suggestion.repo, "suggestion repo")],
    [
      "issue_id",
      quoteTextOrNull(
        activitySuggestionIssueId(suggestion),
        "suggestion issue_id",
      ),
    ],
    [
      "title",
      quoteTextOrNull(activitySuggestionTitle(suggestion), "suggestion title"),
    ],
    [
      "summary",
      quoteTextOrNull(
        activitySuggestionSummary(suggestion),
        "suggestion summary",
      ),
    ],
    ["source_type", quoteText(source.source_type, "suggestion source_type")],
    ["source_ref", quoteText(source.source_ref, "suggestion source_ref")],
    ["actor", quoteText(source.actor, "suggestion actor")],
    [
      "detected_at",
      quoteText(suggestion.detected_at, "suggestion detected_at"),
    ],
    [
      "reviewed_at",
      quoteTextOrNull(suggestion.reviewed_at, "suggestion reviewed_at"),
    ],
    [
      "reviewed_by",
      quoteTextOrNull(suggestion.reviewed_by, "suggestion reviewed_by"),
    ],
    ["meta", quoteJson(suggestion)],
  ];
}

function activitySuggestionRowAssignments(
  suggestion: ActivitySuggestion,
): string {
  return activitySuggestionRowFields(suggestion)
    .map(([column, value]) => `${quoteIdent(column)} = ${value}`)
    .join(", ");
}

function insertActivitySuggestionRow(
  adapter: AkbAdapter,
  vault: string,
  suggestion: ActivitySuggestion,
  documentUri: string,
): Promise<AkbSqlResponse> {
  const fields = activitySuggestionRowFields(suggestion);
  const columns = [
    "document_uri",
    "suggestion_id",
    ...fields.map(([column]) => column),
  ]
    .map(quoteIdent)
    .join(", ");
  const values = [
    quoteText(documentUri, "document_uri"),
    quoteText(suggestion.id, "suggestion_id"),
    ...fields.map(([, value]) => value),
  ].join(", ");
  return runSql(
    adapter,
    vault,
    `INSERT INTO ${tableRef(REEF_ACTIVITY_SUGGESTIONS_TABLE)} (${columns}) VALUES (${values})`,
  );
}

function rowToActivitySuggestion(
  row: Record<string, unknown>,
): ActivitySuggestion {
  const meta = decodeSettingsValue(row.meta);
  if (!meta || typeof meta !== "object") {
    throw new SchemaValidationError({
      issues: ["Activity suggestion row missing meta json"],
    });
  }
  const candidate = {
    ...(meta as Record<string, unknown>),
    id: row.suggestion_id,
    kind: row.kind,
    status: row.status,
    fingerprint: row.fingerprint,
    repo: row.repo,
    detected_at: row.detected_at,
    reviewed_at: row.reviewed_at ?? undefined,
    reviewed_by: row.reviewed_by ?? undefined,
  };
  try {
    return ActivitySuggestionSchema.parse(candidate);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw err;
  }
}

async function selectActivitySuggestionRows(
  adapter: AkbAdapter,
  vault: string,
  where?: string,
): Promise<Record<string, unknown>[]> {
  const sql = `SELECT * FROM ${tableRef(REEF_ACTIVITY_SUGGESTIONS_TABLE)}${
    where ? ` WHERE ${where}` : ""
  }`;
  const res = await runSql(adapter, vault, sql);
  return res.kind === "table_query" ? res.items : [];
}

async function fetchActivitySuggestionDocument(
  adapter: AkbAdapter,
  vault: string,
  id: string,
): Promise<DocumentResponse | null> {
  try {
    const payload = await adapter.request(
      `/api/v1/documents/${encodeURIComponent(vault)}/${activitySuggestionPathFor(
        id,
      )}`,
      { resource: `activity suggestion ${id}` },
    );
    return ensureDocumentResponse(payload);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export function composeActivitySuggestionDocumentBody(
  suggestion: ActivitySuggestion,
): string {
  return activitySuggestionDocumentBody(suggestion);
}

export async function writeActivitySuggestion(
  params: WriteActivitySuggestionParams,
): Promise<WriteActivitySuggestionResult> {
  const { adapter, vault, suggestion } = params;
  return withSpan(
    "akb.write_activity_suggestion",
    { vault, id: suggestion.id },
    async (span) => {
      const existing = await fetchActivitySuggestionDocument(
        adapter,
        vault,
        suggestion.id,
      );
      if (existing) {
        span.setAttribute("file_exists", true);
        const payload = await adapter.request(
          `/api/v1/documents/${encodeURIComponent(vault)}/${activitySuggestionPathFor(
            suggestion.id,
          )}`,
          {
            method: "PATCH",
            body: buildActivitySuggestionPatchBody(suggestion),
            resource: `activity suggestion ${suggestion.id}`,
          },
        );
        const put = ensureDocumentPutResponse(payload);
        await runSql(
          adapter,
          vault,
          `UPDATE ${tableRef(
            REEF_ACTIVITY_SUGGESTIONS_TABLE,
          )} SET document_uri = ${quoteText(put.uri, "document_uri")}, ${activitySuggestionRowAssignments(
            suggestion,
          )} WHERE suggestion_id = ${quoteText(
            suggestion.id,
            "suggestion_id",
          )}`,
        );
        return { path: put.path, commit_hash: put.commit_hash };
      }

      span.setAttribute("file_exists", false);
      const payload = await adapter.request("/api/v1/documents", {
        method: "POST",
        body: buildActivitySuggestionPutBody(vault, suggestion),
        resource: `activity suggestion ${suggestion.id}`,
      });
      const put = ensureDocumentPutResponse(payload);
      try {
        await insertActivitySuggestionRow(adapter, vault, suggestion, put.uri);
      } catch (err) {
        await deleteDocumentQuietly(adapter, vault, put.path);
        throw err;
      }
      return { path: put.path, commit_hash: put.commit_hash };
    },
  );
}

export async function listActivitySuggestions(
  params: ListActivitySuggestionsParams,
): Promise<ActivitySuggestionsResult> {
  const { adapter, vault, status } = params;
  return withSpan("akb.list_activity_suggestions", { vault }, async (span) => {
    let rows: Record<string, unknown>[];
    try {
      rows = await selectActivitySuggestionRows(
        adapter,
        vault,
        status
          ? `status = ${quoteText(
              ActivitySuggestionStatusSchema.parse(status),
              "suggestion status",
            )}`
          : undefined,
      );
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("table_exists", false);
        return { suggestions: [] };
      }
      throw err;
    }
    const suggestions: ActivitySuggestion[] = [];
    for (const row of rows) {
      try {
        suggestions.push(rowToActivitySuggestion(row));
      } catch (err) {
        span.addEvent("activity_suggestion_row_skipped", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    span.setAttribute("suggestion_count", suggestions.length);
    return { suggestions };
  });
}

export async function readActivitySuggestion(
  params: ReadActivitySuggestionParams,
): Promise<ReadActivitySuggestionResult> {
  const { adapter, vault, id } = params;
  return withSpan("akb.read_activity_suggestion", { vault, id }, async () => {
    const rows = await selectActivitySuggestionRows(
      adapter,
      vault,
      `suggestion_id = ${quoteText(id, "suggestion_id")}`,
    );
    const row = rows[0];
    if (!row)
      throw new NotFoundError({ resource: `activity suggestion ${id}` });
    return { suggestion: rowToActivitySuggestion(row) };
  });
}

export async function updateActivitySuggestion(
  params: UpdateActivitySuggestionParams,
): Promise<ReadActivitySuggestionResult> {
  const { adapter, vault, id, patch } = params;
  const { suggestion } = await readActivitySuggestion({ adapter, vault, id });
  const next = ActivitySuggestionSchema.parse(
    suggestion.kind === "draft" && "create" in patch
      ? {
          ...suggestion,
          proposal: { operation: "create", create: patch.create },
        }
      : suggestion.kind === "status_change" && "update" in patch
        ? {
            ...suggestion,
            proposal: { operation: "update", update: patch.update },
            ...(patch.rationale !== undefined
              ? { rationale: patch.rationale }
              : {}),
          }
        : suggestion,
  );
  await writeActivitySuggestion({ adapter, vault, suggestion: next });
  return { suggestion: next };
}

export async function updateActivitySuggestionStatus(
  params: UpdateActivitySuggestionStatusParams,
): Promise<ReadActivitySuggestionResult> {
  const {
    adapter,
    vault,
    id,
    status,
    reviewed_by,
    reviewed_at = new Date().toISOString(),
    approved_issue_id,
  } = params;
  const { suggestion } = await readActivitySuggestion({ adapter, vault, id });
  const next = ActivitySuggestionSchema.parse({
    ...suggestion,
    status,
    reviewed_at,
    reviewed_by: reviewed_by ?? suggestion.reviewed_by ?? "reef-web",
    ...(suggestion.kind === "draft" && approved_issue_id
      ? { approved_issue_id }
      : {}),
  });
  await writeActivitySuggestion({ adapter, vault, suggestion: next });
  return { suggestion: next };
}
