import { describe, expect, it } from "vitest";
import { createJiraAccountMappingArtifact } from "../accounts/mapping.js";
import { createJiraMigrationLedger } from "../ledger.js";
import { importJiraRelatedData } from "./import.js";
import {
  attachmentPolicy,
  issueFixture,
  makeClient,
  makeTarget,
} from "./importTestSupport.js";

describe("Jira related-data import stage", () => {
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
    expect(dryRun.report.media.by_strategy).toMatchObject({
      rendered_element: 1,
      unique_filename: 1,
    });
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
    expect(state.relations.size).toBe(1);
    expect(
      result.ledger.bindings.some(
        (binding) => binding.entity_kind === "relation",
      ),
    ).toBe(true);
    expect(result.report.links.unresolved).toBe(1);
  });

  it("isolates conflicting duplicate Jira link ids", async () => {
    const state = makeTarget();
    const issue = issueFixture();
    const conflicting = issue.fields.issuelinks?.[1];
    if (conflicting?.outwardIssue)
      conflicting.outwardIssue = { id: "10003", key: "DEMO-3" };
    const base = {
      jiraCloudId: "cloud-1",
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
    const result = await importJiraRelatedData({
      ...base,
      issue,
      ledger: applied.ledger,
    });
    expect(result.report.failures).toContainEqual(
      expect.objectContaining({ reason: "jira_link_duplicate_conflict" }),
    );
    expect(state.relations.size).toBe(1);
    expect(
      result.ledger.bindings.some(
        (binding) => binding.entity_kind === "relation",
      ),
    ).toBe(true);
  });
});
