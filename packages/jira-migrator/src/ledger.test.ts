import { describe, expect, it } from "vitest";
import {
  finalizeJiraMigrationPhase,
  recordJiraMigrationResult,
  resumableJiraMigrationEntities,
} from "./checkpoint.js";
import { classifyJiraMigrationDiff, fingerprintJiraState } from "./diff.js";
import {
  confirmJiraMigrationBinding,
  createJiraMigrationLedger,
  getJiraCommentTargetId,
  getJiraIssueTarget,
  getJiraPlanningLedgerBindings,
  jiraAttachmentSourceIdentity,
  jiraChangelogSourceIdentity,
  jiraCommentSourceIdentity,
  jiraIssueSourceIdentity,
  jiraRelationSourceIdentity,
  openJiraMigrationRun,
} from "./ledger.js";
import {
  jiraSprintSourceIdentity,
  jiraVersionSourceIdentity,
} from "./planning.js";
import { buildJiraMigrationReport } from "./report.js";

const at = "2026-07-20T00:00:00.000Z";

describe("Jira migration ledger", () => {
  it("builds collision-safe stable identities independent of display names and keys", () => {
    expect(jiraIssueSourceIdentity("cloud:a", "project/b", "100").key).toBe(
      "issue:cloud%3Aa:project%2Fb:100",
    );
    expect(jiraCommentSourceIdentity("cloud:a", "100", "c/1").key).toBe(
      "comment:cloud%3Aa:100:c%2F1",
    );
    expect(jiraAttachmentSourceIdentity("cloud:a", "a:1").key).toBe(
      "attachment:cloud%3Aa:a%3A1",
    );
    expect(jiraChangelogSourceIdentity("cloud:a", "100", "h 1").key).toBe(
      "changelog_history:cloud%3Aa:100:h%201",
    );
    expect(
      jiraRelationSourceIdentity(
        "cloud:a",
        "100",
        "200",
        "blocks",
        "outward",
        "7",
      ).key,
    ).toContain("relation:cloud%3Aa:100:200:blocks:outward:7");
  });

  it("confirms bindings only after target identity readback and exposes planning/issue/comment lookups", () => {
    let ledger = createJiraMigrationLedger({
      jiraCloudId: "cloud-1",
      targetVault: "reef-target",
    });
    const version = jiraVersionSourceIdentity("cloud-1", "p-1", "v-1");
    const sprint = jiraSprintSourceIdentity("cloud-1", "s-1");
    const issue = jiraIssueSourceIdentity("cloud-1", "p-1", "i-1");
    const comment = jiraCommentSourceIdentity("cloud-1", "i-1", "c-1");
    const base = {
      sourceFingerprint: fingerprintJiraState({ id: "stable" }),
      mappedStateFingerprint: fingerprintJiraState({ title: "Mapped" }),
      lastAppliedAt: at,
      writeSucceeded: true,
      readbackSucceeded: true,
    } as const;

    ledger = confirmJiraMigrationBinding(ledger, {
      ...base,
      sourceIdentity: version,
      target: {
        target_kind: "release",
        target_id: "11111111-1111-4111-8111-111111111111",
      },
    });
    ledger = confirmJiraMigrationBinding(ledger, {
      ...base,
      sourceIdentity: sprint,
      target: {
        target_kind: "sprint",
        target_id: "22222222-2222-4222-8222-222222222222",
      },
    });
    ledger = confirmJiraMigrationBinding(ledger, {
      ...base,
      sourceIdentity: issue,
      target: {
        target_kind: "issue",
        reef_id: "REEF-900",
        document_uri: "akb://reef-target/coll/issues/doc/reef-900.md",
      },
    });
    ledger = confirmJiraMigrationBinding(ledger, {
      ...base,
      sourceIdentity: comment,
      target: {
        target_kind: "comment",
        comment_id: "33333333-3333-4333-8333-333333333333",
      },
    });

    expect(getJiraPlanningLedgerBindings(ledger)).toEqual([
      {
        sourceKey: sprint.key,
        targetKind: "sprint",
        targetId: "22222222-2222-4222-8222-222222222222",
      },
      {
        sourceKey: version.key,
        targetKind: "release",
        targetId: "11111111-1111-4111-8111-111111111111",
      },
    ]);
    expect(getJiraIssueTarget(ledger, issue)).toMatchObject({
      reef_id: "REEF-900",
    });
    expect(getJiraCommentTargetId(ledger, comment)).toBe(
      "33333333-3333-4333-8333-333333333333",
    );

    expect(() =>
      confirmJiraMigrationBinding(ledger, {
        ...base,
        sourceIdentity: issue,
        target: {
          document_uri: "akb://reef-target/coll/issues/doc/reef-900.md",
          reef_id: "REEF-900",
          target_kind: "issue",
        },
      }),
    ).not.toThrow();

    expect(() =>
      confirmJiraMigrationBinding(ledger, {
        ...base,
        sourceIdentity: jiraIssueSourceIdentity("cloud-1", "p-1", "i-2"),
        target: {
          target_kind: "issue",
          reef_id: "REEF-901",
          document_uri: "akb://reef-target/coll/issues/doc/reef-901.md",
        },
        readbackSucceeded: false,
      }),
    ).toThrowError("target_readback_required");

    for (const [sourceIdentity, target] of [
      [
        jiraIssueSourceIdentity("cloud-1", "p-1", "i-2"),
        {
          target_kind: "issue",
          reef_id: "REEF-901",
          document_uri: "akb://other-vault/coll/issues/doc/reef-901.md",
        },
      ],
      [
        jiraAttachmentSourceIdentity("cloud-1", "a-1"),
        {
          target_kind: "attachment",
          file_uri: "akb://other-vault/issues/file/file-1",
        },
      ],
    ] as const) {
      expect(() =>
        confirmJiraMigrationBinding(ledger, {
          ...base,
          sourceIdentity,
          target,
        }),
      ).toThrowError("target_scope_mismatch");
    }
  });

  it("uses one classifier for create, skip, update, retry, and conflict", () => {
    const fingerprint = fingerprintJiraState({
      title: "same",
      fields: { a: 1 },
    });
    expect(fingerprintJiraState({ fields: { a: 1 }, title: "same" })).toBe(
      fingerprint,
    );
    expect(
      classifyJiraMigrationDiff({
        binding: null,
        desiredMappedStateFingerprint: fingerprint,
      }),
    ).toMatchObject({ action: "create" });
    const binding = {
      source_fingerprint: fingerprint,
      mapped_state_fingerprint: fingerprint,
      targetMatchesExpectedIdentity: true,
    };
    expect(
      classifyJiraMigrationDiff({
        binding,
        desiredMappedStateFingerprint: fingerprint,
      }),
    ).toMatchObject({ action: "skip" });
    expect(
      classifyJiraMigrationDiff({
        binding,
        desiredMappedStateFingerprint: fingerprintJiraState({
          title: "changed",
        }),
      }),
    ).toMatchObject({ action: "update" });
    expect(
      classifyJiraMigrationDiff({
        binding,
        desiredMappedStateFingerprint: fingerprint,
        previousResult: {
          action: "failed",
          retryable: true,
          preconditionsMatch: true,
        },
      }),
    ).toMatchObject({ action: "retry" });
    expect(
      classifyJiraMigrationDiff({
        binding: { ...binding, targetMatchesExpectedIdentity: false },
        desiredMappedStateFingerprint: fingerprint,
      }),
    ).toMatchObject({ action: "conflict" });
    expect(
      classifyJiraMigrationDiff({
        binding: { ...binding, targetMatchesExpectedIdentity: false },
        desiredMappedStateFingerprint: fingerprint,
        previousResult: {
          action: "failed",
          retryable: true,
          preconditionsMatch: true,
        },
      }),
    ).toMatchObject({
      action: "conflict",
      reason: "target_identity_mismatch",
    });
  });

  it("resumes by phase and canonical entity key regardless of input ordering", () => {
    let ledger = openJiraMigrationRun(
      createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "reef-target",
      }),
      {
        runId: "run-1",
        projectKeys: ["BETA", "ALPHA"],
        planFingerprint: fingerprintJiraState({ plan: 1 }),
        at,
      },
    );
    ledger = recordJiraMigrationResult(ledger, {
      runId: "run-1",
      phase: "issues",
      result: {
        source_key: "issue:cloud-1:p:1",
        entity_kind: "issue",
        action: "create",
        retryable: false,
        error_code: null,
        attempted_at: at,
        readback_at: at,
        reconciliation_state: "not_applicable",
      },
    });
    ledger = recordJiraMigrationResult(ledger, {
      runId: "run-1",
      phase: "issues",
      result: {
        source_key: "issue:cloud-1:p:2",
        entity_kind: "issue",
        action: "failed",
        retryable: true,
        error_code: "target_unavailable",
        attempted_at: at,
        readback_at: null,
        reconciliation_state: "not_applicable",
      },
    });
    ledger = recordJiraMigrationResult(ledger, {
      runId: "run-1",
      phase: "issues",
      result: {
        source_key: "issue:cloud-1:p:3",
        entity_kind: "issue",
        action: "conflict",
        retryable: false,
        error_code: null,
        attempted_at: at,
        readback_at: null,
        reconciliation_state: "not_applicable",
      },
    });

    const inputs = [
      "issue:cloud-1:p:3",
      "issue:cloud-1:p:2",
      "issue:cloud-1:p:1",
    ];
    expect(
      resumableJiraMigrationEntities(ledger, "run-1", "issues", inputs),
    ).toEqual(["issue:cloud-1:p:2"]);
    expect(
      resumableJiraMigrationEntities(
        ledger,
        "run-1",
        "issues",
        [...inputs].reverse(),
      ),
    ).toEqual(["issue:cloud-1:p:2"]);
    ledger = finalizeJiraMigrationPhase(ledger, {
      runId: "run-1",
      phase: "issues",
      at,
    });
    expect(ledger.runs[0]?.phases.issues.status).toBe("blocked");
    expect(() =>
      openJiraMigrationRun(ledger, {
        runId: "run-1",
        projectKeys: ["ALPHA", "BETA"],
        planFingerprint: fingerprintJiraState({ plan: 2 }),
        at,
      }),
    ).toThrowError("run_plan_conflict");
  });

  it("persists distinct cross-project reconciliation states", () => {
    let ledger = openJiraMigrationRun(
      createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "reef-target",
      }),
      {
        runId: "run-links",
        projectKeys: ["ALPHA", "BETA"],
        planFingerprint: fingerprintJiraState({ links: true }),
        at,
      },
    );
    for (const [source_key, reconciliation_state] of [
      ["relation:cloud-1:1:2:type:out:1", "pending_target_migration"],
      ["relation:cloud-1:1:3:type:out:2", "ready"],
      ["relation:cloud-1:1:4:type:out:3", "reconciled"],
    ] as const) {
      ledger = recordJiraMigrationResult(ledger, {
        runId: "run-links",
        phase: "reconciliation",
        result: {
          source_key,
          entity_kind: "relation",
          action: reconciliation_state === "reconciled" ? "create" : "skip",
          retryable: false,
          error_code: null,
          attempted_at: at,
          readback_at: reconciliation_state === "reconciled" ? at : null,
          reconciliation_state,
        },
      });
    }
    expect(
      ledger.runs[0]?.phases.reconciliation.entities.map(
        (entity) => entity.reconciliation_state,
      ),
    ).toEqual(["pending_target_migration", "ready", "reconciled"]);
  });

  it("reports persisted multi-project results by phase and entity kind", () => {
    let ledger = openJiraMigrationRun(
      createJiraMigrationLedger({
        jiraCloudId: "cloud-1",
        targetVault: "reef-target",
      }),
      {
        runId: "run-report",
        projectKeys: ["ALPHA", "BETA"],
        planFingerprint: fingerprintJiraState({ projects: ["ALPHA", "BETA"] }),
        at,
      },
    );
    for (const [source_key, entity_kind, action, retryable] of [
      ["version:cloud-1:p:v", "version", "create", false],
      ["issue:cloud-1:p:i", "issue", "skip", false],
      ["comment:cloud-1:i:c", "comment", "failed", true],
    ] as const) {
      ledger = recordJiraMigrationResult(ledger, {
        runId: "run-report",
        phase:
          entity_kind === "version"
            ? "planning"
            : entity_kind === "issue"
              ? "issues"
              : "related",
        result: {
          source_key,
          entity_kind,
          action,
          retryable,
          error_code: retryable ? "target_unavailable" : null,
          attempted_at: at,
          readback_at: action === "failed" ? null : at,
          reconciliation_state: "not_applicable",
        },
      });
    }
    const report = buildJiraMigrationReport(ledger, "run-report");
    expect(report.project_keys).toEqual(["ALPHA", "BETA"]);
    expect(report.totals).toMatchObject({
      created: 1,
      skipped: 1,
      failed: 1,
      retryable: 1,
    });
    expect(report.by_phase.related.by_entity_kind.comment?.failed).toBe(1);
  });
});
