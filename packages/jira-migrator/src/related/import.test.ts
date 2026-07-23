import { describe, expect, it, vi } from "vitest";
import { createJiraAccountMappingArtifact } from "../accounts/mapping.js";
import { convertAdfToMarkdown } from "../content/adf.js";
import { fingerprintJiraState } from "../execution/diff.js";
import { JiraReadClient } from "../jira/client.js";
import { createJiraMigrationLedger } from "../ledger.js";
import type {
  JiraIssuePayload,
  NormalizedJiraAttachment,
} from "../payloads.js";
import {
  type JiraRelatedImportTarget,
  canonicalizeJiraRelation,
  importJiraRelatedData,
  resolveJiraMediaReference,
} from "./import.js";

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
  rootText = "root",
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
                              content: [{ type: "text", text: rootText }],
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
  let nextFileId = 30001;
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
    async updateComment(id, input) {
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
    async deleteComment(id) {
      comments.delete(id);
    },
    async createAttachment(input) {
      const file_uri = `akb://isolated/coll/files/file/${nextFileId++}`;
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
    async findAttachmentByJiraId(reefId, jiraCloudId, jiraAttachmentId) {
      return (
        [...attachments.values()].find(
          ({ attachment }) =>
            attachment.reef_id === reefId &&
            attachment.meta?.jira_cloud_id === jiraCloudId &&
            attachment.original_jira_attachment_id === jiraAttachmentId,
        ) ?? null
      );
    },
    async revokeAttachment(input) {
      attachments.delete(input.fileUri);
      description = description.split(input.fileUri).join(input.replacement);
      for (const [id, comment] of comments) {
        comments.set(id, {
          ...comment,
          body: comment.body.split(input.fileUri).join(input.replacement),
        });
      }
    },
    async hasMediaReference(_reefId, fileUri) {
      return (
        description.includes(fileUri) ||
        [...comments.values()].some((comment) => comment.body.includes(fileUri))
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
    async listExternalRefKeys(prefix) {
      return [...refs.keys()].filter((key) => key.startsWith(prefix)).sort();
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

    const attachmentCheckpoint = vi.fn(
      async (checkpointLedger: typeof dry.ledger) => {
        expect(
          checkpointLedger.bindings.some(
            (binding) =>
              binding.source_identity.entity_kind === "attachment" &&
              binding.source_identity.attachment_id === "30001",
          ),
        ).toBe(true);
        expect(state.description).not.toContain("akb://isolated/");
      },
    );
    const applied = await importJiraRelatedData({
      ...base,
      ledger: dry.ledger,
      mode: "apply",
      checkpointLedger: attachmentCheckpoint,
    });
    expect(attachmentCheckpoint).toHaveBeenCalledTimes(1);
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

    const [boundUri, boundAttachment] = [...state.attachments.entries()][0];
    if (!boundUri || !boundAttachment)
      throw new Error("expected imported attachment");
    state.attachments.set(boundUri, {
      ...boundAttachment,
      attachment: {
        ...boundAttachment.attachment,
        file_uri: "akb://isolated/coll/files/file/alias",
      },
    });
    const uriMismatch = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      mode: "apply",
    });
    expect(uriMismatch.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "attachment",
        phase: "readback",
      }),
    );
    state.attachments.set(boundUri, boundAttachment);

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
    const externalized = await importJiraRelatedData({
      ...base,
      ledger: remapped.ledger,
      linkMappings: [],
      mode: "apply",
    });
    expect(externalized.report.links.unresolved).toBe(1);
    expect(state.relations.size).toBe(0);
    expect(
      externalized.ledger.bindings.some(
        (binding) => binding.entity_kind === "relation",
      ),
    ).toBe(false);

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
    expect(result.report.media.description_updated).toBe(true);
    expect(state.description).toContain("akb://isolated/");
  });

  it("updates an edited Jira comment in place and then reruns idempotently", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      client: makeClient([]),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });

    const updated = await importJiraRelatedData({
      ...base,
      client: makeClient([], false, false, false, false, false, "edited root"),
      ledger: applied.ledger,
    });
    expect(updated.report.comments).toMatchObject({ updated: 1, skipped: 1 });
    expect(state.comments.get(rootId)).toMatchObject({
      id: rootId,
      body: "edited root",
    });

    const rerun = await importJiraRelatedData({
      ...base,
      client: makeClient([], false, false, false, false, false, "edited root"),
      ledger: updated.ledger,
    });
    expect(rerun.report.comments).toMatchObject({ updated: 0, skipped: 2 });
    expect(state.comments.size).toBe(2);
  });

  it("dry-runs a stale threaded root with a synthetic replacement parent", async () => {
    const state = makeTarget();
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
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
    };
    const applied = await importJiraRelatedData({
      ...base,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
      mode: "apply",
    });
    state.comments.delete(rootId);
    const dry = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(dry.report.comments.updated).toBe(2);
    expect(dry.report.failures).not.toContainEqual(
      expect.objectContaining({ reason: "comment_import_failed" }),
    );
  });

  it("keeps an unknown comment commit discoverable until visibility revocation", async () => {
    const state = makeTarget();
    const createComment = state.target.createComment.bind(state.target);
    const deleteComment = state.target.deleteComment.bind(state.target);
    state.target.createComment = async (input) => {
      await createComment(input);
      throw new Error("simulated_unknown_commit");
    };
    state.target.deleteComment = async () => {
      throw new Error("simulated_rollback_failure");
    };
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const failed = await importJiraRelatedData({
      ...base,
      client: makeClient([]),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(state.comments.size).toBe(2);
    expect(
      failed.ledger.bindings.some(
        (binding) => binding.entity_kind === "comment",
      ),
    ).toBe(true);
    expect(failed.report.failures).toContainEqual(
      expect.objectContaining({ reason: "comment_import_failed" }),
    );

    state.target.deleteComment = deleteComment;
    const revoked = await importJiraRelatedData({
      ...base,
      client: makeClient([], false, false, false, true),
      ledger: failed.ledger,
    });
    expect(state.comments.size).toBe(0);
    expect(
      revoked.ledger.bindings.some(
        (binding) => binding.entity_kind === "comment",
      ),
    ).toBe(false);
    expect(revoked.ledger.comment_quarantines).toHaveLength(2);
  });

  it("refreshes ledger fingerprints after an unknown comment update commit", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      client: makeClient([]),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    const updateComment = state.target.updateComment.bind(state.target);
    state.target.updateComment = async (id, input) => {
      await updateComment(id, input);
      throw new Error("simulated_unknown_update_commit");
    };
    const failed = await importJiraRelatedData({
      ...base,
      client: makeClient([], false, false, false, false, false, "edited root"),
      ledger: applied.ledger,
    });
    expect(failed.report.failures).toContainEqual(
      expect.objectContaining({ reason: "comment_import_failed" }),
    );
    state.target.updateComment = updateComment;

    const recovered = await importJiraRelatedData({
      ...base,
      client: makeClient([], false, false, false, false, false, "edited root"),
      ledger: failed.ledger,
    });
    const originalRootBinding = applied.ledger.bindings.find(
      (binding) =>
        binding.entity_kind === "comment" &&
        binding.source_identity.entity_kind === "comment" &&
        binding.source_identity.comment_id === "50001",
    );
    const recoveredRootBinding = recovered.ledger.bindings.find(
      (binding) =>
        binding.entity_kind === "comment" &&
        binding.source_identity.entity_kind === "comment" &&
        binding.source_identity.comment_id === "50001",
    );
    expect(recovered.report.comments.skipped).toBe(2);
    expect(recoveredRootBinding?.source_fingerprint).not.toBe(
      originalRootBinding?.source_fingerprint,
    );
    expect(state.comments.get(rootId)?.body).toBe("edited root");
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
        "attachment_visibility_unverifiable",
        "comment_parent_unresolved",
      ]),
    );
    expect(result.report.links.unresolved).toBe(1);
    expect(state.refs.size).toBeGreaterThan(0);
  });

  it("does not publish restricted comments or attachments with unverifiable visibility", async () => {
    const requests: string[] = [];
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      client: makeClient(requests),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(state.comments.size).toBe(2);
    expect(state.attachments.size).toBe(1);
    const duplicateId = "44444444-4444-4444-8444-444444444444";
    const rootComment = state.comments.get(rootId);
    if (!rootComment) throw new Error("expected imported root comment");
    const duplicate = { ...rootComment, id: duplicateId };
    state.comments.set(duplicateId, duplicate);
    state.target.findCommentByIdempotencyKey = async () => duplicate;
    const dryRestricted = await importJiraRelatedData({
      ...base,
      client: makeClient([], false, false, false, true),
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(dryRestricted.report.failures).toContainEqual(
      expect.objectContaining({ reason: "comment_parent_unresolved" }),
    );
    expect(dryRestricted.report.comments.skipped).toBe(0);
    const deleteComment = state.target.deleteComment.bind(state.target);
    state.target.deleteComment = async (commentId) => {
      if (
        [...state.comments.values()].some(
          (comment) => comment.parent_comment_id === commentId,
        )
      )
        throw new Error("comment_has_replies");
      await deleteComment(commentId);
    };
    requests.length = 0;

    const result = await importJiraRelatedData({
      ...base,
      attachmentPolicy: {
        commentVisibilityCompleteness: "verified",
        maxBytes: 256 * 1024 * 1024 + 1,
      },
      client: makeClient(requests, false, false, false, true),
      ledger: applied.ledger,
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

  it("fails closed on conflicting duplicate comment ids", async () => {
    const state = makeTarget();
    const client = makeClient([]);
    const body = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "duplicate" }],
        },
      ],
    };
    client.readComments = async () => ({
      items: [
        { id: "50001", body, properties: [] },
        {
          id: "50001",
          body: {
            ...body,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "conflicting duplicate" }],
              },
            ],
          },
          properties: [],
        },
      ],
      pages: [],
      rateLimits: [],
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
    expect(state.comments.size).toBe(0);
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({ reason: "jira_comment_duplicate_conflict" }),
    );
    client.readComments = async () => ({
      items: [],
      pages: [],
      rateLimits: [],
    });
    const repeated = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client,
      target: state.target,
      ledger: result.ledger,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply",
    });
    expect(state.attachments.size).toBe(0);
    expect(repeated.ledger.comment_quarantines).toHaveLength(1);
  });

  it("revokes imported comments omitted from a later readable catalog", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      client: makeClient([]),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(state.comments.size).toBe(2);
    expect(state.attachments.size).toBe(1);

    const deleteComment = state.target.deleteComment.bind(state.target);
    state.target.deleteComment = async (commentId) => {
      if (
        [...state.comments.values()].some(
          (comment) => comment.parent_comment_id === commentId,
        )
      )
        throw new Error("comment_has_replies");
      await deleteComment(commentId);
    };

    const filteredClient = makeClient([]);
    filteredClient.readComments = async () => ({
      items: [],
      pages: [],
      rateLimits: [],
    });
    const filteredIssue = issueFixture();
    const approvedCommentBindings = applied.ledger.bindings.filter(
      (binding) => binding.source_identity.entity_kind === "comment",
    );
    const driftedLedger = {
      ...applied.ledger,
      bindings: applied.ledger.bindings.map((binding) =>
        binding.source_identity.entity_kind === "comment"
          ? { ...binding, mapped_state_fingerprint: "0".repeat(64) }
          : binding,
      ),
    };
    const drifted = await importJiraRelatedData({
      ...base,
      attachmentPolicy: {
        ...attachmentPolicy,
        approvedCommentBindings,
      },
      issue: filteredIssue,
      client: filteredClient,
      ledger: driftedLedger,
    });
    expect(state.comments.size).toBe(2);
    expect(drifted.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "comment_binding_precondition_failed",
        }),
      ]),
    );

    const dryRun = await importJiraRelatedData({
      ...base,
      issue: filteredIssue,
      client: filteredClient,
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(dryRun.report.deletions).toBe(3);
    expect(state.comments.size).toBe(2);
    expect(state.attachments.size).toBe(1);

    const reconciled = await importJiraRelatedData({
      ...base,
      issue: filteredIssue,
      client: filteredClient,
      ledger: applied.ledger,
    });
    expect(state.comments.size).toBe(0);
    expect(state.attachments.size).toBe(0);
    expect(
      reconciled.ledger.bindings.some(
        (binding) => binding.entity_kind === "comment",
      ),
    ).toBe(false);
    expect(reconciled.ledger.comment_quarantines).toHaveLength(2);
    expect(reconciled.report.deletions).toBe(3);
    expect(
      reconciled.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(false);
    const repeated = await importJiraRelatedData({
      ...base,
      issue: filteredIssue,
      client: filteredClient,
      ledger: reconciled.ledger,
    });
    expect(state.attachments.size).toBe(0);
    expect(repeated.report.failures).toContainEqual(
      expect.objectContaining({ reason: "attachment_visibility_unverifiable" }),
    );
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

  it("recovers an attachment committed before the target reports failure", async () => {
    const state = makeTarget();
    const createAttachment = state.target.createAttachment.bind(state.target);
    state.target.createAttachment = async (input) => {
      await createAttachment(input);
      throw new Error("simulated_unknown_commit");
    };
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
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply",
    });
    expect(result.report.failures).toEqual([]);
    expect(result.report.attachments.created).toBe(1);
    expect(state.attachments.size).toBe(1);
    expect(
      result.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(true);
  });

  it("does not treat an omitted attachment field as an empty catalog", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([]),
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      issue: issueFixture(),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    const partialSource = issueFixture();
    const { attachment: omittedAttachments, ...partialFields } =
      partialSource.fields;
    expect(omittedAttachments).toBeDefined();
    const partialIssue = { ...partialSource, fields: partialFields };
    const partial = await importJiraRelatedData({
      ...base,
      issue: partialIssue,
      ledger: applied.ledger,
    });
    expect(state.attachments.size).toBe(1);
    expect(
      partial.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(true);
    expect(partial.report.failures).not.toContainEqual(
      expect.objectContaining({
        reason: "attachment_source_reconciliation_failed",
      }),
    );
  });

  it("reconciles an explicitly missing attachment despite an invalid byte policy", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      reefId: "REEF-1",
      client: makeClient([]),
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      issue: issueFixture(),
      attachmentPolicy,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    const withoutAttachments = issueFixture();
    withoutAttachments.fields.attachment = [];
    const reconciled = await importJiraRelatedData({
      ...base,
      issue: withoutAttachments,
      attachmentPolicy: {
        commentVisibilityCompleteness: "verified",
        maxBytes: 256 * 1024 * 1024 + 1,
      },
      ledger: applied.ledger,
    });
    expect(state.attachments.size).toBe(0);
    expect(
      reconciled.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(false);
  });

  it("does not revoke a recovered attachment owned by another Jira cloud", async () => {
    const state = makeTarget();
    await state.target.createAttachment({
      idempotencyKey: "other-cloud-attachment",
      reefId: "REEF-1",
      filename: "sample.dat",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([1, 2, 3]),
      author: "jira-import",
      createdAt: "2026-01-01T00:00:00.000Z",
      originalJiraAttachmentId: "30001",
      meta: { source: "jira", jira_cloud_id: "cloud-2" },
    });
    await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
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
    expect(state.attachments.size).toBe(1);
    expect([...state.attachments.values()][0]?.attachment.meta).toMatchObject({
      jira_cloud_id: "cloud-2",
    });
  });

  it("revokes an imported attachment when the byte policy is lowered", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      client: makeClient([]),
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      attachmentPolicy,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(state.attachments.size).toBe(1);
    const originalFileUri = [...state.attachments.keys()][0];
    expect(originalFileUri).toBeDefined();

    const invalidPolicy = await importJiraRelatedData({
      ...base,
      attachmentPolicy: {
        commentVisibilityCompleteness: "verified",
        maxBytes: 256 * 1024 * 1024 + 1,
      },
      ledger: applied.ledger,
    });
    expect(invalidPolicy.report.failures).toContainEqual(
      expect.objectContaining({ reason: "attachment_size_policy_invalid" }),
    );
    expect(state.attachments.size).toBe(1);
    expect(
      invalidPolicy.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(true);

    const dryRestricted = await importJiraRelatedData({
      ...base,
      attachmentPolicy: {
        commentVisibilityCompleteness: "verified",
        maxBytes: 2,
      },
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(dryRestricted.report.deletions).toBe(1);
    expect(state.attachments.size).toBe(1);

    const restricted = await importJiraRelatedData({
      ...base,
      attachmentPolicy: {
        commentVisibilityCompleteness: "verified",
        maxBytes: 2,
      },
      ledger: applied.ledger,
    });
    expect(restricted.report.failures).toContainEqual(
      expect.objectContaining({ reason: "attachment_size_limit_exceeded" }),
    );
    expect(state.attachments.size).toBe(0);
    expect(state.description).not.toContain(originalFileUri);
    expect(
      restricted.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(false);
    expect(restricted.report.deletions).toBe(1);

    const restored = await importJiraRelatedData({
      ...base,
      attachmentPolicy,
      ledger: restricted.ledger,
    });
    expect(restored.report.failures).toEqual([]);
    expect(state.attachments.size).toBe(1);
    const replacementFileUri = [...state.attachments.keys()][0];
    expect(replacementFileUri).not.toBe(originalFileUri);
    expect(state.description).toContain(replacementFileUri);
    expect(state.description).not.toContain("jira-attachment-revoked:");
  });

  it("restores one revoked medium beside another live attachment", async () => {
    const state = makeTarget();
    const sourceIssue = issueFixture();
    sourceIssue.fields.attachment?.push({
      id: "30002",
      filename: "second.dat",
      mimeType: "application/octet-stream",
      size: 3,
    });
    sourceIssue.fields.description = {
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
        {
          type: "mediaSingle",
          content: [
            {
              type: "media",
              attrs: { id: "media-2", type: "file", alt: "second.dat" },
            },
          ],
        },
      ],
    };
    sourceIssue.renderedFields = {
      description:
        '<span data-media-services-id="media-1" href="/attachment/30001/sample.dat"></span>\n<span data-media-services-id="media-2" href="/attachment/30002/second.dat"></span>',
    };
    state.description = convertAdfToMarkdown(
      sourceIssue.fields.description,
    ).markdown;
    const base = {
      jiraCloudId: "cloud-1",
      reefId: "REEF-1",
      client: makeClient([]),
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      issue: sourceIssue,
      attachmentPolicy,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(applied.report.failures).toEqual([]);
    expect(state.attachments.size).toBe(2);

    const restrictedIssue = structuredClone(sourceIssue);
    const restrictedAttachment = restrictedIssue.fields.attachment?.[1];
    if (restrictedAttachment) restrictedAttachment.size = 4;
    const restricted = await importJiraRelatedData({
      ...base,
      issue: restrictedIssue,
      attachmentPolicy: {
        commentVisibilityCompleteness: "verified",
        maxBytes: 3,
      },
      ledger: applied.ledger,
    });
    expect(state.attachments.size).toBe(1);
    expect(state.description).toContain("akb://isolated/");
    expect(state.description).toContain("jira-attachment-revoked:");

    const restored = await importJiraRelatedData({
      ...base,
      issue: sourceIssue,
      attachmentPolicy,
      ledger: restricted.ledger,
    });
    expect(restored.report.failures).toEqual([]);
    expect(state.attachments.size).toBe(2);
    expect(state.description).not.toContain("jira-attachment-revoked:");
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
    expect(dryRun.report.media.by_strategy.rendered_element).toBe(2);
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

  it("isolates target external-ref catalog failures from sibling entities", async () => {
    const state = makeTarget();
    state.target.listExternalRefKeys = async () => {
      throw new Error("target_catalog_unavailable");
    };
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
      linkMappings: [{ typeId: "1", kind: "symmetric" }],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply",
    });
    expect(result.report.failures.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        "link_target_catalog_read_failed",
        "remote_link_target_catalog_read_failed",
      ]),
    );
    expect(state.comments.size).toBe(2);
    expect(state.attachments.size).toBe(1);
    expect(state.relations.size).toBe(1);
    expect(state.refs.size).toBe(2);
  });

  it("isolates ambiguous link mappings instead of using array order", async () => {
    const state = makeTarget();
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
      linkMappings: [{ typeId: "1", kind: "symmetric" }],
    });
    expect(state.relations.size).toBe(1);

    const result = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      linkMappings: [
        { typeId: "1", kind: "symmetric" },
        {
          typeId: "1",
          kind: "directional",
          outwardRelation: "depends_on",
          inwardRelation: "blocks",
        },
      ],
    });
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({ reason: "jira_link_mapping_ambiguous" }),
    );
    expect(state.relations.size).toBe(0);
    expect(
      result.ledger.bindings.some(
        (binding) => binding.entity_kind === "relation",
      ),
    ).toBe(false);
    expect(result.report.links.unresolved).toBe(1);
  });

  it("isolates conflicting duplicate Jira link ids", async () => {
    const state = makeTarget();
    const issue = issueFixture();
    const conflicting = issue.fields.issuelinks?.[1];
    if (conflicting?.outwardIssue)
      conflicting.outwardIssue = { id: "10003", key: "DEMO-3" };
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue,
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
      linkMappings: [{ typeId: "1", kind: "symmetric" }],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply",
    });
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({ reason: "jira_link_duplicate_conflict" }),
    );
    expect(state.relations.size).toBe(0);
  });

  it("removes a relation whose Jira link disappears from an explicit catalog", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([]),
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [{ typeId: "1", kind: "symmetric" as const }],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      issue: issueFixture(),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(state.relations.size).toBe(1);
    const withoutLinks = issueFixture();
    withoutLinks.fields.issuelinks = [];
    const dryRun = await importJiraRelatedData({
      ...base,
      issue: withoutLinks,
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(dryRun.report.deletions).toBe(1);
    expect(state.relations.size).toBe(1);
    const reconciled = await importJiraRelatedData({
      ...base,
      issue: withoutLinks,
      ledger: applied.ledger,
    });
    expect(reconciled.report.deletions).toBe(1);
    expect(state.relations.size).toBe(0);
    expect(
      reconciled.ledger.bindings.some(
        (binding) => binding.entity_kind === "relation",
      ),
    ).toBe(false);
  });

  it("preserves a source-owned relation when the other endpoint has an empty catalog", async () => {
    const state = makeTarget();
    const client = makeClient([]);
    const base = {
      jiraCloudId: "cloud-1",
      attachmentPolicy,
      client,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [{ typeId: "1", kind: "symmetric" as const }],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply" as const,
    };
    const sourceIssue = issueFixture();
    sourceIssue.fields.issuelinks = sourceIssue.fields.issuelinks?.map(
      (link) =>
        link.outwardIssue
          ? { ...link, outwardIssue: { key: link.outwardIssue.key } }
          : link,
    );
    const applied = await importJiraRelatedData({
      ...base,
      issue: sourceIssue,
      reefId: "REEF-1",
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(state.relations.size).toBe(1);
    client.readComments = async () => ({
      items: [],
      pages: [],
      rateLimits: [],
    });
    const otherEndpoint = issueFixture();
    otherEndpoint.id = "10002";
    otherEndpoint.key = "DEMO-2";
    otherEndpoint.fields.attachment = [];
    otherEndpoint.fields.issuelinks = [];
    otherEndpoint.fields.description = null;
    await importJiraRelatedData({
      ...base,
      issue: otherEndpoint,
      reefId: "REEF-2",
      ledger: applied.ledger,
    });
    expect(state.relations.size).toBe(1);
  });

  it("removes a provisional ref whose standard link disappears", async () => {
    const state = makeTarget();
    const base = {
      jiraCloudId: "cloud-1",
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([]),
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      mode: "apply" as const,
    };
    const applied = await importJiraRelatedData({
      ...base,
      issue: issueFixture(),
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    expect(
      [...state.refs.keys()].some((key) => key.startsWith("jira-link:")),
    ).toBe(true);
    const withoutLinks = issueFixture();
    withoutLinks.fields.issuelinks = [];
    const dryRun = await importJiraRelatedData({
      ...base,
      issue: withoutLinks,
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(dryRun.report.deletions).toBe(1);
    expect(
      [...state.refs.keys()].some((key) => key.startsWith("jira-link:")),
    ).toBe(true);
    await importJiraRelatedData({
      ...base,
      issue: withoutLinks,
      ledger: applied.ledger,
    });
    expect(
      [...state.refs.keys()].some((key) => key.startsWith("jira-link:")),
    ).toBe(false);
  });

  it("removes remote refs that disappear from a successful catalog", async () => {
    const state = makeTarget();
    const client = makeClient([]);
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [{ typeId: "1", kind: "symmetric" as const }],
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
    expect(state.refs.size).toBe(2);
    client.listRemoteLinks = async () => ({
      items: [{ globalId: "remote-1", object: { title: "Reference" } }],
      rateLimit: {
        limit: null,
        remaining: null,
        reset: null,
        nearLimit: false,
        retryAfterSeconds: null,
      },
      raw: [],
    });
    const dryRun = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(dryRun.report.deletions).toBe(2);
    expect(state.refs.size).toBe(2);
    const malformed = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
    });
    expect(malformed.report.deletions).toBe(2);
    expect(state.refs.size).toBe(0);
    expect(malformed.report.failures).toContainEqual(
      expect.objectContaining({ reason: "remote_link_url_missing" }),
    );
    client.listRemoteLinks = async () => ({
      items: [],
      rateLimit: {
        limit: null,
        remaining: null,
        reset: null,
        nearLimit: false,
        retryAfterSeconds: null,
      },
      raw: [],
    });
    await importJiraRelatedData({ ...base, ledger: malformed.ledger });
    expect(state.refs.size).toBe(0);
  });

  it("preserves prototype target methods and their receiver", async () => {
    const state = makeTarget();
    const listExternalRefKeys = vi.fn(function (
      this: { delegate: typeof state.target },
      prefix: string,
    ) {
      return this.delegate.listExternalRefKeys(prefix);
    });
    const target = Object.assign(
      Object.create({ listExternalRefKeys }),
      Object.fromEntries(
        Object.entries(state.target).filter(
          ([key]) => key !== "listExternalRefKeys",
        ),
      ),
      { delegate: state.target },
    ) as typeof state.target;
    const issue = issueFixture();
    issue.fields.issuelinks = [];
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue,
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([]),
      target,
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
    expect(result.report.failures).toEqual([]);
    expect(listExternalRefKeys).toHaveBeenCalled();
  });

  it("rejects non-http remote-link URLs", async () => {
    const state = makeTarget();
    const client = makeClient([]);
    client.listRemoteLinks = async () => ({
      items: [
        {
          globalId: "unsafe-remote",
          object: { url: "javascript:alert(1)", title: "Unsafe" },
        },
      ],
      rateLimit: {
        limit: null,
        remaining: null,
        reset: null,
        nearLimit: false,
        retryAfterSeconds: null,
      },
      raw: [],
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
      linkMappings: [{ typeId: "1", kind: "symmetric" }],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply",
    });
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({ reason: "remote_link_url_invalid" }),
    );
    expect(state.refs.size).toBe(0);
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
    const altOnlyMedia = convertAdfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "media",
          attrs: { id: "m1", type: "file", alt: "a.bin" },
        },
      ],
    }).media[0];
    expect(altOnlyMedia?.filename).toBeNull();
    expect(
      altOnlyMedia
        ? resolveJiraMediaReference(
            altOnlyMedia,
            [
              { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
              { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
            ],
            '<span data-media-services-id="m1" href="/attachment/2/b.bin"></span>',
          )?.binding.source.id
        : null,
    ).toBe("2");
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
        '<span data-media-services-id="m1" title="att1" href="/attachment/2/b.bin"></span>',
      )?.binding.source.id,
    ).toBe("2");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" data-attachment-id="1" href="/attachment/2/b.bin"></span>',
      ),
    ).toBeNull();
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
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        `${"<".repeat(100_000)}><span data-media-services-id="m1" href="/attachment/2/b.bin"></span>`,
      )?.binding.source.id,
    ).toBe("2");
    expect(
      resolveJiraMediaReference(
        { ...media, filename: null },
        [
          { source: source("1", "a.bin"), fileUri: "akb://v/file/1" },
          { source: source("2", "b.bin"), fileUri: "akb://v/file/2" },
        ],
        '<span data-media-services-id="m1" data-media-services-id="m2" href="/attachment/2/b.bin"></span>',
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
