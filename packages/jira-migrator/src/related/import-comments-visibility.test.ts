import { describe, expect, it } from "vitest";
import { createJiraAccountMappingArtifact } from "../accounts/mapping.js";
import { JIRA_MAX_ATTACHMENT_BUFFER_BYTES } from "../jira/client.js";
import { createJiraMigrationLedger } from "../ledger.js";
import { importJiraRelatedData } from "./import.js";
import {
  attachmentPolicy,
  issueFixture,
  makeClient,
  makeTarget,
  rootId,
} from "./importTestSupport.js";

describe("Jira related-data import stage", () => {
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
        maxBytes: JIRA_MAX_ATTACHMENT_BUFFER_BYTES + 1,
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
});
