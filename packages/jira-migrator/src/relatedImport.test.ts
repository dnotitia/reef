import { describe, expect, it, vi } from "vitest";
import { createJiraAccountMappingArtifact } from "./accountMapping.js";
import { JiraReadClient } from "./jiraClient.js";
import { createJiraMigrationLedger } from "./ledger.js";
import type { JiraIssuePayload, NormalizedJiraAttachment } from "./payloads.js";
import {
  type JiraRelatedImportTarget,
  canonicalizeJiraRelation,
  importJiraRelatedData,
  resolveJiraMediaReference,
} from "./relatedImport.js";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const rootId = "11111111-1111-4111-8111-111111111111";
const replyId = "22222222-2222-4222-8222-222222222222";
const attachmentRowId = "33333333-3333-4333-8333-333333333333";

const issueFixture = (size = 3): JiraIssuePayload => ({
  id: "10001",
  key: "DEMO-1",
  renderedFields: { description: "" },
  fields: {
    summary: "Migration fixture",
    project: { id: "10", key: "DEMO" },
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "mediaSingle",
          content: [
            {
              type: "media",
              attrs: { id: "media-1", type: "file", alt: "sample.dat" },
            },
          ],
        },
      ],
    },
    attachment: [
      {
        id: "30001",
        filename: "sample.dat",
        mimeType: "application/octet-stream",
        size,
        created: "2026-01-01T00:00:00.000Z",
        author: { accountId: "acct-1" },
      },
    ],
    issuelinks: [
      {
        id: "40001",
        type: {
          id: "1",
          name: "Dependency",
          inward: "is required by",
          outward: "requires",
        },
        outwardIssue: { id: "10002", key: "DEMO-2" },
      },
      {
        id: "40001",
        type: {
          id: "1",
          name: "Dependency",
          inward: "is required by",
          outward: "requires",
        },
        outwardIssue: { id: "10002", key: "DEMO-2" },
      },
    ],
  },
});

const makeClient = (
  requests: string[],
  orphan = false,
  remoteFailure = false,
) =>
  new JiraReadClient({
    baseUrl: "https://example.atlassian.net",
    projectKey: "DEMO",
    auth: { mode: "bearer", token: "test-secret" },
    fetch: vi.fn<typeof fetch>(async (url, init) => {
      const parsed = new URL(String(url));
      requests.push(
        `${init?.method}:${parsed.pathname}?${parsed.searchParams}`,
      );
      if (parsed.pathname.endsWith("/comment")) {
        const startAt = Number(parsed.searchParams.get("startAt"));
        return json(
          startAt === 0
            ? {
                startAt: 0,
                maxResults: 1,
                total: 2,
                comments: [
                  {
                    id: 50001,
                    body: {
                      type: "doc",
                      version: 1,
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "root" }],
                        },
                      ],
                    },
                    author: { accountId: "acct-1" },
                    created: "2026-01-01T01:00:00.000Z",
                  },
                ],
              }
            : {
                startAt: 1,
                maxResults: 1,
                total: 2,
                comments: [
                  {
                    id: "50002",
                    parentId: orphan ? 59999 : 50001,
                    body: {
                      type: "doc",
                      version: 1,
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "reply" }],
                        },
                      ],
                    },
                    author: { accountId: "acct-1" },
                    created: "2026-01-01T02:00:00.000Z",
                    updated: "2026-01-01T03:00:00.000Z",
                  },
                ],
              },
        );
      }
      if (parsed.pathname.endsWith("/remotelink") && remoteFailure)
        return new Response(null, { status: 403, statusText: "Forbidden" });
      if (parsed.pathname.endsWith("/remotelink"))
        return json([
          {
            id: 9,
            globalId: "remote-1",
            object: {
              url: "https://example.com/reference",
              title: "Reference",
            },
          },
          {
            id: 10,
            object: {
              url: "https://example.com/reference-without-global-id",
              title: "Hashed reference",
            },
          },
        ]);
      if (parsed.pathname.includes("/attachment/content/"))
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "3",
          },
        });
      throw new Error(`unexpected request ${parsed.pathname}`);
    }),
  });

const makeTarget = () => {
  const comments = new Map<string, import("@reef/core").Comment>();
  const attachments = new Map<
    string,
    { attachment: import("@reef/core").IssueAttachment; bytes: Uint8Array }
  >();
  const relations = new Map<string, unknown>();
  const refs = new Map<string, unknown>();
  let description = "";
  const target: JiraRelatedImportTarget = {
    async createComment(input) {
      const id = input.parentCommentId ? replyId : rootId;
      const parent = input.parentCommentId
        ? comments.get(input.parentCommentId)
        : null;
      const comment = {
        id,
        reef_id: input.reefId,
        body: input.body,
        author: input.author,
        created_at: input.createdAt,
        edited_at: input.editedAt,
        parent_comment_id: input.parentCommentId ?? null,
        thread_root_id: parent ? (parent.thread_root_id ?? parent.id) : null,
      };
      comments.set(id, comment);
      return comment;
    },
    async readComment(id) {
      return comments.get(id) ?? null;
    },
    async createAttachment(input) {
      const file_uri = "akb://isolated/coll/files/file/30001";
      const attachment = {
        id: attachmentRowId,
        reef_id: input.reefId,
        file_uri,
        filename: input.filename,
        mime_type: input.mimeType,
        size_bytes: input.bytes.byteLength,
        author: input.author,
        created_at: input.createdAt,
        source: "jira_import" as const,
        inline: false,
        original_jira_attachment_id: input.originalJiraAttachmentId,
        meta: input.meta,
      };
      attachments.set(file_uri, { attachment, bytes: input.bytes });
      return attachment;
    },
    async readAttachment(uri) {
      return attachments.get(uri) ?? null;
    },
    async updateDescription(_reefId, markdown) {
      description = markdown;
    },
    async putRelation(value) {
      relations.set(value.idempotencyKey, value);
    },
    async hasRelation(key) {
      return relations.has(key);
    },
    async putExternalRef(value) {
      refs.set(value.idempotencyKey, value);
    },
    async hasExternalRef(key) {
      return refs.has(key);
    },
  };
  return {
    target,
    comments,
    attachments,
    relations,
    refs,
    get description() {
      return description;
    },
  };
};

describe("Jira related-data import stage", () => {
  it("keeps dry-run immutable, applies root-first, and reruns idempotently through the public stage", async () => {
    const requests: string[] = [];
    const client = makeClient(requests);
    const state = makeTarget();
    const accountMapping = createJiraAccountMappingArtifact({
      jiraCloudId: "cloud-1",
    });
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      client,
      target: state.target,
      accountMapping,
      linkMappings: [
        {
          typeId: "1",
          name: "Dependency",
          inward: "is required by",
          outward: "requires",
          kind: "directional" as const,
          outwardRelation: "depends_on" as const,
          inwardRelation: "blocks" as const,
        },
      ],
      resolveIssueTarget: (value: string) =>
        value === "10002"
          ? {
              reefId: "REEF-2",
              documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
            }
          : null,
      now: () => "2026-01-02T00:00:00.000Z",
    };
    const initial = createJiraMigrationLedger({
      jiraCloudId: "cloud-1",
      targetVault: "isolated",
    });

    const dry = await importJiraRelatedData({
      ...base,
      ledger: initial,
      mode: "dry-run",
    });
    expect(dry.report).toMatchObject({
      comments: { total: 2, roots: 1, replies: 1, created: 0 },
      attachments: { total: 1, created: 0 },
      media: { rewritten: 1, unresolved: 0 },
      links: { entries: 2, unique: 1, applied: 0 },
    });
    expect(
      state.comments.size +
        state.attachments.size +
        state.relations.size +
        state.refs.size,
    ).toBe(0);

    const applied = await importJiraRelatedData({
      ...base,
      ledger: dry.ledger,
      mode: "apply",
    });
    expect(applied.report.failures).toEqual([]);
    expect(state.comments.get(replyId)).toMatchObject({
      parent_comment_id: rootId,
      thread_root_id: rootId,
      edited_at: "2026-01-01T03:00:00.000Z",
    });
    expect(state.description).toContain("akb://isolated/");
    expect(state.attachments.size).toBe(1);
    expect(state.relations.size).toBe(1);
    expect([...state.relations.values()][0]).toMatchObject({
      sourceReefId: "REEF-1",
      targetReefId: "REEF-2",
      relation: "depends_on",
      inverseRelation: "blocks",
    });
    expect(state.refs.size).toBe(2);

    const rerun = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      mode: "apply",
    });
    expect(rerun.report.comments.skipped).toBe(2);
    expect(rerun.report.attachments.skipped).toBe(1);
    expect(rerun.report.links.skipped).toBe(1);
    expect(rerun.report.remote_links.skipped).toBe(2);
    expect(state.comments.size).toBe(2);
    expect(state.attachments.size).toBe(1);
    expect(requests.every((item) => item.startsWith("GET:"))).toBe(true);
    expect(
      requests
        .filter((item) => item.includes("/comment"))
        .every((item) => item.includes("expand=properties")),
    ).toBe(true);
    expect(requests.some((item) => item.includes("redirect=false"))).toBe(true);
    expect(requests.join("\n")).not.toContain("test-secret");

    const [storedUri, storedAttachment] = [...state.attachments.entries()][0];
    state.attachments.set(storedUri, {
      ...storedAttachment,
      bytes: new Uint8Array([1, 2]),
    });
    const corruptRerun = await importJiraRelatedData({
      ...base,
      ledger: rerun.ledger,
      mode: "apply",
    });
    expect(corruptRerun.report.attachments.skipped).toBe(0);
    expect(corruptRerun.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "attachment",
        phase: "readback",
        reason: "attachment_import_failed",
      }),
    );
  });

  it("isolates orphan replies, size mismatches, and unknown links", async () => {
    const requests: string[] = [];
    const client = makeClient(requests, true);
    const state = makeTarget();
    const broken = issueFixture(4);
    broken.fields.issuelinks = [
      {
        id: "unknown-link",
        type: { name: "Unmapped" },
        outwardIssue: { id: "999", key: "OTHER-1" },
      },
    ];
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: broken,
      reefId: "REEF-1",
      client,
      target: state.target,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply",
    });
    expect(result.report.failures.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        "attachment_size_mismatch",
        "comment_parent_unresolved",
      ]),
    );
    expect(result.report.links.unresolved).toBe(1);
    expect(state.refs.size).toBeGreaterThan(0);
  });

  it("isolates a remote-link catalog read failure from comments, attachments, and standard links", async () => {
    const state = makeTarget();
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      client: makeClient([], false, true),
      target: state.target,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [
        {
          typeId: "1",
          kind: "directional",
          outwardRelation: "depends_on",
          inwardRelation: "blocks",
        },
      ],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply",
    });

    expect(result.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "remote_link",
        phase: "read",
        reason: "remote_link_catalog_read_failed",
      }),
    );
    expect(state.comments.size).toBe(2);
    expect(state.attachments.size).toBe(1);
    expect(state.relations.size).toBe(1);
  });
});

describe("media crosswalk", () => {
  const source = (id: string, filename: string): NormalizedJiraAttachment => ({
    id,
    filename,
    mimeType: null,
    size: null,
    contentUrl: null,
    created: null,
    author: null,
  });
  it("uses deterministic strategies and refuses ambiguous filenames", () => {
    const media = {
      path: "$",
      mediaId: "m1",
      mediaType: "file",
      collection: null,
      filename: "a.bin",
      rawArchiveReference: null,
      placeholder: "placeholder",
    };
    expect(
      resolveJiraMediaReference(
        media,
        [{ source: source("1", "a.bin"), fileUri: "akb://v/file/1" }],
        "",
      )?.strategy,
    ).toBe("unique_filename");
    expect(
      resolveJiraMediaReference(
        media,
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "a.bin"), fileUri: "akb://v/file/2" },
        ],
        "",
      ),
    ).toBeNull();
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [{ source: source("1", "only.bin"), fileUri: "akb://v/file/1" }],
        "",
      )?.strategy,
    ).toBe("sole_attachment");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" title="b.bin" href="/attachment/2/b.bin"></span>',
      )?.strategy,
    ).toBe("rendered_element");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" data-filename="b.bin"></span>',
      )?.strategy,
    ).toBe("rendered_unique_filename");
  });
});

describe("directional link canonicalization", () => {
  it("produces the same outward-to-inward edge from either endpoint view", () => {
    const mapping = {
      typeId: "1",
      kind: "directional" as const,
      outwardRelation: "depends_on" as const,
      inwardRelation: "blocks" as const,
    };
    expect(
      canonicalizeJiraRelation(mapping, "outward", "REEF-1", "REEF-2"),
    ).toEqual(canonicalizeJiraRelation(mapping, "inward", "REEF-2", "REEF-1"));
  });
});
