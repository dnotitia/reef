import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../errors";
import { downloadIssueAttachment } from "./attachments";
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
  sqlRequestBody,
  uploadIssueAttachment,
} from "../core/akb.testSupport";

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
    const body = sqlRequestBody(calls[0]);
    expect(body.sql).toContain(`FROM ${REEF_ATTACHMENTS_TABLE}`);
    expect(body.sql).toContain(
      "ORDER BY COALESCE(meta->>'created_at', created_at::text) ASC, id ASC",
    );
    expect(body.sql).toContain("WHERE reef_id = $1");
    expect(body.params).toEqual(["REEF-349"]);
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
      { body: makeSqlQueryResponse([], ATTACHMENT_ROW_COLUMNS) },
      {
        body: {
          uri: "akb://reef-sample/issues/file/file-1",
          upload_url: "https://s3.test/presigned-put",
        },
      },
      { empty: true },
      {
        body: {
          uri: "akb://reef-sample/issues/file/file-1",
          name: "screenshot.png",
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
    expect(calls[3]?.url).toContain(
      "https://akb.test/api/v1/files/reef-sample/upload?",
    );
    expect(calls[3]?.url).toContain("filename=screenshot.png");
    expect(calls[3]?.url).toContain("content_hash=");
    expect(calls[4]).toMatchObject({
      url: "https://s3.test/presigned-put",
      init: {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        redirect: "error",
      },
    });
    expect(calls[5]?.url).toContain(
      "https://akb.test/api/v1/files/reef-sample/file-1/confirm?",
    );
    const issueLookup = sqlRequestBody(calls[1]);
    expect(issueLookup.sql).toContain("WHERE reef_id = $1");
    expect(issueLookup.params).toEqual(["REEF-349"]);
    const idempotencyLookup = sqlRequestBody(calls[2]);
    expect(idempotencyLookup.sql).toContain("= $1");
    expect(idempotencyLookup.sql).not.toContain("attachment:cloud-1:source-42");
    expect(idempotencyLookup.params).toEqual(["attachment:cloud-1:source-42"]);
    const insertBody = sqlRequestBody(calls[6]);
    const insertSql = insertBody.sql;
    expect(insertSql).toContain(`INSERT INTO ${REEF_ATTACHMENTS_TABLE}`);
    expect(
      insertSql.slice(
        insertSql.indexOf(`INSERT INTO ${REEF_ATTACHMENTS_TABLE}`),
        insertSql.indexOf(") SELECT "),
      ),
    ).not.toContain('"created_at"');
    expect(insertSql).toContain("$1");
    expect(insertSql).toContain("$10::jsonb");
    expect(insertSql).toContain("hashtextextended($11, 0)");
    expect(insertSql).toContain("= $11");
    expect(insertSql).not.toContain("REEF-349");
    expect(insertSql).not.toContain("akb://reef-sample/issues/file/file-1");
    expect(insertSql).not.toContain("source-42");
    expect(insertSql).not.toContain('"created_at":"');
    expect(insertBody.params).toEqual([
      "REEF-349",
      "akb://reef-sample/issues/file/file-1",
      "screenshot.png",
      "image/png",
      4,
      "alice",
      "jira_import",
      true,
      "source-42",
      JSON.stringify({
        source: "jira",
        jira_idempotency_key: "attachment:cloud-1:source-42",
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      "attachment:cloud-1:source-42",
    ]);
    const activityBody = sqlRequestBody(calls[8]);
    expect(activityBody.sql).toContain(
      'INSERT INTO reef_activity ("reef_id", "event_type", "event_key", "payload", "meta")',
    );
    expect(activityBody.params).toContain("attachment_added");
    expect(activityBody.params).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"attachment_id":"att-1"'),
      ]),
    );
  });

  it("returns a compatible idempotent attachment before uploading", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ reef_id: "REEF-349" }], ["reef_id"]) },
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              size_bytes: 4,
              source: "jira_import",
              original_jira_attachment_id: "source-42",
              meta: {
                source: "jira",
                jira_idempotency_key: "attachment:cloud-1:source-42",
                created_at: "2026-01-01T00:00:00.000Z",
              },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
      {
        body: {
          name: "screenshot.png",
          download_url: "https://s3.test/presigned-get",
          mime_type: "image/png",
          size_bytes: 4,
        },
      },
      {
        rawBody: new Uint8Array([1, 2, 3, 4]).buffer,
        headers: { "content-type": "image/png" },
      },
    ]);

    await expect(
      uploadIssueAttachment({
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
      }),
    ).resolves.toMatchObject({ id: "att-1" });
    expect(
      calls.some(
        (call) =>
          call.url.endsWith("/api/v1/files") && call.init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("treats canonically equivalent Unicode filenames as idempotent", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ reef_id: "REEF-349" }], ["reef_id"]) },
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              filename: "évidence.png",
              size_bytes: 4,
              source: "jira_import",
              original_jira_attachment_id: "source-42",
              meta: {
                source: "jira",
                jira_idempotency_key: "attachment:cloud-1:source-42",
                created_at: "2026-01-01T00:00:00.000Z",
              },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
      {
        body: {
          name: "évidence.png",
          download_url: "https://s3.test/presigned-get",
          mime_type: "image/png",
          size_bytes: 4,
        },
      },
      {
        rawBody: new Uint8Array([1, 2, 3, 4]).buffer,
        headers: { "content-type": "image/png" },
      },
    ]);

    await expect(
      uploadIssueAttachment({
        adapter: makeAdapter(),
        vault: "reef-sample",
        reefId: "REEF-349",
        filename: "e\u0301vidence.png",
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
      }),
    ).resolves.toMatchObject({ id: "att-1", filename: "évidence.png" });
    expect(
      calls.some(
        (call) =>
          call.url.endsWith("/api/v1/files") && call.init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("deletes the uploaded file when the single-statement claim reuses another row", async () => {
    const idempotencyKey = "attachment:cloud-1:source-42";
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ reef_id: "REEF-349" }], ["reef_id"]) },
      { body: makeSqlQueryResponse([], ATTACHMENT_ROW_COLUMNS) },
      {
        body: {
          uri: "akb://reef-sample/issues/file/file-1",
          upload_url: "https://s3.test/presigned-put",
        },
      },
      { empty: true },
      {
        body: {
          uri: "akb://reef-sample/issues/file/file-1",
          name: "screenshot.png",
          mime_type: "image/png",
          size_bytes: 4,
        },
      },
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              id: "att-existing",
              file_uri: "akb://reef-sample/issues/file/file-2",
              size_bytes: 4,
              source: "jira_import",
              original_jira_attachment_id: "source-42",
              meta: {
                source: "jira",
                jira_idempotency_key: idempotencyKey,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
      {
        body: {
          name: "screenshot.png",
          download_url: "https://s3.test/presigned-get",
          mime_type: "image/png",
          size_bytes: 4,
        },
      },
      {
        rawBody: new Uint8Array([1, 2, 3, 4]).buffer,
        headers: { "content-type": "image/png" },
      },
      { empty: true },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([{ id: "event-1" }], ["id"]) },
    ]);

    await expect(
      uploadIssueAttachment({
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
        meta: { source: "jira", jira_idempotency_key: idempotencyKey },
      }),
    ).resolves.toMatchObject({
      id: "att-existing",
      file_uri: "akb://reef-sample/issues/file/file-2",
    });

    expect(calls[9]).toMatchObject({
      url: "https://akb.test/api/v1/files/reef-sample/file-1",
      init: { method: "DELETE" },
    });
  });
});

describe("createIssueAttachmentRecord", () => {
  it("inserts Jira-imported metadata without uploading bytes", async () => {
    const input = {
      reef_id: "REEF'349\\한글🚀",
      file_uri: "akb://reef-sample/issues/file/file-'1\\한글🚀",
      filename: "스크린샷 ' \\ 🚀.png",
      mime_type: "application/x-'\\한글",
      size_bytes: 1234,
      author: "홍길동'\\🚀",
      created_at: "2026-07-09T01:00:00.000Z",
      source: "jira_import" as const,
      inline: true,
      original_jira_attachment_id: "10001'\\한글",
      meta: {
        description: "O'Reilly \\ 한글 🚀",
        nested: { value: "작은따옴표 ' \\ 이모지 🚀" },
      },
    };
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse([{ reef_id: input.reef_id }], ["reef_id"]),
      },
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              reef_id: input.reef_id,
              file_uri: input.file_uri,
              filename: input.filename,
              mime_type: input.mime_type,
              created_at: "2026-07-10T01:00:00.000Z",
              author: input.author,
              source: input.source,
              inline: input.inline,
              original_jira_attachment_id: input.original_jira_attachment_id,
              size_bytes: input.size_bytes,
              meta: { ...input.meta, created_at: input.created_at },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
    ]);

    const attachment = await createIssueAttachmentRecord(
      makeAdapter(),
      "reef-sample",
      input,
    );

    expect(calls.some((call) => call.url.endsWith("/api/v1/files"))).toBe(
      false,
    );
    const insertBody = sqlRequestBody(calls[2]);
    const sql = insertBody.sql;
    const insertColumns = sql.slice(0, sql.indexOf(" VALUES "));
    expect(insertColumns).not.toContain('"created_at"');
    expect(sql).toContain("$10::jsonb");
    expect(sql).not.toContain(input.reef_id);
    expect(sql).not.toContain(input.file_uri);
    expect(sql).not.toContain(input.filename);
    expect(sql).not.toContain(input.mime_type);
    expect(sql).not.toContain(input.author);
    expect(sql).not.toContain(input.original_jira_attachment_id);
    expect(insertBody.params).toEqual([
      input.reef_id,
      input.file_uri,
      input.filename,
      input.mime_type,
      input.size_bytes,
      input.author,
      input.source,
      true,
      input.original_jira_attachment_id,
      JSON.stringify({ ...input.meta, created_at: input.created_at }),
    ]);
    expect(attachment.created_at).toBe("2026-07-09T01:00:00.000Z");
    expect(attachment).toMatchObject({
      reef_id: input.reef_id,
      file_uri: input.file_uri,
      filename: input.filename,
      mime_type: input.mime_type,
      author: input.author,
      original_jira_attachment_id: input.original_jira_attachment_id,
      meta: input.meta,
    });
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
        body: {
          name: "screenshot.png",
          download_url: "https://s3.test/presigned-get",
          mime_type: "image/png",
          size_bytes: 3,
        },
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
    const bodyRequest = sqlRequestBody(calls[0]);
    expect(bodyRequest.sql).toContain("reef_id = $1");
    expect(bodyRequest.sql).toContain("file_uri = $2");
    expect(bodyRequest.sql).not.toContain(
      "akb://reef-sample/issues/file/file-1",
    );
    expect(bodyRequest.params).toEqual([
      "REEF-349",
      "akb://reef-sample/issues/file/file-1",
    ]);
    expect(calls[1]?.url).toBe(
      "https://akb.test/api/v1/files/reef-sample/file-1/download",
    );
    expect(calls[2]?.url).toBe("https://s3.test/presigned-get");
  });
});

describe("downloadIssueAttachment", () => {
  it("binds the issue id and attachment id before downloading the file", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [makeAttachmentRow({ id: "att'1", file_uri: "akb://file/'1" })],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
      {
        body: {
          name: "screenshot.png",
          download_url: "https://s3.test/presigned-get",
          mime_type: "image/png",
          size_bytes: 3,
        },
      },
      {
        rawBody: new Uint8Array([9, 8, 7]).buffer,
        headers: { "content-type": "image/png" },
      },
    ]);

    await expect(
      downloadIssueAttachment({
        adapter: makeAdapter(),
        vault: "reef-sample",
        reefId: "REEF'349",
        attachmentId: "att'1",
      }),
    ).resolves.toMatchObject({ attachment: { id: "att'1" } });

    const body = sqlRequestBody(calls[0]);
    expect(body.sql).toContain("reef_id = $1");
    expect(body.sql).toContain("id = $2");
    expect(body.sql).not.toContain("REEF'349");
    expect(body.sql).not.toContain("att'1");
    expect(body.params).toEqual(["REEF'349", "att'1"]);
  });
});

describe("attachment SQL input validation", () => {
  it("rejects NUL raw strings before any AKB request", async () => {
    const { calls } = setupFetch([]);

    await expect(
      uploadIssueAttachment({
        adapter: makeAdapter(),
        vault: "reef-sample",
        reefId: "REEF-349",
        filename: "bad\0name.txt",
        mimeType: "text/plain",
        bytes: new Uint8Array([1]),
        author: "alice",
        source: "issue_body",
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });

  it("rejects NUL metadata before any AKB request", async () => {
    const { calls } = setupFetch([]);

    await expect(
      uploadIssueAttachment({
        adapter: makeAdapter(),
        vault: "reef-sample",
        reefId: "REEF-349",
        filename: "screenshot.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1]),
        author: "alice",
        source: "issue_body",
        meta: { caption: "bad\0value" },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });

  it("rejects non-serializable metadata before any AKB request", async () => {
    const { calls } = setupFetch([]);

    await expect(
      createIssueAttachmentRecord(makeAdapter(), "reef-sample", {
        reef_id: "REEF-349",
        file_uri: "akb://reef-sample/issues/file/file-1",
        filename: "screenshot.png",
        mime_type: "image/png",
        size_bytes: 1,
        author: "alice",
        created_at: "2026-07-09T01:00:00.000Z",
        source: "issue_body",
        inline: false,
        meta: { callback: () => "not-json" },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });
});
