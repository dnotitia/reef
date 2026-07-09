import { ZodError } from "zod";
import { NotFoundError, SchemaValidationError } from "../../../errors";
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
    return IssueAttachmentSchema.parse({
      id: row.id,
      reef_id: row.reef_id,
      file_uri: row.file_uri,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: Number(row.size_bytes),
      author: row.author,
      created_at: row.created_at,
      source: row.source,
      inline: row.inline === true || row.inline === "true",
      original_jira_attachment_id: row.original_jira_attachment_id ?? null,
      meta: decodeSettingsValue(row.meta) ?? null,
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
  const fields: Array<[string, string]> = [
    ["reef_id", quoteText(input.reef_id, "attachment reef_id")],
    ["file_uri", quoteText(input.file_uri, "attachment file_uri")],
    ["filename", quoteText(input.filename, "attachment filename")],
    ["mime_type", quoteText(input.mime_type, "attachment mime_type")],
    ["size_bytes", quoteNumberOrNull(input.size_bytes)],
    ["author", quoteText(input.author, "attachment author")],
    ["created_at", quoteText(input.created_at, "attachment created_at")],
    ["source", quoteText(input.source, "attachment source")],
    ["inline", input.inline ? "TRUE" : "FALSE"],
    [
      "original_jira_attachment_id",
      quoteTextOrNull(
        input.original_jira_attachment_id,
        "attachment original_jira_attachment_id",
      ),
    ],
    ["meta", quoteJson(input.meta ?? null)],
  ];
  const columns = fields
    .map(([column]) => column)
    .map(quoteIdent)
    .join(", ");
  const values = fields.map(([, value]) => value).join(", ");
  const res = await runSql(
    adapter,
    vault,
    `WITH ins AS (INSERT INTO ${tableRef(
      REEF_ATTACHMENTS_TABLE,
    )} (${columns}) VALUES (${values}) RETURNING *) SELECT * FROM ins`,
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
          )} ORDER BY created_at ASC, id ASC`,
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
        created_at: new Date().toISOString(),
        source,
        inline: params.inline ?? false,
        original_jira_attachment_id: null,
        meta: null,
      });
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
