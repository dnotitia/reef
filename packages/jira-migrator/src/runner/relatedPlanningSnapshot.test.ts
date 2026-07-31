import type { AkbReadIssueResult } from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import type { JiraRelatedImportTarget } from "../related/contracts.js";
import { createRelatedPlanningSnapshot } from "./relatedPlanningSnapshot.js";

const readback = (
  id: string,
  input: {
    content?: string;
    relatedTo?: string[];
    externalRef?: {
      idempotencyKey: string;
      ref: { type: "jira"; ref: string };
    };
    relation?: {
      idempotencyKey: string;
      targetReefId: string;
    };
  } = {},
): AkbReadIssueResult =>
  ({
    issue: {
      id,
      title: id,
      status: "todo",
      priority: "medium",
      assignees: [],
      labels: [],
      related_to: input.relatedTo,
      external_refs: input.externalRef ? [input.externalRef.ref] : [],
      custom_fields: {
        jira_migration: {
          external_refs: input.externalRef
            ? [
                {
                  idempotencyKey: input.externalRef.idempotencyKey,
                  reefId: id,
                  ref: input.externalRef.ref,
                  provenance: { source: "jira" },
                },
              ]
            : [],
          relations: input.relation
            ? [
                {
                  idempotencyKey: input.relation.idempotencyKey,
                  sourceReefId: id,
                  targetReefId: input.relation.targetReefId,
                  relation: "related_to",
                  inverseRelation: "related_to",
                  provenance: { source: "jira" },
                },
              ]
            : [],
        },
      },
    },
    path: `issues/${id.toLowerCase()}.md`,
    commit_hash: "commit",
    content: input.content ?? "",
  }) as unknown as AkbReadIssueResult;

describe("related planning snapshot", () => {
  it("answers repeated planning reads from issue and bulk-query snapshots", async () => {
    const externalRef = { type: "jira" as const, ref: "SHDEV-1" };
    const source = readback("SHDEV-001", {
      content: "body\n\nakb://reef-shdev/files/design.png",
      relatedTo: ["SHDEV-002"],
      externalRef: {
        idempotencyKey: "jira-remote:cloud:1:link",
        ref: externalRef,
      },
      relation: {
        idempotencyKey: "jira-relation:cloud:1:2",
        targetReefId: "SHDEV-002",
      },
    });
    const destination = readback("SHDEV-002", {
      relatedTo: ["SHDEV-001"],
    });
    const target = {
      listExternalRefKeys: vi.fn(async () => {
        throw new Error("unexpected_live_external_ref_catalog_read");
      }),
      listFallbackAttachmentActivityActors: vi.fn(async () => {
        throw new Error("unexpected_live_attachment_actor_catalog_read");
      }),
      readExternalRef: vi.fn(async () => {
        throw new Error("unexpected_live_external_ref_read");
      }),
      readRelation: vi.fn(async () => {
        throw new Error("unexpected_live_relation_read");
      }),
      hasMediaReference: vi.fn(async () => {
        throw new Error("unexpected_live_media_read");
      }),
      readDescription: vi.fn(async () => {
        throw new Error("unexpected_live_description_read");
      }),
    } as unknown as JiraRelatedImportTarget;
    const snapshot = createRelatedPlanningSnapshot({
      target,
      issueReadbacks: new Map([
        ["SHDEV-001", source],
        ["SHDEV-002", destination],
      ]),
      externalRefKeys: [
        "jira-remote:cloud:1:link",
        "jira-remote:cloud:2:other",
      ],
      fallbackAttachmentActors: [
        {
          reefId: "SHDEV-001",
          eventKey: "attachment_added:file-1@2026-01-01T00:00:00.000Z",
          actor: "jira:account-1",
        },
      ],
    });

    await expect(
      snapshot.listExternalRefKeys("jira-remote:cloud:1:"),
    ).resolves.toEqual(["jira-remote:cloud:1:link"]);
    await expect(
      snapshot.listFallbackAttachmentActivityActors("SHDEV-001"),
    ).resolves.toEqual([
      {
        eventKey: "attachment_added:file-1@2026-01-01T00:00:00.000Z",
        actor: "jira:account-1",
      },
    ]);
    await expect(
      snapshot.readExternalRef("jira-remote:cloud:1:link"),
    ).resolves.toEqual({
      reefId: "SHDEV-001",
      ref: externalRef,
      provenance: { source: "jira" },
    });
    await expect(
      snapshot.readRelation("jira-relation:cloud:1:2"),
    ).resolves.toEqual({
      sourceReefId: "SHDEV-001",
      targetReefId: "SHDEV-002",
      relation: "related_to",
      inverseRelation: "related_to",
    });
    await expect(
      snapshot.hasMediaReference(
        "SHDEV-001",
        "akb://reef-shdev/files/design.png",
      ),
    ).resolves.toBe(true);
    await expect(snapshot.readDescription("SHDEV-001")).resolves.toContain(
      "design.png",
    );

    expect(target.listExternalRefKeys).not.toHaveBeenCalled();
    expect(target.listFallbackAttachmentActivityActors).not.toHaveBeenCalled();
    expect(target.readExternalRef).not.toHaveBeenCalled();
    expect(target.readRelation).not.toHaveBeenCalled();
    expect(target.hasMediaReference).not.toHaveBeenCalled();
    expect(target.readDescription).not.toHaveBeenCalled();
  });

  it("falls back to the live target when a value is outside the snapshot", async () => {
    const target = {
      readExternalRef: vi.fn(async () => null),
      readRelation: vi.fn(async () => null),
      hasMediaReference: vi.fn(async () => false),
      readDescription: vi.fn(async () => "live"),
    } as unknown as JiraRelatedImportTarget;
    const snapshot = createRelatedPlanningSnapshot({
      target,
      issueReadbacks: new Map(),
    });

    await expect(snapshot.readExternalRef("missing")).resolves.toBeNull();
    await expect(snapshot.readRelation("missing")).resolves.toBeNull();
    await expect(
      snapshot.hasMediaReference("SHDEV-999", "akb://missing"),
    ).resolves.toBe(false);
    await expect(snapshot.readDescription("SHDEV-999")).resolves.toBe("live");
    expect(target.readExternalRef).toHaveBeenCalledOnce();
    expect(target.readRelation).toHaveBeenCalledOnce();
    expect(target.hasMediaReference).toHaveBeenCalledOnce();
    expect(target.readDescription).toHaveBeenCalledOnce();
  });
});
