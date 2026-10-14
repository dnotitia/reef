import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../errors";
import { downloadIssueAttachment } from "./attachments";
import {
  REEF_ATTACHMENTS_TABLE,
  downloadIssueAttachmentByFileUri,
  listIssueAttachments,
  makeAdapter,
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
    const input = {
      reefId: "REEF'349\\한글🚀",
      filename: "스크린샷 ' \\ 🚀.png",
      mimeType: "application/x-reef-audit",
      author: "홍길동'\\🚀",
      source: "jira_import" as const,
      inline: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      originalJiraAttachmentId: "source-'42\\한글",
      meta: {
        source: "jira",
        jira_idempotency_key: "attachment:cloud-'1\\한글:source-42",
        description: "O'Reilly \\ 한글 🚀",
        nested: { value: "작은따옴표 ' \\ 이모지 🚀" },
      },
    };
    const fileUri = "akb://reef-sample/issues/file/file-'1\\한글🚀";
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([{ reef_id: input.reefId }], ["reef_id"]) },
      { body: makeSqlQueryResponse([], ATTACHMENT_ROW_COLUMNS) },
      {
        body: {
          uri: fileUri,
          upload_url: "https://s3.test/presigned-put",
        },
      },
      { empty: true },
      {
        body: {
          uri: fileUri,
          name: input.filename,
          mime_type: input.mimeType,
          size_bytes: 4,
        },
      },
      {
        body: makeSqlQueryResponse(
          [
            makeAttachmentRow({
              reef_id: input.reefId,
              file_uri: fileUri,
              filename: input.filename,
              mime_type: input.mimeType,
              size_bytes: 4,
              author: input.author,
              source: input.source,
              original_jira_attachment_id: input.originalJiraAttachmentId,
              meta: { ...input.meta, created_at: input.createdAt },
            }),
          ],
          ATTACHMENT_ROW_COLUMNS,
        ),
      },
      { body: makeSqlQueryResponse([{ id: "event-1" }], ["id"]) },
    ]);

    const attachment = await uploadIssueAttachment({
      adapter: makeAdapter(),
      vault: "reef-sample",
      ...input,
      bytes: new Uint8Array([1, 2, 3, 4]),
    });

    expect(attachment).toMatchObject({
      id: "att-1",
      reef_id: input.reefId,
      file_uri: fileUri,
      filename: input.filename,
      mime_type: input.mimeType,
      author: input.author,
      original_jira_attachment_id: input.originalJiraAttachmentId,
      created_at: input.createdAt,
      meta: input.meta,
      size_bytes: 4,
    });
    expect(calls[2]?.url).toContain(
      "https://akb.test/api/v1/files/reef-sample/upload?",
    );
    expect(new URL(calls[2].url).searchParams.get("filename")).toBe(
      input.filename,
    );
    expect(calls[2]?.url).toContain("content_hash=");
    expect(calls[3]).toMatchObject({
      url: "https://s3.test/presigned-put",
      init: {
        method: "PUT",
        headers: { "Content-Type": input.mimeType },
        redirect: "error",
      },
    });
    expect(new URL(calls[4].url).pathname).toBe(
      "/api/v1/files/reef-sample/file-'1%5C%ED%95%9C%EA%B8%80%F0%9F%9A%80/confirm",
    );
    const issueLookup = sqlRequestBody(calls[0]);
    expect(issueLookup.sql).toContain("WHERE reef_id = $1");
    expect(issueLookup.params).toEqual([input.reefId]);
    const idempotencyLookup = sqlRequestBody(calls[1]);
    expect(idempotencyLookup.sql).toContain("= $1");
    expect(idempotencyLookup.sql).not.toContain(
      input.meta.jira_idempotency_key,
    );
    expect(idempotencyLookup.params).toEqual([input.meta.jira_idempotency_key]);
    const insertBody = sqlRequestBody(calls[5]);
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
    expect(insertSql).not.toContain(input.reefId);
    expect(insertSql).not.toContain(fileUri);
    expect(insertSql).not.toContain(input.filename);
    expect(insertSql).not.toContain(input.mimeType);
    expect(insertSql).not.toContain(input.author);
    expect(insertSql).not.toContain(input.originalJiraAttachmentId);
    expect(insertSql).not.toContain(input.meta.description);
    expect(insertSql).not.toContain(input.meta.nested.value);
    expect(insertSql).not.toContain('"created_at":"');
    expect(insertBody.params).toEqual([
      input.reefId,
      fileUri,
      input.filename,
      input.mimeType,
      4,
      input.author,
      input.source,
      true,
      input.originalJiraAttachmentId,
      JSON.stringify({ ...input.meta, created_at: input.createdAt }),
      input.meta.jira_idempotency_key,
    ]);
    const activityBody = sqlRequestBody(calls[6]);
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
    expect(calls).toHaveLength(4);
    expect(
      calls.map(({ url, init }) => [
        new URL(url).pathname,
        init?.method ?? "GET",
      ]),
    ).toEqual([
      ["/api/v1/tables/reef-sample/sql", "POST"],
      ["/api/v1/tables/reef-sample/sql", "POST"],
      ["/api/v1/files/reef-sample/file-1/download", "GET"],
      ["/presigned-get", "GET"],
    ]);
  });

  it("treats canonically equivalent Unicode filenames as idempotent", async () => {
    const { calls } = setupFetch([
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
    expect(calls).toHaveLength(4);
    expect(
      calls.map(({ url, init }) => [
        new URL(url).pathname,
        init?.method ?? "GET",
      ]),
    ).toEqual([
      ["/api/v1/tables/reef-sample/sql", "POST"],
      ["/api/v1/tables/reef-sample/sql", "POST"],
      ["/api/v1/files/reef-sample/file-1/download", "GET"],
      ["/presigned-get", "GET"],
    ]);
  });

  it("deletes the uploaded file when the single-statement claim reuses another row", async () => {
    const idempotencyKey = "attachment:cloud-1:source-42";
    const { calls } = setupFetch([
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

    expect(
      calls.find(
        (call) =>
          call.url === "https://akb.test/api/v1/files/reef-sample/file-1" &&
          call.init?.method === "DELETE",
      ),
    ).toBeDefined();
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

  it.each([
    { name: "NUL", meta: { caption: "bad\0value" } },
    { name: "non-serializable", meta: { callback: () => "not-json" } },
  ])("rejects $name metadata before any AKB request", async ({ meta }) => {
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
        meta,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });
});
