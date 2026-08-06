import { describe, expect, it } from "vitest";
import { fingerprintJiraState } from "../execution/diff.js";
import {
  confirmJiraMigrationBinding,
  createJiraMigrationLedger,
  jiraAttachmentSourceIdentity,
} from "../ledger.js";
import type { NormalizedJiraIssue } from "../payloads.js";
import { buildJiraChangelogAttachmentBindings } from "./changelogBindings.js";

const attachment = {
  id: "att-1",
  filename: "design.png",
  mimeType: "image/png",
  size: 42,
  contentUrl: "https://example.invalid/att-1",
  created: "2026-07-10T01:00:00.000Z",
  author: null,
};

const issue = {
  id: "10001",
  attachments: [attachment],
} as unknown as NormalizedJiraIssue;

describe("buildJiraChangelogAttachmentBindings", () => {
  it("uses the verified ledger file URI for current attachment identities", () => {
    const jiraCloudId = "cloud-1";
    const sourceIdentity = jiraAttachmentSourceIdentity(
      jiraCloudId,
      issue.id,
      attachment.id,
    );
    const ledger = confirmJiraMigrationBinding(
      createJiraMigrationLedger({
        jiraCloudId,
        targetVault: "reef-target",
      }),
      {
        sourceIdentity,
        target: {
          target_kind: "attachment",
          file_uri:
            "akb://reef-target/coll/issues/REEF-001/attachments/design.png",
        },
        sourceFingerprint: fingerprintJiraState(attachment),
        mappedStateFingerprint: fingerprintJiraState({ file: "design.png" }),
        lastAppliedAt: "2026-07-10T01:00:00.000Z",
        writeSucceeded: true,
        readbackSucceeded: true,
      },
    );

    expect(
      buildJiraChangelogAttachmentBindings({
        jiraCloudId,
        issues: [issue],
        ledger,
      }),
    ).toEqual({
      "att-1": {
        attachment_id: "att-1",
        file_uri:
          "akb://reef-target/coll/issues/REEF-001/attachments/design.png",
        filename: "design.png",
        mime_type: "image/png",
        size_bytes: 42,
      },
    });
  });

  it("does not promote incomplete or stale attachment bindings", () => {
    const jiraCloudId = "cloud-1";
    const sourceIdentity = jiraAttachmentSourceIdentity(
      jiraCloudId,
      issue.id,
      attachment.id,
    );
    const staleLedger = confirmJiraMigrationBinding(
      createJiraMigrationLedger({
        jiraCloudId,
        targetVault: "reef-target",
      }),
      {
        sourceIdentity,
        target: {
          target_kind: "attachment",
          file_uri:
            "akb://reef-target/coll/issues/REEF-001/attachments/design.png",
        },
        sourceFingerprint: fingerprintJiraState({ ...attachment, size: 99 }),
        mappedStateFingerprint: fingerprintJiraState({ file: "design.png" }),
        lastAppliedAt: "2026-07-10T01:00:00.000Z",
        writeSucceeded: true,
        readbackSucceeded: true,
      },
    );

    expect(
      buildJiraChangelogAttachmentBindings({
        jiraCloudId,
        issues: [
          issue,
          {
            ...issue,
            id: "10002",
            attachments: [{ ...attachment, id: "att-2", size: null }],
          } as unknown as NormalizedJiraIssue,
        ],
        ledger: staleLedger,
      }),
    ).toEqual({});
  });
});
