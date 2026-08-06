import { describe, expect, it } from "vitest";
import { createJiraAccountMappingArtifact } from "../accounts/mapping.js";
import { fingerprintJiraState } from "../execution/diff.js";
import { createJiraMigrationLedger } from "../ledger.js";
import { importJiraRelatedData } from "./import.js";
import {
  attachmentPolicy,
  issueFixture,
  makeClient,
  makeTarget,
} from "./importTestSupport.js";

describe("Jira related-data import stage", () => {
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

  it("keeps one canonical relation when both Jira endpoints expose the link", async () => {
    const state = makeTarget();
    const client = makeClient([]);
    const mapping = {
      typeId: "1",
      kind: "directional" as const,
      outwardRelation: "depends_on" as const,
      inwardRelation: "blocks" as const,
    };
    const base = {
      jiraCloudId: "cloud-1",
      attachmentPolicy,
      client,
      target: state.target,
      accountMapping: createJiraAccountMappingArtifact({
        jiraCloudId: "cloud-1",
      }),
      linkMappings: [mapping],
      resolveIssueTarget: (value: string) =>
        value === "10001"
          ? {
              reefId: "REEF-1",
              documentUri: "akb://isolated/coll/issues/doc/reef-1.md",
            }
          : value === "10002"
            ? {
                reefId: "REEF-2",
                documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
              }
            : null,
      mode: "apply" as const,
    };
    const outward = await importJiraRelatedData({
      ...base,
      issue: issueFixture(),
      reefId: "REEF-1",
      ledger: createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "isolated",
      }),
    });
    const inwardIssue = issueFixture();
    inwardIssue.id = "10002";
    inwardIssue.key = "DEMO-2";
    inwardIssue.fields.issuelinks = [
      {
        id: "40001",
        type: {
          id: "1",
          name: "Dependency",
          inward: "is required by",
          outward: "requires",
        },
        inwardIssue: { id: "10001", key: "DEMO-1" },
      },
    ];
    const inward = await importJiraRelatedData({
      ...base,
      issue: inwardIssue,
      reefId: "REEF-2",
      ledger: outward.ledger,
    });

    expect(inward.report.links.skipped).toBe(1);
    expect(state.relations.size).toBe(1);
    expect(
      inward.ledger.bindings.filter(
        (binding) => binding.entity_kind === "relation",
      ),
    ).toHaveLength(1);
  });

  it("preserves the original Jira link beside an imported native relation when policy requests it", async () => {
    const state = makeTarget();
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
          preserveExternalRef: true,
        },
      ],
      resolveIssueTarget: () => ({
        reefId: "REEF-2",
        documentUri: "akb://isolated/coll/issues/doc/reef-2.md",
      }),
      mode: "apply",
    });

    expect(result.report.links.applied).toBe(1);
    expect(state.relations.size).toBe(1);
    expect(
      await state.target.readExternalRef(
        "jira-link-preserved:cloud-1:10001:40001",
      ),
    ).toEqual(
      expect.objectContaining({
        reefId: "REEF-1",
        ref: expect.objectContaining({ ref: "DEMO-2" }),
        provenance: expect.objectContaining({
          preserved_native_relation: true,
          relation: "depends_on",
        }),
      }),
    );
  });
});
