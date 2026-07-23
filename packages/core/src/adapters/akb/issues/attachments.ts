import { isDeepStrictEqual } from "node:util";
import { ZodError } from "zod";
import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import { ACTIVITY_EVENT_ATTACHMENT_ADDED } from "../../../schemas/issues/activity";
import {
  type IssueAttachment,
  type IssueAttachmentCreateInput,
  IssueAttachmentSchema,
  type IssueAttachmentSource,
} from "../../../schemas/issues/attachment";
import {
  type AkbAdapter,
  REEF_ATTACHMENTS_TABLE,
  REEF_ISSUES_TABLE,
  decodeSettingsValue,
  deleteAkbFile,
  downloadAkbFile,
  ensureReefTables,
  isMissingTableError,
  quoteIdent,
  quoteJson,
  quoteNumberOrNull,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
  uploadAkbFile,
  withSpan,
} from "../core/shared";
import { appendActivityEvents } from "./activity";

export interface UploadIssueAttachmentParams {
  adapter: AkbAdapter;
  vault: string;
  reefId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  author: string;
  source: IssueAttachmentSource;
  inline?: boolean;
  createdAt?: string;
  originalJiraAttachmentId?: string;
  meta?: Record<string, unknown>;
}

export interface DownloadIssueAttachmentParams {
  adapter: AkbAdapter;
  vault: string;
  reefId: string;
  attachmentId: string;
}

export interface DownloadIssueAttachmentByFileUriParams {
  adapter: AkbAdapter;
  vault: string;
  reefId: string;
  fileUri: string;
}

export interface DownloadIssueAttachmentResult {
  attachment: IssueAttachment;
  body: ArrayBuffer;
  contentType: string;
  filename: string | null;
  sizeBytes: number | null;
}

function rowToAttachment(row: Record<string, unknown>): IssueAttachment {
  try {
    const decodedMeta = decodeSettingsValue(row.meta);
    const storedMeta =
      decodedMeta &&
      typeof decodedMeta === "object" &&
      !Array.isArray(decodedMeta)
        ? (decodedMeta as Record<string, unknown>)
        : null;
    const { created_at: semanticCreatedAt, ...publicMeta } = storedMeta ?? {};
    return IssueAttachmentSchema.parse({
      id: row.id,
      reef_id: row.reef_id,
      file_uri: row.file_uri,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: Number(row.size_bytes),
      author: row.author,
      created_at:
        typeof semanticCreatedAt === "string"
          ? semanticCreatedAt
          : row.created_at,
      source: row.source,
      inline: row.inline === true || row.inline === "true",
      original_jira_attachment_id: row.original_jira_attachment_id ?? null,
      meta: Object.keys(publicMeta).length > 0 ? publicMeta : null,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw err;
  }
}

function attachmentColumns(): string[] {
  return [
    "id",
    "reef_id",
    "file_uri",
    "filename",
    "mime_type",
    "size_bytes",
    "author",
    "created_at",
    "source",
    "inline",
    "original_jira_attachment_id",
    "meta",
  ];
}

async function assertIssueExists(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
): Promise<void> {
  const parent = await runSql(
    adapter,
    vault,
    `SELECT reef_id FROM ${tableRef(REEF_ISSUES_TABLE)} WHERE reef_id = ${quoteText(
      reefId,
      "attachment reef_id",
    )} LIMIT 1`,
  );
  if (parent.kind !== "table_query" || parent.items.length === 0) {
    throw new NotFoundError({ resource: `issue ${reefId}` });
  }
}

async function insertAttachmentRow(
  adapter: AkbAdapter,
  vault: string,
  input: IssueAttachmentCreateInput,
): Promise<IssueAttachment> {
  const persistedMeta = { ...(input.meta ?? {}), created_at: input.created_at };
  const fields: Array<[string, string]> = [
    ["reef_id", quoteText(input.reef_id, "attachment reef_id")],
    ["file_uri", quoteText(input.file_uri, "attachment file_uri")],
    ["filename", quoteText(input.filename, "attachment filename")],
    ["mime_type", quoteText(input.mime_type, "attachment mime_type")],
    ["size_bytes", quoteNumberOrNull(input.size_bytes)],
    ["author", quoteText(input.author, "attachment author")],
    ["source", quoteText(input.source, "attachment source")],
    ["inline", input.inline ? "TRUE" : "FALSE"],
    [
      "original_jira_attachment_id",
      quoteTextOrNull(
        input.original_jira_attachment_id,
        "attachment original_jira_attachment_id",
      ),
    ],
    ["meta", quoteJson(persistedMeta)],
  ];
  const columns = fields
    .map(([column]) => column)
    .map(quoteIdent)
    .join(", ");
  const values = fields.map(([, value]) => value).join(", ");
  const idempotencyKey =
    typeof input.meta?.jira_idempotency_key === "string"
      ? input.meta.jira_idempotency_key
      : null;
  const claimCtes = idempotencyKey
    ? `claim_lock AS (SELECT pg_advisory_xact_lock(hashtextextended(${quoteText(
        idempotencyKey,
        "attachment idempotency key",
      )}, 0))), existing AS (SELECT attachment.* FROM ${tableRef(
        REEF_ATTACHMENTS_TABLE,
      )} attachment CROSS JOIN claim_lock WHERE attachment.meta->>'jira_idempotency_key' = ${quoteText(
        idempotencyKey,
        "attachment idempotency key",
      )} LIMIT 1), `
    : "";
  const insertSource = idempotencyKey
    ? `SELECT ${values} FROM claim_lock WHERE NOT EXISTS (SELECT 1 FROM existing)`
    : `VALUES (${values})`;
  const resultSelection = idempotencyKey
    ? "SELECT * FROM ins UNION ALL SELECT * FROM existing LIMIT 1"
    : "SELECT * FROM ins";
  const res = await runSql(
    adapter,
    vault,
    `WITH ${claimCtes}ins AS (INSERT INTO ${tableRef(
      REEF_ATTACHMENTS_TABLE,
    )} (${columns}) ${insertSource} RETURNING *) ${resultSelection}`,
  );
  const row = res.kind === "table_query" ? res.items[0] : undefined;
  if (!row) {
    throw new SchemaValidationError({
      issues: ["attachment row not returned after insert"],
    });
  }
  return rowToAttachment(row);
}

async function appendAttachmentAddedEvent(
  adapter: AkbAdapter,
  vault: string,
  attachment: IssueAttachment,
): Promise<void> {
  await appendActivityEvents(adapter, vault, [
    {
      reefId: attachment.reef_id,
      at: attachment.created_at,
      actor: attachment.author,
      source: null,
      eventType: ACTIVITY_EVENT_ATTACHMENT_ADDED,
      payload: {
        attachment_id: attachment.id,
        file_uri: attachment.file_uri,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
      },
    },
  ]);
}

export async function listIssueAttachments(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
): Promise<IssueAttachment[]> {
  return withSpan(
    "akb.list_issue_attachments",
    { vault, reef_id: reefId },
    async (span) => {
      try {
        const res = await runSql(
          adapter,
          vault,
          `SELECT * FROM ${tableRef(REEF_ATTACHMENTS_TABLE)} WHERE reef_id = ${quoteText(
            reefId,
            "attachment reef_id",
          )} ORDER BY COALESCE(meta->>'created_at', created_at::text) ASC, id ASC`,
        );
        const rows = res.kind === "table_query" ? res.items : [];
        const attachments = rows.map(rowToAttachment);
        span.setAttribute("attachment_count", attachments.length);
        return attachments;
      } catch (err) {
        if (isMissingTableError(err)) {
          span.setAttribute("table_exists", false);
          return [];
        }
        throw err;
      }
    },
  );
}

export async function uploadIssueAttachment(
  params: UploadIssueAttachmentParams,
): Promise<IssueAttachment> {
  const { adapter, vault, reefId, filename, mimeType, bytes, author, source } =
    params;
  return withSpan(
    "akb.upload_issue_attachment",
    { vault, reef_id: reefId },
    async () => {
      await ensureReefTables({ adapter, vault });
      await assertIssueExists(adapter, vault, reefId);
      const uploaded = await uploadAkbFile({
        adapter,
        vault,
        filename,
        mimeType,
        bytes,
        collection: `issues/${reefId.toLowerCase()}/attachments`,
        description: `${reefId} attachment: ${filename}`,
      });
      const attachment = await insertAttachmentRow(adapter, vault, {
        reef_id: reefId,
        file_uri: uploaded.uri,
        filename: uploaded.filename,
        mime_type: uploaded.mimeType,
        size_bytes: uploaded.sizeBytes,
        author,
        created_at: params.createdAt ?? new Date().toISOString(),
        source,
        inline: params.inline ?? false,
        original_jira_attachment_id: params.originalJiraAttachmentId ?? null,
        meta: params.meta ?? null,
      });
      if (attachment.file_uri !== uploaded.uri) {
        try {
          const existing = await downloadAkbFile(
            adapter,
            vault,
            attachment.file_uri,
          );
          const existingBytes = new Uint8Array(existing.body);
          const compatible =
            attachment.reef_id === reefId &&
            attachment.filename === uploaded.filename &&
            attachment.mime_type === uploaded.mimeType &&
            attachment.size_bytes === uploaded.sizeBytes &&
            attachment.author === author &&
            attachment.source === source &&
            attachment.inline === (params.inline ?? false) &&
            attachment.original_jira_attachment_id ===
              (params.originalJiraAttachmentId ?? null) &&
            isDeepStrictEqual(attachment.meta, params.meta ?? null) &&
            existingBytes.length === bytes.length &&
            existingBytes.every((value, index) => value === bytes[index]);
          if (!compatible) {
            throw new ConflictError({ path: attachment.file_uri });
          }
        } finally {
          await deleteAkbFile(adapter, vault, uploaded.uri);
        }
      }
      await appendAttachmentAddedEvent(adapter, vault, attachment).catch(() => {
        // Best effort: the upload + row are the user-visible work; activity is
        // a timeline projection and can be repaired by a future scan/backfill.
      });
      return attachment;
    },
  );
}

export async function createIssueAttachmentRecord(
  adapter: AkbAdapter,
  vault: string,
  input: IssueAttachmentCreateInput,
): Promise<IssueAttachment> {
  return withSpan(
    "akb.create_issue_attachment_record",
    { vault, reef_id: input.reef_id },
    async () => {
      await ensureReefTables({ adapter, vault });
      await assertIssueExists(adapter, vault, input.reef_id);
      const attachment = await insertAttachmentRow(adapter, vault, input);
      await appendAttachmentAddedEvent(adapter, vault, attachment).catch(
        () => {},
      );
      return attachment;
    },
  );
}

export async function downloadIssueAttachment(
  params: DownloadIssueAttachmentParams,
): Promise<DownloadIssueAttachmentResult> {
  const { adapter, vault, reefId, attachmentId } = params;
  return withSpan(
    "akb.download_issue_attachment",
    { vault, reef_id: reefId },
    async () => {
      const res = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(REEF_ATTACHMENTS_TABLE)} WHERE reef_id = ${quoteText(
          reefId,
          "attachment reef_id",
        )} AND id = ${quoteText(attachmentId, "attachment id")} LIMIT 1`,
      );
      const row = res.kind === "table_query" ? res.items[0] : undefined;
      if (!row) {
        throw new NotFoundError({ resource: `attachment ${attachmentId}` });
      }
      const attachment = rowToAttachment(row);
      const file = await downloadAkbFile(adapter, vault, attachment.file_uri);
      return { attachment, ...file };
    },
  );
}

export async function downloadIssueAttachmentByFileUri(
  params: DownloadIssueAttachmentByFileUriParams,
): Promise<DownloadIssueAttachmentResult> {
  const { adapter, vault, reefId, fileUri } = params;
  return withSpan(
    "akb.download_issue_attachment_by_file_uri",
    { vault, reef_id: reefId },
    async () => {
      const res = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(REEF_ATTACHMENTS_TABLE)} WHERE reef_id = ${quoteText(
          reefId,
          "attachment reef_id",
        )} AND file_uri = ${quoteText(fileUri, "attachment file_uri")} LIMIT 1`,
      );
      const row = res.kind === "table_query" ? res.items[0] : undefined;
      if (!row) {
        throw new NotFoundError({ resource: `attachment file ${fileUri}` });
      }
      const attachment = rowToAttachment(row);
      const file = await downloadAkbFile(adapter, vault, attachment.file_uri);
      return { attachment, ...file };
    },
  );
}
