import { describe, expect, it } from "vitest";
import { createJiraAccountMappingArtifact } from "../accounts/mapping.js";
import { convertAdfToMarkdown } from "../content/adf.js";
import { JIRA_MAX_ATTACHMENT_BUFFER_BYTES } from "../jira/client.js";
import { createJiraMigrationLedger } from "../ledger.js";
import { importJiraRelatedData } from "./import.js";
import {
  attachmentPolicy,
  issueFixture,
  makeClient,
  makeTarget,
} from "./importTestSupport.js";

describe("Jira related-data import stage", () => {
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

  it("preserves an existing attachment when completeness attestation is omitted", async () => {
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
    const existingFileUri = [...state.attachments.keys()][0];

    const unverified = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
    });

    expect(state.attachments.has(existingFileUri ?? "")).toBe(true);
    expect(unverified.report.deletions).toBe(0);
    expect(
      unverified.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(true);
    expect(unverified.report.failures).toContainEqual(
      expect.objectContaining({
        reason: "attachment_visibility_unverifiable",
      }),
    );
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

  it("preserves the original readback error when revoking an invalid residual attachment", async () => {
    const state = makeTarget();
    const createAttachment = state.target.createAttachment.bind(state.target);
    state.target.createAttachment = (input) =>
      createAttachment({ ...input, filename: "server-name.dat" });

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

    expect(result.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "attachment",
        reason: "attachment_readback_mismatch:filename",
      }),
    );
    expect(state.attachments.size).toBe(0);
    expect(
      result.ledger.bindings.some(
        (binding) => binding.entity_kind === "attachment",
      ),
    ).toBe(false);
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
        maxBytes: JIRA_MAX_ATTACHMENT_BUFFER_BYTES + 1,
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
        maxBytes: JIRA_MAX_ATTACHMENT_BUFFER_BYTES + 1,
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
});
