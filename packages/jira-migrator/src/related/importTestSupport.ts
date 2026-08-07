import { vi } from "vitest";
import { convertAdfToMarkdown } from "../content/adf.js";
import { JiraReadClient } from "../jira/client.js";
import type { JiraIssuePayload } from "../payloads.js";
import type { JiraRelatedImportTarget } from "./import.js";

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
  rootText: string | Record<string, unknown> = "root",
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
                      : typeof rootText === "string"
                        ? {
                            type: "doc",
                            version: 1,
                            content: [
                              {
                                type: "paragraph",
                                content: [{ type: "text", text: rootText }],
                              },
                            ],
                          }
                        : rootText,
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
  const attachmentActivityActors = new Map<string, string>();
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
        mention_recipients: [...(input.mentionRecipients ?? [])],
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
        mention_recipients: [...(input.mentionRecipients ?? [])],
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
    async listFallbackAttachmentActivityActors(reefId) {
      return [...attachmentActivityActors.entries()]
        .filter(
          ([key, actor]) =>
            key.startsWith(`${reefId}:`) && actor.startsWith("jira:"),
        )
        .map(([key, actor]) => ({
          eventKey: key.slice(reefId.length + 1),
          actor,
        }));
    },
    async readAttachmentActivityActor(reefId, eventKey) {
      return attachmentActivityActors.get(`${reefId}:${eventKey}`) ?? null;
    },
    async reconcileAttachmentActivityActor(input) {
      const key = `${input.reefId}:${input.eventKey}`;
      if (attachmentActivityActors.get(key) !== input.fromActor) {
        throw new Error("attachment_activity_actor_reconcile_mismatch");
      }
      attachmentActivityActors.set(key, input.toActor);
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
    attachmentActivityActors,
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

export {
  attachmentPolicy,
  attachmentRowId,
  issueFixture,
  json,
  makeClient,
  makeTarget,
  replyId,
  rootId,
};
