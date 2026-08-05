import { extractMentionUsernames, formatMentionToken } from "@reef/core";
import {
  convertAdfToMarkdown,
  createJiraAccountMappingArtifact,
  createJiraMigrationLedger,
  importJiraRelatedData,
  runJiraMigration,
} from "../dist/index.js";

const commentRootId = "11111111-1111-4111-8111-111111111111";
const commentReplyId = "22222222-2222-4222-8222-222222222222";
const attachmentRowId = "33333333-3333-4333-8333-333333333333";
const commentNow = "2026-08-04T00:00:00.000Z";
const commentCloudId = "cloud-contract";
const commentReefId = "CONTRACT-1";
const safeActor = "Alice42";
const spacedActor = "Alice Smith";
const unsafeActor = String.raw`team@ops\blue}`;
const privateActor = "private.actor@example.com";
const privateDisplayName = "Private Display Name";

const mentionNode = (accountId, label) => ({
  type: "mention",
  attrs: { id: accountId, text: `@${label}` },
});

const commentAdf = () => ({
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "email a@b.example " },
        mentionNode("acct-safe", safeActor),
        { type: "text", text: " and " },
        mentionNode("acct-safe", safeActor),
        { type: "text", text: " " },
        mentionNode("acct-space", spacedActor),
        { type: "text", text: " " },
        mentionNode("acct-unsafe", "Display Name"),
        { type: "text", text: " " },
        mentionNode("acct-unmapped", privateDisplayName),
        { type: "text", text: " " },
        mentionNode("acct-nonmember", privateDisplayName),
        { type: "text", text: " " },
        {
          type: "text",
          text: String.raw`\@escaped @inline`,
          marks: [{ type: "code" }],
        },
        { type: "text", text: " " },
        {
          type: "text",
          text: "link @link",
          marks: [{ type: "link", attrs: { href: "https://x.test/@link" } }],
        },
      ],
    },
    {
      type: "mediaSingle",
      content: [
        {
          type: "media",
          attrs: { id: "comment-media", type: "file", alt: "contract.png" },
        },
      ],
    },
  ],
});

const replyAdf = () => ({
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "thread reply" }],
    },
  ],
});

const plainTextAdf = (text) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const sourceComments = (body = commentAdf()) => [
  {
    id: "comment-root",
    parentId: null,
    body,
    renderedBody:
      '<span data-media-services-id="comment-media" href="/attachment/30001/contract.png">media</span>',
    author: { accountId: "acct-safe" },
    created: "2026-08-03T00:00:00.000Z",
    properties: [],
  },
  {
    id: "comment-reply",
    parentId: "comment-root",
    body: replyAdf(),
    author: { accountId: "acct-safe" },
    created: "2026-08-03T01:00:00.000Z",
    updated: "2026-08-03T01:30:00.000Z",
    properties: [],
  },
];

const commentIssue = (withAttachment = true) => ({
  id: "contract-source-issue",
  key: "CONTRACT-1",
  renderedFields: { description: "" },
  fields: {
    summary: "Public behavior contract",
    project: { id: "contract-project", key: "CONTRACT" },
    description: null,
    attachment: withAttachment
      ? [
          {
            id: "30001",
            filename: "contract.png",
            mimeType: "image/png",
            size: 3,
            created: "2026-08-03T00:00:00.000Z",
            author: { accountId: "acct-safe" },
          },
        ]
      : [],
    issuelinks: [],
  },
});

const accountMapping = (mappedSafeActor = safeActor) =>
  createJiraAccountMappingArtifact({
    jiraCloudId: commentCloudId,
    overrides: {
      "acct-safe": { actor: mappedSafeActor },
      "acct-space": { actor: spacedActor },
      "acct-unsafe": { actor: unsafeActor },
      "acct-nonmember": { actor: privateActor },
    },
  });

const memberActors = (mappedSafeActor = safeActor) => [
  mappedSafeActor,
  spacedActor,
  unsafeActor,
];

const makeCommentTarget = () => {
  const comments = new Map();
  const commentKeys = new Map();
  const attachments = new Map();
  const relations = new Map();
  const externalRefs = new Map();
  let nextFileId = 1;
  let description = "";
  const createdIds = [];
  const updatedIds = [];
  const deletedIds = [];

  const materializeComment = (id, input) => {
    const parent = input.parentCommentId
      ? comments.get(input.parentCommentId)
      : null;
    return {
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
  };

  const target = {
    async createComment(input) {
      const id = input.parentCommentId ? commentReplyId : commentRootId;
      const comment = materializeComment(id, input);
      comments.set(id, comment);
      commentKeys.set(input.idempotencyKey, id);
      createdIds.push(id);
      return comment;
    },
    async updateComment(id, input) {
      const comment = materializeComment(id, input);
      comments.set(id, comment);
      commentKeys.set(input.idempotencyKey, id);
      updatedIds.push(id);
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
      deletedIds.push(id);
    },
    async createAttachment(input) {
      const fileUri = `akb://contract-vault/coll/files/file/${nextFileId++}`;
      const attachment = {
        id: attachmentRowId,
        reef_id: input.reefId,
        file_uri: fileUri,
        filename: input.filename,
        mime_type: input.mimeType,
        size_bytes: input.bytes.byteLength,
        author: input.author,
        created_at: input.createdAt,
        source: "jira_import",
        inline: false,
        original_jira_attachment_id: input.originalJiraAttachmentId,
        meta: input.meta,
      };
      attachments.set(fileUri, { attachment, bytes: input.bytes });
      return attachment;
    },
    async readAttachment(fileUri) {
      return attachments.get(fileUri) ?? null;
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
    async listFallbackAttachmentActivityActors() {
      return [];
    },
    async readAttachmentActivityActor() {
      return null;
    },
    async reconcileAttachmentActivityActor() {},
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
    async putRelation(input) {
      relations.set(input.idempotencyKey, input);
    },
    async hasRelation(key) {
      return relations.has(key);
    },
    async readRelation(key) {
      const value = relations.get(key);
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
    async putExternalRef(input) {
      externalRefs.set(input.idempotencyKey, input);
    },
    async hasExternalRef(key) {
      return externalRefs.has(key);
    },
    async readExternalRef(key) {
      const value = externalRefs.get(key);
      return value
        ? {
            reefId: value.reefId,
            ref: value.ref,
            provenance: value.provenance,
          }
        : null;
    },
    async listExternalRefKeys(prefix) {
      return [...externalRefs.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
    async deleteExternalRef(key) {
      externalRefs.delete(key);
    },
  };

  return {
    target,
    comments,
    attachments,
    createdIds,
    updatedIds,
    deletedIds,
    relations,
    externalRefs,
    get description() {
      return description;
    },
  };
};

const makeCommentClient = (comments) => ({
  async readComments() {
    return { items: comments };
  },
  async listRemoteLinks() {
    return { items: [] };
  },
  async downloadAttachmentContent() {
    return {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      contentLength: 3,
    };
  },
});

const makeCommentInput = ({
  target,
  ledger,
  comments = sourceComments(),
  mappedSafeActor = safeActor,
  mode,
  approvedOperations,
  withAttachment = true,
}) => ({
  jiraCloudId: commentCloudId,
  issue: commentIssue(withAttachment),
  reefId: commentReefId,
  client: makeCommentClient(comments),
  target,
  ledger,
  accountMapping: accountMapping(mappedSafeActor),
  memberActors: memberActors(mappedSafeActor),
  linkMappings: [],
  attachmentPolicy: {
    commentVisibilityCompleteness: "verified",
    maxBytes: 1024,
  },
  resolveIssueTarget: () => null,
  mode,
  now: () => commentNow,
  ...(approvedOperations ? { approvedOperations } : {}),
});

const jsonHasCanary = (value) => {
  const serialized = JSON.stringify(value);
  return [
    "acct-safe",
    "acct-space",
    "acct-unsafe",
    "acct-unmapped",
    "acct-nonmember",
    privateActor,
    privateDisplayName,
  ].some((canary) => serialized.includes(canary));
};

const assertCommentContract = (condition, label) => {
  if (!condition) throw new Error(`comment_contract_failed:${label}`);
};

const summarizeOperations = (operations) =>
  operations.map(({ kind, key_sha256, input_sha256 }) => ({
    kind,
    key_sha256,
    input_sha256,
  }));

const runCommentMentionContract = async () => {
  const initialTarget = makeCommentTarget();
  const initialLedger = createJiraMigrationLedger({
    jiraCloudId: commentCloudId,
    targetVault: "contract-vault",
  });
  const source = sourceComments();
  const conversion = convertAdfToMarkdown(source[0].body, {
    accountMapping: {
      artifact: accountMapping(),
      directory: [],
    },
    memberActors: memberActors(),
  });
  const dry = await importJiraRelatedData(
    makeCommentInput({
      target: initialTarget.target,
      ledger: initialLedger,
      comments: source,
      mode: "dry-run",
    }),
  );
  assertCommentContract(dry.report.failures.length === 0, "dry_run_failures");
  const applied = await importJiraRelatedData(
    makeCommentInput({
      target: initialTarget.target,
      ledger: dry.ledger,
      comments: source,
      mode: "apply",
      approvedOperations: dry.report.operations,
    }),
  );
  assertCommentContract(applied.report.failures.length === 0, "apply_failures");

  const root = initialTarget.comments.get(commentRootId);
  const reply = initialTarget.comments.get(commentReplyId);
  assertCommentContract(
    root !== undefined && reply !== undefined,
    "readback_missing",
  );
  const rootBody = root?.body ?? "";
  const unsafeToken = formatMentionToken(unsafeActor);
  const expectedRecipients = [safeActor, spacedActor, unsafeActor];
  const extractedRecipients = extractMentionUsernames(rootBody);
  const rootJson = JSON.stringify(root);
  const reportJson = JSON.stringify(applied.report);

  const legacyRoot = {
    ...root,
    body: "legacy @Alice42",
    mention_recipients: [],
  };
  initialTarget.comments.set(commentRootId, legacyRoot);
  const reconciled = await importJiraRelatedData(
    makeCommentInput({
      target: initialTarget.target,
      ledger: applied.ledger,
      comments: source,
      mode: "apply",
    }),
  );
  const reconciledRoot = initialTarget.comments.get(commentRootId);
  const repeated = await importJiraRelatedData(
    makeCommentInput({
      target: initialTarget.target,
      ledger: reconciled.ledger,
      comments: source,
      mode: "apply",
    }),
  );

  const unresolvedTarget = makeCommentTarget();
  const unresolved = await importJiraRelatedData(
    makeCommentInput({
      target: unresolvedTarget.target,
      ledger: createJiraMigrationLedger({
        jiraCloudId: commentCloudId,
        targetVault: "contract-vault",
      }),
      comments: [
        {
          id: "comment-unresolved",
          parentId: null,
          body: plainTextAdf("hello @missing"),
          author: { accountId: "acct-safe" },
          created: "2026-08-03T02:00:00.000Z",
          properties: [],
        },
      ],
      mode: "apply",
      withAttachment: false,
    }),
  );

  const changedMappingTarget = makeCommentTarget();
  const changedMapping = await importJiraRelatedData(
    makeCommentInput({
      target: changedMappingTarget.target,
      ledger: initialLedger,
      comments: source,
      mappedSafeActor: "Bob42",
      mode: "dry-run",
    }),
  );
  const aliceCommentOperations = dry.report.operations.filter((operation) =>
    operation.kind.endsWith("_comment"),
  );
  const bobCommentOperations = changedMapping.report.operations.filter(
    (operation) => operation.kind.endsWith("_comment"),
  );
  const approvalTarget = makeCommentTarget();
  let approvalError = null;
  try {
    await importJiraRelatedData(
      makeCommentInput({
        target: approvalTarget.target,
        ledger: initialLedger,
        comments: source,
        mappedSafeActor: "Bob42",
        mode: "apply",
        approvedOperations: dry.report.operations,
      }),
    );
  } catch (error) {
    approvalError = error instanceof Error ? error.message : String(error);
  }

  const repeatedDry = await importJiraRelatedData(
    makeCommentInput({
      target: makeCommentTarget().target,
      ledger: initialLedger,
      comments: source,
      mode: "dry-run",
    }),
  );

  const v1 = {
    observed: true,
    canonical_body: rootBody,
    exact_case_member_tokens:
      rootBody.includes(`@${safeActor}`) &&
      rootBody.includes(formatMentionToken(spacedActor)),
    public_readback: rootJson.includes(`@${safeActor}`),
  };
  const v2 = {
    observed: true,
    unsafe_username: unsafeActor,
    canonical_token: unsafeToken,
    serialized_canonically: rootBody.includes(unsafeToken),
    unbraced_unsafe_token_absent: !rootBody.includes(`@${unsafeActor}`),
  };
  const v3 = {
    observed: true,
    non_identifying_placeholder: "@jira\\-user",
    unmapped_and_non_member_downgraded:
      rootBody.split("@jira\\-user").length - 1 === 2,
    account_identity_absent:
      !rootJson.includes("acct-") && !rootJson.includes(privateActor),
    display_name_absent: !rootJson.includes(privateDisplayName),
    report_redacted:
      !reportJson.includes(privateActor) &&
      !reportJson.includes(privateDisplayName),
    conversion_redacted: !jsonHasCanary(conversion),
  };
  const v4 = {
    observed: true,
    readback_mention_recipients: [...(root?.mention_recipients ?? [])],
    recipients_deduped:
      JSON.stringify(root?.mention_recipients ?? []) ===
      JSON.stringify(expectedRecipients),
    unresolved_failure_closed: unresolved.report.failures.some(
      ({ source_kind, phase, reason }) =>
        source_kind === "comment" &&
        phase === "resolve" &&
        reason === "comment_import_failed",
    ),
    unresolved_no_partial_save:
      unresolvedTarget.comments.size === 0 &&
      unresolvedTarget.attachments.size === 0 &&
      unresolvedTarget.createdIds.length === 0,
  };
  const v5 = {
    observed: true,
    root_target_id_before: commentRootId,
    root_target_id_after: reconciledRoot?.id ?? null,
    legacy_same_target_updated:
      reconciled.report.comments.created === 0 &&
      reconciled.report.comments.updated === 1 &&
      initialTarget.updatedIds.includes(commentRootId),
    identical_rerun_duplicate_zero:
      repeated.report.comments.created === 0 &&
      repeated.report.comments.updated === 0 &&
      repeated.report.comments.skipped === 2,
    stable_binding:
      initialTarget.createdIds.length === 2 &&
      reconciledRoot?.id === commentRootId,
  };
  const v6 = {
    observed: true,
    mixed_markdown_preserved:
      rootBody.includes(String.raw`a@b\.example`) &&
      rootBody.includes("https://x.test/@link") &&
      rootBody.includes("@inline") &&
      rootBody.includes("\\@escaped"),
    markdown_owned_regions_not_mentions:
      !extractedRecipients.includes("inline") &&
      !extractedRecipients.includes("link") &&
      !extractedRecipients.includes("escaped") &&
      [...new Set(extractedRecipients)].join("\u0000") ===
        expectedRecipients.join("\u0000"),
    thread_binding_preserved:
      root?.parent_comment_id === null &&
      root?.thread_root_id === null &&
      reply?.parent_comment_id === commentRootId &&
      reply?.thread_root_id === commentRootId,
    media_binding_preserved:
      applied.report.media.rewritten === 1 &&
      initialTarget.attachments.size === 1 &&
      rootBody.includes("akb://contract-vault/coll/files/file/"),
  };
  const v7 = {
    observed: true,
    report_and_approval_redacted: !jsonHasCanary({
      report: dry.report,
      changed_mapping_report: changedMapping.report,
      approval_error: approvalError,
    }),
    identical_operations_deterministic:
      JSON.stringify(summarizeOperations(dry.report.operations)) ===
      JSON.stringify(summarizeOperations(repeatedDry.report.operations)),
    mapped_state_changes_approval_input:
      JSON.stringify(summarizeOperations(aliceCommentOperations)) !==
      JSON.stringify(summarizeOperations(bobCommentOperations)),
    wrong_approval_rejected_without_mutation:
      approvalError?.startsWith("related_operation_not_approved") === true &&
      approvalTarget.comments.size === 0 &&
      approvalTarget.attachments.size === 0,
  };

  const clauses = { V1: v1, V2: v2, V3: v3, V4: v4, V5: v5, V6: v6, V7: v7 };
  for (const [name, clause] of Object.entries(clauses)) {
    for (const [check, value] of Object.entries(clause)) {
      if (
        check === "observed" ||
        typeof value === "string" ||
        Array.isArray(value)
      )
        continue;
      assertCommentContract(value === true, `${name}.${check}`);
    }
  }

  return {
    required_view: "V1-V7 Jira comment ADF-to-Reef mention behavior",
    required_view_was_exercised: true,
    public_api: [
      "convertAdfToMarkdown",
      "importJiraRelatedData",
      "createJiraMigrationLedger",
      "createJiraAccountMappingArtifact",
    ],
    V1: v1,
    V2: {
      ...v2,
      unsafe_username: "redacted-public-contract-unsafe-actor",
    },
    V3: v3,
    V4: v4,
    V5: v5,
    V6: v6,
    V7: {
      ...v7,
      operations: summarizeOperations(dry.report.operations),
      changed_comment_operations: summarizeOperations(bobCommentOperations),
    },
    evidence: {
      comment_readback: {
        id: root?.id ?? null,
        body: rootBody,
        mention_recipients: [...(root?.mention_recipients ?? [])],
      },
      thread_readback: {
        root_id: root?.id ?? null,
        reply_parent_id: reply?.parent_comment_id ?? null,
        reply_thread_root_id: reply?.thread_root_id ?? null,
      },
      report: {
        apply_comments: applied.report.comments,
        apply_media: applied.report.media,
        legacy_comments: reconciled.report.comments,
        repeated_comments: repeated.report.comments,
      },
      target_mutation_summary: {
        created_comment_ids: [...initialTarget.createdIds],
        updated_comment_ids: [...initialTarget.updatedIds],
        attachment_count: initialTarget.attachments.size,
      },
    },
    all_pass: true,
  };
};

const config = JSON.parse(process.env.REEF_BEHAVIOR_CONFIG ?? "null");
if (!config) throw new Error("behavior_config_missing");

try {
  const commentContract = await runCommentMentionContract();
  const result = await runJiraMigration(config, {
    ...(process.env.REEF_BEHAVIOR_FAIL_AFTER
      ? {
          failAfterConfirmedEntities: Number(
            process.env.REEF_BEHAVIOR_FAIL_AFTER,
          ),
        }
      : {}),
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      run_id: result.runId,
      mode: result.mode,
      plan_sha256: result.planSha256,
      status: result.report.run.status,
      conservation: result.report.conservation,
      totals: result.report.totals,
      comment_contract: commentContract,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      code:
        error && typeof error === "object" && "code" in error
          ? error.code
          : error instanceof Error
            ? error.name
            : "unknown_error",
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}
