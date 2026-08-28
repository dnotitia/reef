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
import { deepEqual } from "../../../utils/deepEqual";
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
  SqlParameterBuilder,
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

interface AttachmentSqlInput {
  reefId: string;
  fileUri?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  author: string;
  source: IssueAttachmentSource;
  inline: boolean;
  originalJiraAttachmentId: string | null;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

function attachmentSqlFields(
  params: SqlParameterBuilder,
  input: AttachmentSqlInput,
): Array<[string, string]> {
  return [
    ["reef_id", params.add(input.reefId, "attachment reef_id")],
    ["file_uri", params.add(input.fileUri, "attachment file_uri")],
    ["filename", params.add(input.filename, "attachment filename")],
    ["mime_type", params.add(input.mimeType, "attachment mime_type")],
    ["size_bytes", params.add(input.sizeBytes, "attachment size_bytes")],
    ["author", params.add(input.author, "attachment author")],
    ["source", params.add(input.source, "attachment source")],
    ["inline", params.add(input.inline, "attachment inline")],
    [
      "original_jira_attachment_id",
      params.add(
        input.originalJiraAttachmentId,
        "attachment original_jira_attachment_id",
      ),
    ],
    [
      "meta",
      params.addJson(
        { ...(input.meta ?? {}), created_at: input.createdAt },
        "attachment meta",
        "jsonb",
      ),
    ],
  ];
}

function jiraIdempotencyKey(
  meta: Record<string, unknown> | null,
): string | null {
  const value = meta?.jira_idempotency_key;
  return typeof value === "string" && value ? value : null;
}

/** Validate every attachment value before the first AKB request. */
function validateAttachmentSqlInput(input: AttachmentSqlInput): void {
  const params = new SqlParameterBuilder();
  attachmentSqlFields(params, input);
  const idempotencyKey = jiraIdempotencyKey(input.meta);
  if (idempotencyKey) {
    params.add(idempotencyKey, "attachment idempotency key");
  }
}

async function assertIssueExists(
  adapter: AkbAdapter,
  vault: string,
  reefId: string,
): Promise<void> {
  const params = new SqlParameterBuilder();
  const reefIdParam = params.add(reefId, "attachment reef_id");
  const parent = await runSql(
    adapter,
    vault,
    `SELECT reef_id FROM ${tableRef(
      REEF_ISSUES_TABLE,
    )} WHERE reef_id = ${reefIdParam} LIMIT 1`,
    params.params,
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
  const sqlParams = new SqlParameterBuilder();
  const inline = input.inline ?? false;
  const sqlInput: AttachmentSqlInput = {
    reefId: input.reef_id,
    fileUri: input.file_uri,
    filename: input.filename,
    mimeType: input.mime_type,
    sizeBytes: input.size_bytes,
    author: input.author,
    source: input.source,
    inline,
    originalJiraAttachmentId: input.original_jira_attachment_id ?? null,
    createdAt: input.created_at,
    meta: input.meta ?? null,
  };
  const fields = attachmentSqlFields(sqlParams, sqlInput);
  const columns = fields.map(([column]) => quoteIdent(column)).join(", ");
  const values = fields.map(([, value]) => value).join(", ");
  const idempotencyKey = jiraIdempotencyKey(sqlInput.meta);
  const idempotencyKeyParam = !idempotencyKey
    ? null
    : sqlParams.add(idempotencyKey, "attachment idempotency key");
  const claimCtes = idempotencyKeyParam
    ? `claim_lock AS (SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKeyParam}, 0))), existing AS (SELECT attachment.* FROM ${tableRef(
        REEF_ATTACHMENTS_TABLE,
      )} attachment CROSS JOIN claim_lock WHERE attachment.meta->>'jira_idempotency_key' = ${idempotencyKeyParam} LIMIT 1), `
    : "";
  const insertSource = idempotencyKeyParam
    ? `SELECT ${values} FROM claim_lock WHERE NOT EXISTS (SELECT 1 FROM existing)`
    : `VALUES (${values})`;
  const resultSelection = idempotencyKeyParam
    ? "SELECT * FROM ins UNION ALL SELECT * FROM existing LIMIT 1"
    : "SELECT * FROM ins";
  const res = await runSql(
    adapter,
    vault,
    `WITH ${claimCtes}ins AS (INSERT INTO ${tableRef(
      REEF_ATTACHMENTS_TABLE,
    )} (${columns}) ${insertSource} RETURNING *) ${resultSelection}`,
    sqlParams.params,
  );
  const row = res.kind === "table_query" ? res.items[0] : undefined;
  if (!row) {
    throw new SchemaValidationError({
      issues: ["attachment row not returned after insert"],
    });
  }
  return rowToAttachment(row);
}

async function attachmentByIdempotencyKey(
  adapter: AkbAdapter,
  vault: string,
  key: string,
): Promise<IssueAttachment | null> {
  const params = new SqlParameterBuilder();
  const keyParam = params.add(key, "attachment idempotency key");
  const result = await runSql(
    adapter,
    vault,
    `SELECT * FROM ${tableRef(
      REEF_ATTACHMENTS_TABLE,
    )} WHERE meta->>'jira_idempotency_key' = ${keyParam} LIMIT 2`,
    params.params,
  );
  const rows = result.kind === "table_query" ? result.items : [];
  if (rows.length > 1) {
    throw new ConflictError({ path: `attachment:${key}` });
  }
  return rows[0] ? rowToAttachment(rows[0]) : null;
}

async function isCompatibleAttachment(
  adapter: AkbAdapter,
  vault: string,
  attachment: IssueAttachment,
  expected: {
    reefId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    author: string;
    source: IssueAttachmentSource;
    inline: boolean;
    originalJiraAttachmentId: string | null;
    meta: Record<string, unknown> | null;
    bytes: Uint8Array;
  },
): Promise<boolean> {
  const existing = await downloadAkbFile(adapter, vault, attachment.file_uri);
  const existingBytes = new Uint8Array(existing.body);
  return (
    attachment.reef_id === expected.reefId &&
    attachment.filename.normalize("NFC") ===
      expected.filename.normalize("NFC") &&
    attachment.mime_type === expected.mimeType &&
    attachment.size_bytes === expected.sizeBytes &&
    attachment.author === expected.author &&
    attachment.source === expected.source &&
    attachment.inline === expected.inline &&
    attachment.original_jira_attachment_id ===
      expected.originalJiraAttachmentId &&
    deepEqual(attachment.meta, expected.meta) &&
    existingBytes.length === expected.bytes.length &&
    existingBytes.every((value, index) => value === expected.bytes[index])
  );
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
        const params = new SqlParameterBuilder();
        const reefIdParam = params.add(reefId, "attachment reef_id");
        const res = await runSql(
          adapter,
          vault,
          `SELECT * FROM ${tableRef(
            REEF_ATTACHMENTS_TABLE,
          )} WHERE reef_id = ${reefIdParam} ORDER BY COALESCE(meta->>'created_at', created_at::text) ASC, id ASC`,
          params.params,
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
      const createdAt = params.createdAt ?? new Date().toISOString();
      const inline = params.inline ?? false;
      const originalJiraAttachmentId = params.originalJiraAttachmentId ?? null;
      validateAttachmentSqlInput({
        reefId,
        filename,
        mimeType,
        sizeBytes: bytes.byteLength,
        author,
        source,
        inline,
        originalJiraAttachmentId,
        createdAt,
        meta: params.meta ?? null,
      });
      await ensureReefTables({ adapter, vault });
      await assertIssueExists(adapter, vault, reefId);
      const idempotencyKey = jiraIdempotencyKey(params.meta ?? null);
      if (idempotencyKey) {
        const existing = await attachmentByIdempotencyKey(
          adapter,
          vault,
          idempotencyKey,
        );
        if (existing) {
          const compatible = await isCompatibleAttachment(
            adapter,
            vault,
            existing,
            {
              reefId,
              filename,
              mimeType,
              sizeBytes: bytes.byteLength,
              author,
              source,
              inline,
              originalJiraAttachmentId,
              meta: params.meta ?? null,
              bytes,
            },
          );
          if (!compatible) {
            throw new ConflictError({ path: existing.file_uri });
          }
          return existing;
        }
      }
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
        created_at: createdAt,
        source,
        inline,
        original_jira_attachment_id: originalJiraAttachmentId,
        meta: params.meta ?? null,
      });
      if (attachment.file_uri !== uploaded.uri) {
        try {
          const compatible = await isCompatibleAttachment(
            adapter,
            vault,
            attachment,
            {
              reefId,
              filename: uploaded.filename,
              mimeType: uploaded.mimeType,
              sizeBytes: uploaded.sizeBytes,
              author,
              source,
              inline,
              originalJiraAttachmentId,
              meta: params.meta ?? null,
              bytes,
            },
          );
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
      validateAttachmentSqlInput({
        reefId: input.reef_id,
        fileUri: input.file_uri,
        filename: input.filename,
        mimeType: input.mime_type,
        sizeBytes: input.size_bytes,
        author: input.author,
        source: input.source,
        inline: input.inline ?? false,
        originalJiraAttachmentId: input.original_jira_attachment_id ?? null,
        createdAt: input.created_at,
        meta: input.meta ?? null,
      });
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
      const sqlParams = new SqlParameterBuilder();
      const reefIdParam = sqlParams.add(reefId, "attachment reef_id");
      const attachmentIdParam = sqlParams.add(attachmentId, "attachment id");
      const res = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(
          REEF_ATTACHMENTS_TABLE,
        )} WHERE reef_id = ${reefIdParam} AND id = ${attachmentIdParam} LIMIT 1`,
        sqlParams.params,
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
      const sqlParams = new SqlParameterBuilder();
      const reefIdParam = sqlParams.add(reefId, "attachment reef_id");
      const fileUriParam = sqlParams.add(fileUri, "attachment file_uri");
      const res = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(
          REEF_ATTACHMENTS_TABLE,
        )} WHERE reef_id = ${reefIdParam} AND file_uri = ${fileUriParam} LIMIT 1`,
        sqlParams.params,
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
