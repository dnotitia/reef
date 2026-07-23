import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  REEF_ATTACHMENTS_TABLE,
  createIssueAttachmentRecord,
  downloadIssueAttachmentByFileUri,
  listIssueAttachments,
  makeAdapter,
  makeListTablesResponse,
  makeSqlQueryResponse,
  makeSqlRuntimeErrorResponse,
  setupFetch,
  uploadIssueAttachment,
} from "./akb.testSupport";

const ATTACHMENT_ROW_COLUMNS = [
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

function makeAttachmentRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "att-1",
    reef_id: "REEF-349",
    file_uri: "akb://reef-sample/issues/file/file-1",
    filename: "screenshot.png",
    mime_type: "image/png",
    size_bytes: 1234,
    author: "alice",
    created_at: "2026-07-09T01:00:00.000Z",
    source: "issue_body",
    inline: true,
    original_jira_attachment_id: null,
    meta: null,
    ...overrides,
  };
}

function lastSql(body: unknown): string {
  return JSON.parse(body as string).sql as string;
}

describe("listIssueAttachments", () => {
  it("projects rows ordered by created time", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              id: "att-1",
              created_at: "2026-07-10T01:00:00.000Z",
              meta: { created_at: "2026-07-09T01:00:00.000Z" },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const attachments = await listIssueAttachments(
      makeAdapter(),
      "reef-sample",
      "REEF-349",
    );

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      id: "att-1",
      file_uri: "akb://reef-sample/issues/file/file-1",
      created_at: "2026-07-09T01:00:00.000Z",
      inline: true,
      meta: null,
    });
    const sql = lastSql(calls[0]?.init?.body);
    expect(sql).toContain(`FROM ${REEF_ATTACHMENTS_TABLE}`);
    expect(sql).toContain(
      "ORDER BY COALESCE(meta->>'created_at', created_at::text) ASC, id ASC",
    );
  });

  it("returns an empty list before the attachment table exists", async () => {
    setupFetch([makeSqlRuntimeErrorResponse(REEF_ATTACHMENTS_TABLE)]);

    await expect(
      listIssueAttachments(makeAdapter(), "reef-sample", "REEF-349"),
    ).resolves.toEqual([]);
  });
});

describe("uploadIssueAttachment", () => {
  it("uploads bytes to AKB files, inserts metadata, and returns the row", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ reef_id: "REEF-349" }], ["reef_id"]) },
      {
        body: {
          uri: "akb://reef-sample/issues/file/file-1",
          filename: "screenshot.png",
          mime_type: "image/png",
          size_bytes: 4,
        },
      },
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              size_bytes: 4,
              source: "jira_import",
              original_jira_attachment_id: "source-42",
              meta: {
                source: "jira",
                created_at: "2026-01-01T00:00:00.000Z",
              },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ id: "event-1" }], ["id"]) },
    ]);

    const attachment = await uploadIssueAttachment({
      adapter: makeAdapter(),
      vault: "reef-sample",
      reefId: "REEF-349",
      filename: "screenshot.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3, 4]),
      author: "alice",
      source: "jira_import",
      inline: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      originalJiraAttachmentId: "source-42",
      meta: {
        source: "jira",
        jira_idempotency_key: "attachment:cloud-1:source-42",
      },
    });

    expect(attachment).toMatchObject({
      id: "att-1",
      file_uri: "akb://reef-sample/issues/file/file-1",
      size_bytes: 4,
    });
    expect(calls[2]?.url).toBe("https://akb.test/api/v1/files");
    expect(calls[2]?.init?.body).toBeInstanceOf(FormData);
    const insertSql = lastSql(calls[3]?.init?.body);
    expect(insertSql).toContain(`INSERT INTO ${REEF_ATTACHMENTS_TABLE}`);
    expect(
      insertSql.slice(
        insertSql.indexOf(`INSERT INTO ${REEF_ATTACHMENTS_TABLE}`),
        insertSql.indexOf(") SELECT "),
      ),
    ).not.toContain('"created_at"');
    expect(insertSql).toContain('"created_at":');
    expect(insertSql).toContain('"source":"jira"');
    expect(insertSql).toContain("pg_advisory_xact_lock");
    expect(insertSql).toContain(
      '"jira_idempotency_key":"attachment:cloud-1:source-42"',
    );
    expect(insertSql).toContain("'source-42'");
    expect(insertSql).toContain("'REEF-349'");
    expect(insertSql).toContain("'akb://reef-sample/issues/file/file-1'");
    const activitySql = lastSql(calls[5]?.init?.body);
    expect(activitySql).toContain("'attachment_added'");
    expect(activitySql).toContain('"attachment_id":"att-1"');
  });
});

describe("createIssueAttachmentRecord", () => {
  it("inserts Jira-imported metadata without uploading bytes", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ reef_id: "REEF-349" }], ["reef_id"]) },
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              created_at: "2026-07-10T01:00:00.000Z",
              source: "jira_import",
              original_jira_attachment_id: "10001",
              meta: { created_at: "2026-07-09T01:00:00.000Z" },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const attachment = await createIssueAttachmentRecord(
      makeAdapter(),
      "reef-sample",
      {
        reef_id: "REEF-349",
        file_uri: "akb://reef-sample/issues/file/file-1",
        filename: "screenshot.png",
        mime_type: "image/png",
        size_bytes: 1234,
        author: "jira-import",
        created_at: "2026-07-09T01:00:00.000Z",
        source: "jira_import",
        inline: true,
        original_jira_attachment_id: "10001",
        meta: null,
      },
    );

    expect(calls.some((call) => call.url.endsWith("/api/v1/files"))).toBe(
      false,
    );
    const sql = lastSql(calls[2]?.init?.body);
    const insertColumns = sql.slice(0, sql.indexOf(" VALUES "));
    expect(insertColumns).not.toContain('"created_at"');
    expect(sql).toContain('"created_at":"2026-07-09T01:00:00.000Z"');
    expect(sql).toContain("'jira_import'");
    expect(sql).toContain("'10001'");
    expect(attachment.created_at).toBe("2026-07-09T01:00:00.000Z");
  });
});

describe("downloadIssueAttachmentByFileUri", () => {
  it("checks issue ownership before streaming the AKB file", async () => {
    const body = new Uint8Array([9, 8, 7]).buffer;
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [makeAttachmentRow()],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
      {
        rawBody: body,
        headers: {
          "content-type": "image/png",
          "content-length": "3",
          "content-disposition": "inline; filename*=UTF-8''screenshot.png",
        },
      },
    ]);

    const downloaded = await downloadIssueAttachmentByFileUri({
      adapter: makeAdapter(),
      vault: "reef-sample",
      reefId: "REEF-349",
      fileUri: "akb://reef-sample/issues/file/file-1",
    });

    expect(new Uint8Array(downloaded.body)).toEqual(new Uint8Array([9, 8, 7]));
    expect(downloaded.contentType).toBe("image/png");
    expect(downloaded.filename).toBe("screenshot.png");
    const sql = lastSql(calls[0]?.init?.body);
    expect(sql).toContain("file_uri = 'akb://reef-sample/issues/file/file-1'");
    expect(calls[1]?.url).toBe(
      "https://akb.test/api/v1/files/reef-sample/file-1",
    );
  });
});
