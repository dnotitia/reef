import { describe, expect, it, vi } from "vitest";
import { createJiraAccountMappingArtifact } from "../accounts/mapping.js";
import { convertAdfToMarkdown } from "../content/adf.js";
import { createJiraMigrationLedger } from "../ledger.js";
import { importJiraRelatedData } from "./import.js";
import {
  attachmentPolicy,
  issueFixture,
  makeClient,
  makeTarget,
  replyId,
  rootId,
} from "./importTestSupport.js";

describe("Jira related-data import stage", () => {
  it("approval-binds fallback attachment activity actor repairs and converges", async () => {
    const requests: string[] = [];
    const state = makeTarget();
    const eventKey = "attachment_added:old-row@2025-05-27T21:43:43.262+09:00";
    state.attachmentActivityActors.set(`REEF-1:${eventKey}`, "jira:account-1");
    const accountMapping = createJiraAccountMappingArtifact({
      jiraCloudId: "cloud-1",
      overrides: {
        "account-1": { actor: "hongchan", reason: "reviewed membership" },
      },
    });
    const base = {
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient(requests),
      target: state.target,
      accountMapping,
      actorDirectory: [
        { actor: "reef-directory-actor", emailAddress: "directory-key-1" },
      ],
      linkMappings: [] as const,
      resolveIssueTarget: () => null,
      now: () => "2026-01-02T00:00:00.000Z",
    };
    const initial = createJiraMigrationLedger({
      jiraCloudId: "cloud-1",
      targetVault: "isolated",
    });

    const dryRun = await importJiraRelatedData({
      ...base,
      ledger: initial,
      mode: "dry-run",
    });
    expect(state.attachmentActivityActors.get(`REEF-1:${eventKey}`)).toBe(
      "jira:account-1",
    );
    expect(dryRun.report.operations).toContainEqual(
      expect.objectContaining({
        kind: "reconcile_attachment_activity_actor",
      }),
    );

    const applied = await importJiraRelatedData({
      ...base,
      ledger: initial,
      mode: "apply",
      approvedOperations: dryRun.report.operations,
    });
    expect(applied.report.failures).toEqual([]);
    expect(state.attachmentActivityActors.get(`REEF-1:${eventKey}`)).toBe(
      "hongchan",
    );

    const converged = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      mode: "dry-run",
    });
    expect(converged.report.operations).not.toContainEqual(
      expect.objectContaining({
        kind: "reconcile_attachment_activity_actor",
      }),
    );
  });

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

    const missingDescriptionRead = vi.fn(async () => {
      throw new Error("issue_not_created");
    });
    const plannedCreate = await importJiraRelatedData({
      ...base,
      target: {
        ...state.target,
        readDescription: missingDescriptionRead,
      },
      plannedDescription: state.description,
      ledger: initial,
      mode: "dry-run",
    });
    expect(missingDescriptionRead).not.toHaveBeenCalled();
    expect(plannedCreate.report.failures).not.toContainEqual(
      expect.objectContaining({ source_kind: "media" }),
    );
    expect(plannedCreate.report.operations).toContainEqual(
      expect.objectContaining({ kind: "update_description" }),
    );

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
    expect(dry.report.operations.map((operation) => operation.kind)).toEqual(
      expect.arrayContaining([
        "create_attachment",
        "update_description",
        "create_comment",
        "put_relation",
        "put_external_ref",
      ]),
    );
    await expect(
      importJiraRelatedData({
        ...base,
        ledger: dry.ledger,
        mode: "apply",
        approvedOperations: dry.report.operations.filter(
          ({ kind }) => kind === "create_attachment",
        ),
      }),
    ).rejects.toThrow("related_operation_not_approved");
    expect(
      state.comments.size +
        state.attachments.size +
        state.relations.size +
        state.refs.size,
    ).toBe(0);
    await expect(
      importJiraRelatedData({
        ...base,
        ledger: dry.ledger,
        mode: "apply",
        approvedOperations: [],
      }),
    ).rejects.toThrow("related_operation_not_approved");
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
      approvedOperations: dry.report.operations,
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
    await expect(
      importJiraRelatedData({
        ...base,
        ledger: applied.ledger,
        mode: "apply",
        approvedOperations: dry.report.operations,
      }),
    ).rejects.toThrow("related_operation_not_approved:revoke_attachment");
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
    expect(rerun.report.media.description_updated).toBe(false);
    expect(
      rerun.report.operations.some(
        (operation) => operation.kind === "update_description",
      ),
    ).toBe(false);
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
    const mimeDry = await importJiraRelatedData({
      ...base,
      ledger: rerun.ledger,
      mode: "dry-run",
    });
    expect(mimeDry.report.failures).toEqual([]);
    expect(
      mimeDry.report.operations.map((operation) => operation.kind),
    ).toEqual(
      expect.arrayContaining(["revoke_attachment", "create_attachment"]),
    );
    const mimeRerun = await importJiraRelatedData({
      ...base,
      ledger: rerun.ledger,
      mode: "apply",
      approvedOperations: mimeDry.report.operations,
    });
    expect(mimeRerun.report.attachments.skipped).toBe(0);
    expect(mimeRerun.report.attachments.created).toBe(1);
    expect(mimeRerun.report.failures).toEqual([]);
    expect(state.attachments.size).toBe(1);
    expect([...state.attachments.values()][0]?.attachment.mime_type).toBe(
      "application/octet-stream",
    );
    if (sourceAttachment)
      sourceAttachment.mimeType = "application/octet-stream";

    const remapped = await importJiraRelatedData({
      ...base,
      ledger: mimeRerun.ledger,
      linkMappings: [{ typeId: "1", kind: "symmetric" as const }],
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
      ledger: externalized.ledger,
      mode: "apply",
    });
    expect(corruptRerun.report.attachments.skipped).toBe(0);
    expect(corruptRerun.report.attachments.created).toBe(1);
    expect(corruptRerun.report.failures).toEqual([]);
    expect(state.description).not.toContain(storedUri);
    expect(state.description).not.toBe(preservedDescription);
    expect([...state.attachments.values()][0]?.bytes).toEqual(
      new Uint8Array([1, 2, 3]),
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

  it("maps ADF mentions inside comments through the Jira account resolver", async () => {
    const state = makeTarget();
    const mentionBody = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { id: "acct-1", text: "@Mapped User" },
            },
            { type: "text", text: " and " },
            {
              type: "mention",
              attrs: { id: "acct-unmapped", text: "@Private User" },
            },
          ],
        },
      ],
    };
    const applied = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([], false, false, false, false, false, mentionBody),
      target: state.target,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
        overrides: { "acct-1": { actor: "reef-alice" } },
      }),
      memberActors: ["reef-alice"],
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply",
    });

    expect(applied.report.failures).toEqual([]);
    expect(state.comments.get(rootId)?.body).toBe(
      "@{reef-alice} and @jira\\-user",
    );
    expect(state.comments.get(rootId)?.body).not.toContain("Private User");
    expect(state.comments.get(rootId)?.mention_recipients).toEqual([
      "reef-alice",
    ]);

    const legacy = state.comments.get(rootId);
    if (!legacy) throw new Error("expected imported mention comment");
    state.comments.set(rootId, {
      ...legacy,
      body: "@reef\\-alice and @jira\\-user",
      mention_recipients: [],
    });
    const reconciled = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([], false, false, false, false, false, mentionBody),
      target: state.target,
      ledger: applied.ledger,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
        overrides: { "acct-1": { actor: "reef-alice" } },
      }),
      memberActors: ["reef-alice"],
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply",
    });
    expect(reconciled.report.comments).toMatchObject({
      created: 0,
      updated: 1,
      skipped: 1,
    });
    expect(state.comments.get(rootId)?.body).toBe(
      "@{reef-alice} and @jira\\-user",
    );
    expect(state.comments.get(rootId)?.mention_recipients).toEqual([
      "reef-alice",
    ]);
  });

  it("fails closed for an unresolved plain-text mention before target mutation", async () => {
    const state = makeTarget();
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient(
        [],
        false,
        false,
        false,
        false,
        false,
        "hello @missing",
      ),
      target: state.target,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      memberActors: ["allowed"],
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply",
    });

    expect(state.comments.size).toBe(0);
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({
        source_kind: "comment",
        phase: "resolve",
        reason: "comment_import_failed",
      }),
    );
  });

  it("does not serialize a mapped non-member or its source identity", async () => {
    const state = makeTarget();
    const mentionBody = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: {
                id: "acct-private-123",
                text: "@Private Display Name",
              },
            },
          ],
        },
      ],
    };
    const result = await importJiraRelatedData({
      jiraCloudId: "cloud-1",
      issue: issueFixture(),
      reefId: "REEF-1",
      attachmentPolicy,
      client: makeClient([], false, false, false, false, false, mentionBody),
      target: state.target,
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
        overrides: {
          "acct-private-123": { actor: "private.actor@example.com" },
        },
      }),
      memberActors: ["allowed"],
      linkMappings: [],
      resolveIssueTarget: () => null,
      mode: "apply",
    });

    expect(result.report.failures).toEqual([]);
    expect(state.comments.get(rootId)?.body).toBe("@jira\\-user");
    expect(state.comments.get(rootId)?.mention_recipients).toEqual([]);
    expect(JSON.stringify(result.report)).not.toContain("acct-private-123");
    expect(JSON.stringify(result.report)).not.toContain(
      "private.actor@example.com",
    );
    expect(JSON.stringify(result.report)).not.toContain("Private Display Name");
  });
});
