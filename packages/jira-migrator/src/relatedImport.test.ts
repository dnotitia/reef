import { describe, expect, it, vi } from "vitest";
import { createJiraAccountMappingArtifact } from "./accountMapping.js";
import { convertAdfToMarkdown } from "./adf.js";
import { fingerprintJiraState } from "./diff.js";
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
const attachmentPolicy = {
  commentVisibilityCompleteness: "verified" as const,
  maxBytes: 1024,
};

const issueFixture = (size = 3): JiraIssuePayload => ({
  id: "10001",
  key: "DEMO-1",
  renderedFields: {
    description:
      '<span data-media-services-id="media-1" href="/attachment/30001/sample.dat"></span>',
  },
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
        author: { emailAddress: "directory-key-1" },
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
  commentMedia = false,
  restrictedComment = false,
  internalComment = false,
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
                    body: commentMedia
                      ? {
                          type: "doc",
                          version: 1,
                          content: [
                            {
                              type: "mediaSingle",
                              content: [
                                {
                                  type: "media",
                                  attrs: {
                                    id: "comment-media",
                                    type: "file",
                                  },
                                },
                              ],
                            },
                          ],
                        }
                      : {
                          type: "doc",
                          version: 1,
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "root" }],
                            },
                          ],
                        },
                    renderedBody: commentMedia
                      ? '<span data-media-services-id="comment-media" href="/attachment/30001/fixture">media</span>'
                      : undefined,
                    author: { accountId: "acct-1" },
                    created: "2026-01-01T01:00:00.000Z",
                    properties: internalComment
                      ? [
                          {
                            key: "sd.public.comment",
                            value: { internal: true },
                          },
                        ]
                      : [],
                    ...(restrictedComment
                      ? {
                          visibility: {
                            type: "role",
                            identifier: "restricted-role",
                          },
                        }
                      : {}),
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
                    properties: [],
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
  const commentKeys = new Map<string, string>();
  const attachments = new Map<
    string,
    { attachment: import("@reef/core").IssueAttachment; bytes: Uint8Array }
  >();
  const relations = new Map<string, unknown>();
  const refs = new Map<string, unknown>();
  let description = convertAdfToMarkdown(
    issueFixture().fields.description,
  ).markdown;
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
      commentKeys.set(input.idempotencyKey, id);
      return comment;
    },
    async readComment(id) {
      return comments.get(id) ?? null;
    },
    async findCommentByIdempotencyKey(key) {
      const id = commentKeys.get(key);
      return id ? (comments.get(id) ?? null) : null;
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
    async findAttachmentByJiraId(reefId, jiraAttachmentId) {
      return (
        [...attachments.values()].find(
          ({ attachment }) =>
            attachment.reef_id === reefId &&
            attachment.original_jira_attachment_id === jiraAttachmentId,
        ) ?? null
      );
    },
    async readDescription() {
      return description;
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
    async readRelation(key) {
      const value = relations.get(key) as
        | Parameters<JiraRelatedImportTarget["putRelation"]>[0]
        | undefined;
      return value
        ? {
            sourceReefId: value.sourceReefId,
            targetReefId: value.targetReefId,
            relation: value.relation,
            inverseRelation: value.inverseRelation,
          }
        : null;
    },
    async deleteRelation(key) {
      relations.delete(key);
    },
    async putExternalRef(value) {
      refs.set(value.idempotencyKey, value);
    },
    async hasExternalRef(key) {
      return refs.has(key);
    },
    async readExternalRef(key) {
      const value = refs.get(key) as
        | Parameters<JiraRelatedImportTarget["putExternalRef"]>[0]
        | undefined;
      return value
        ? {
            reefId: value.reefId,
            ref: value.ref,
            provenance: value.provenance,
          }
        : null;
    },
    async deleteExternalRef(key) {
      refs.delete(key);
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
    set description(value: string) {
      description = value;
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
      attachmentPolicy,
      client,
      target: state.target,
      accountMapping,
      actorDirectory: [
        { actor: "reef-directory-actor", emailAddress: "directory-key-1" },
      ],
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
    expect([...state.attachments.values()][0]?.attachment.author).toBe(
      "reef-directory-actor",
    );
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

    const [mimeUri, mimeStored] = [...state.attachments.entries()][0];
    state.attachments.set(mimeUri, {
      ...mimeStored,
      attachment: {
        ...mimeStored.attachment,
        mime_type: "text/plain",
      },
    });
    const sourceAttachment = base.issue.fields.attachment?.[0];
    if (sourceAttachment) sourceAttachment.mimeType = undefined;
    const mimeRerun = await importJiraRelatedData({
      ...base,
      ledger: rerun.ledger,
      mode: "apply",
    });
    expect(mimeRerun.report.attachments.skipped).toBe(0);
    expect(mimeRerun.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "attachment",
        phase: "readback",
      }),
    );
    if (sourceAttachment)
      sourceAttachment.mimeType = "application/octet-stream";
    state.attachments.set(mimeUri, mimeStored);

    const remapped = await importJiraRelatedData({
      ...base,
      ledger: rerun.ledger,
      linkMappings: [{ typeId: "1", kind: "symmetric" }],
      mode: "apply",
    });
    expect(remapped.report.links.applied).toBe(1);
    expect([...state.relations.values()][0]).toMatchObject({
      relation: "related_to",
      inverseRelation: "related_to",
    });

    const preservedDescription = state.description;
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
    expect(state.description).toBe(preservedDescription);
    expect(corruptRerun.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "attachment",
        phase: "readback",
        reason: "attachment_import_failed",
      }),
    );
  });

  it("rewrites descriptions projected with legacy option-aware media placeholders", async () => {
    const state = makeTarget();
    const sourceIssue = issueFixture();
    const descriptionConversionOptions = {
      mediaRawArchiveReferences: {
        "media-1": {
          runId: "fixture-run",
          entryId: "fixture-entry",
          contentSha256: "a".repeat(64),
        },
      },
    };
    const projection = convertAdfToMarkdown(
      sourceIssue.fields.description,
      descriptionConversionOptions,
    );
    state.description = projection.media.reduce(
      (markdown, media) =>
        markdown.replace(media.placeholder, media.legacyPlaceholder),
      projection.markdown,
    );
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: sourceIssue,
      reefId: "REEF-1",
      attachmentPolicy,
      descriptionConversionOptions,
      client: makeClient([]),
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
    expect(result.report.failures).toEqual([]);
    expect(state.description).toContain("akb://isolated/");
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
      attachmentPolicy,
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

  it("does not publish restricted comments or attachments with unverifiable visibility", async () => {
    const requests: string[] = [];
    const state = makeTarget();
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient(requests, false, false, false, true),
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
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_kind: "comment",
          reason: "comment_visibility_restricted",
        }),
        expect.objectContaining({
          source_kind: "attachment",
          reason: "attachment_visibility_unverifiable",
        }),
      ]),
    );
    expect(state.comments.size).toBe(0);
    expect(state.attachments.size).toBe(0);
    expect(
      requests.some((request) => request.includes("/attachment/content/")),
    ).toBe(false);
  });

  it("does not publish Jira Service Management internal comments", async () => {
    const state = makeTarget();
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([], false, false, false, false, true),
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
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_kind: "comment",
          reason: "comment_visibility_restricted",
        }),
        expect.objectContaining({
          source_kind: "attachment",
          reason: "attachment_visibility_unverifiable",
        }),
      ]),
    );
    expect(state.comments.size).toBe(0);
    expect(state.attachments.size).toBe(0);
  });

  it("requires an explicit completeness attestation before attachment import", async () => {
    const requests: string[] = [];
    const state = makeTarget();
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      client: makeClient(requests),
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
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "attachment",
        reason: "attachment_visibility_unverifiable",
      }),
    );
    expect(state.attachments.size).toBe(0);
    expect(
      requests.some((request) => request.includes("/attachment/content/")),
    ).toBe(false);
  });

  it("validates attachment bytes during dry-run without target mutation", async () => {
    const requests: string[] = [];
    const state = makeTarget();
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(4),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient(requests),
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
      mode: "dry-run",
    });
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "attachment",
        reason: "attachment_size_mismatch",
      }),
    );
    expect(
      requests.some((request) => request.includes("/attachment/content/")),
    ).toBe(true);
    expect(state.attachments.size).toBe(0);
  });

  it("reports and rewrites comment media consistently in dry-run and apply", async () => {
    const state = makeTarget();
    const issue = issueFixture();
    issue.fields.attachment?.push({
      id: "30002",
      filename: "other.dat",
      mimeType: "application/octet-stream",
      size: 3,
      created: "2026-01-01T00:00:00.000Z",
    });
    issue.fields.attachment?.push({
      id: "30003",
      filename: "third.dat",
      mimeType: "application/octet-stream",
      size: 3,
      created: "2026-01-01T00:00:00.000Z",
    });
    const initial = createJiraMigrationLedger({
      jiraCloudId: "cloud-1",
      targetVault: "isolated",
    });
    const base = {
      jiraCloudId: "cloud-1",
      issue,
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([], false, false, true),
      target: state.target,
      ledger: initial,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
    };
    const dryRun = await importJiraRelatedData({
      ...base,
      mode: "dry-run",
    });
    expect(dryRun.report.failures).toEqual([]);
    expect(dryRun.report.media).toMatchObject({
      total: 2,
      rewritten: 2,
      unresolved: 0,
    });
    expect(dryRun.report.media.by_strategy.rendered_element).toBe(1);
    expect(state.comments.size).toBe(0);

    const applied = await importJiraRelatedData({ ...base, mode: "apply" });
    expect(applied.report.failures).toEqual([]);
    expect(state.comments.size).toBe(2);
    expect(
      [...state.comments.values()].some((comment) =>
        comment.body.includes("akb://isolated/"),
      ),
    ).toBe(true);
  });

  it("isolates a remote-link catalog read failure from comments, attachments, and standard links", async () => {
    const state = makeTarget();
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
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

  it("keeps explicit and content-derived remote-link identities disjoint", async () => {
    const state = makeTarget();
    const client = makeClient([]);
    const object = {
      url: "https://example.com/collision-proof",
      title: "Collision proof",
    };
    const digest = fingerprintJiraState({
      application: null,
      object,
      relationship: null,
    });
    client.listRemoteLinks = async () => ({
      items: [{ globalId: `content-sha256:${digest}`, object }, { object }],
      rateLimit: {
        limit: null,
        remaining: null,
        reset: null,
        nearLimit: false,
        retryAfterSeconds: null,
      },
      raw: null,
    });
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
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
    expect(result.report.remote_links.applied).toBe(2);
    expect(
      [...state.refs.keys()].filter((key) => key.startsWith("jira-remote:")),
    ).toHaveLength(2);
  });

  it("does not confirm a relation binding until target readback succeeds", async () => {
    const state = makeTarget();
    state.target.readRelation = async () => null;
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([]),
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
    expect(result.report.links.applied).toBe(0);
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({ source_kind: "link", phase: "readback" }),
    );
    expect(
      result.ledger.bindings.some(
        (binding) => binding.entity_kind === "relation",
      ),
    ).toBe(false);
  });

  it("removes provisional refs from both endpoint views when a link resolves", async () => {
    const state = makeTarget();
    const provisional = (reefId: string) => ({
      reefId,
      ref: {
        type: "jira" as const,
        ref: reefId,
        label: "Jira issue link",
      },
      provenance: {
        source: "jira",
        link_id: "40001",
        unresolved: true,
      },
    });
    const currentKey = "jira-link:cloud-1:10001:40001";
    const otherKey = "jira-link:cloud-1:10002:40001";
    await state.target.putExternalRef({
      idempotencyKey: currentKey,
      ...provisional("REEF-1"),
    });
    await state.target.putExternalRef({
      idempotencyKey: otherKey,
      ...provisional("REEF-2"),
    });
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([]),
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [
        {
          typeId: "1",
          kind: "directional" as const,
          outwardRelation: "depends_on" as const,
          inwardRelation: "blocks" as const,
        },
      ],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(await state.target.readExternalRef(currentKey)).toBeNull();
    expect(await state.target.readExternalRef(otherKey)).toBeNull();

    await state.target.putExternalRef({
      idempotencyKey: otherKey,
      ...provisional("REEF-2"),
    });
    const rerun = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
    });
    expect(rerun.report.links.skipped).toBe(1);
    expect(await state.target.readExternalRef(otherKey)).toBeNull();
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
      legacyPlaceholder: "legacy-placeholder",
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
    expect(
      resolveJiraMediaReference(
        { ...media, mediaType: "link" },
        [{ source: source("1", "a.bin"), fileUri: "akb://v/file/1" }],
        "",
      ),
    ).toBeNull();
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" href="/attachment/1/a.bin"></span><span data-media-services-id="m1" href="/attachment/2/b.bin"></span>',
      ),
    ).toBeNull();
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
