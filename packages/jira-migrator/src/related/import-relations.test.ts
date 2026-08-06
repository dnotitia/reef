import { describe, expect, it, vi } from "vitest";
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

  it("preserves a relation when its in-scope peer is not confirmed", async () => {
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
    expect(state.relations.size).toBe(1);

    const blocked = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      resolveIssueTarget: () => null,
      preserveUnresolvedIssueTargets: new Set(["10002", "DEMO-2"]),
    });
    expect(blocked.report.deletions).toBe(0);
    expect(state.relations.size).toBe(1);
    expect(blocked.report.failures).toContainEqual(
      expect.objectContaining({ reason: "linked_issue_not_confirmed" }),
    );
  });

  it("preserves a relation when its linked issue is absent from discovery", async () => {
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

    const blocked = await importJiraRelatedData({
      ...base,
      ledger: applied.ledger,
      resolveIssueTarget: () => null,
    });

    expect(blocked.report.deletions).toBe(0);
    expect(state.relations.size).toBe(1);
    expect(blocked.report.failures).toContainEqual(
      expect.objectContaining({ reason: "linked_issue_not_confirmed" }),
    );
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
});
