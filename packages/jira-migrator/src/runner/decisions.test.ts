import { describe, expect, it } from "vitest";
import type { JiraChangelogPlan } from "../issues/changelog.js";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import { reportTemplate } from "../related/reporting.js";
import {
  actionForEquivalentIssuePlans,
  actionForIssuePlan,
  mappedFingerprintForChangelog,
  mappedFingerprintForIssue,
  plannedIssueContentForRelated,
  reconciliationAction,
  relatedExecutionError,
  runScopedMappedFingerprintForChangelog,
} from "./decisions.js";

const reference = (runId: string) => ({
  runId,
  entryId: "history-1",
  contentSha256: "a".repeat(64),
});

const changelogPlan = (runId: string) =>
  ({
    rawArchiveReference: reference(runId),
    report: {
      historyCount: 1,
      itemCount: 1,
      totals: { promoted: 0, raw: 1, deferred: 0, failed: 0 },
      byField: {
        unidentified: { promoted: 0, raw: 1, deferred: 0, failed: 0 },
      },
      rawPreservationLocations: [reference(runId)],
    },
    items: [
      {
        itemIndex: 0,
        fieldId: null,
        classification: "raw",
        reason: "unmapped_field_raw",
        rawArchiveReference: reference(runId),
        activity: null,
        externalRef: null,
      },
    ],
  }) as unknown as JiraChangelogPlan;

const issuePlan = (at: string) =>
  ({
    desired: {
      content: "",
      issue: {
        id: "REEF-001",
        title: "Stable",
        created_at: at,
        updated_at: at,
      },
    },
  }) as unknown as JiraIssueImportPlan;

describe("migration action fingerprints", () => {
  it("isolates deterministic and retryable related execution errors", () => {
    expect(
      relatedExecutionError(new Error("related_operation_preflight_failed")),
    ).toEqual({
      action: "conflict",
      reason: "related_operation_preflight_failed",
      retryable: false,
    });
    expect(
      relatedExecutionError(
        Object.assign(new Error("target_temporarily_unavailable"), {
          retryable: true,
        }),
      ),
    ).toEqual({
      action: "failed",
      reason: "target_temporarily_unavailable",
      retryable: true,
    });
  });

  it("ignores migration timestamps in issue mapped state", () => {
    expect(
      mappedFingerprintForIssue(issuePlan("2026-07-27T00:00:00.000Z")),
    ).toBe(mappedFingerprintForIssue(issuePlan("2026-07-28T00:00:00.000Z")));
  });

  it("accepts a ledger-bound native planning representation as equivalent", () => {
    const semantic = {
      source: {
        jiraCloudId: "cloud-1",
        projectId: "100",
        projectKey: "ALPHA",
        issueId: "10001",
      },
      desired: {
        content: "",
        issue: {
          id: "REEF-001",
          release_id: "jira-planning:release:alpha",
        },
      },
    } as unknown as JiraIssueImportPlan;
    const native = {
      ...semantic,
      desired: {
        ...semantic.desired,
        issue: {
          ...semantic.desired.issue,
          release_id: "release-uuid",
        },
      },
    } as JiraIssueImportPlan;
    const ledger = {
      bindings: [
        {
          source_key: "issue:cloud-1:100:10001",
          target: { target_kind: "issue", reef_id: "REEF-001" },
          mapped_state_fingerprint: mappedFingerprintForIssue(native),
        },
      ],
    } as never;

    expect(actionForEquivalentIssuePlans(semantic, [native], ledger)).toBe(
      "skip",
    );
    expect(actionForEquivalentIssuePlans(semantic, [], ledger)).toBe("update");
  });

  it("updates an owned target that predates the migration ledger", () => {
    const plan = {
      source: {
        jiraCloudId: "cloud-1",
        projectId: "100",
        projectKey: "PROJ",
        issueId: "23444",
        issueKey: "PROJ-286",
      },
      status: "ready",
      desired: {
        content: "desired",
        issue: { id: "PROJ-286" },
      },
    } as unknown as JiraIssueImportPlan;
    const ledger = { bindings: [] } as never;

    expect(
      actionForIssuePlan(plan, ledger, undefined, new Set(["PROJ-286"])),
    ).toBe("update");
    expect(actionForIssuePlan(plan, ledger)).toBe("create");
  });

  it("plans related data against base content created or updated first", () => {
    const plan = issuePlan("2026-07-28T00:00:00.000Z");
    plan.desired.content = "new base description";

    expect(plannedIssueContentForRelated(plan, "create")).toBe(
      "new base description",
    );
    expect(plannedIssueContentForRelated(plan, "update")).toBe(
      "new base description",
    );
    expect(plannedIssueContentForRelated(plan, "skip")).toBeUndefined();
    expect(plannedIssueContentForRelated(plan, "conflict")).toBeUndefined();
  });

  it("ignores raw archive run ids in changelog mapped state", () => {
    const first = changelogPlan("run-1");
    const second = changelogPlan("run-2");

    expect(mappedFingerprintForChangelog(first)).toBe(
      mappedFingerprintForChangelog(second),
    );
    expect(
      runScopedMappedFingerprintForChangelog(first, reference("run-1")),
    ).not.toBe(
      runScopedMappedFingerprintForChangelog(second, reference("run-2")),
    );
  });
});

describe("relation reconciliation", () => {
  it("accepts mapped cross-project links as durable external references", () => {
    const report = reportTemplate("dry-run");
    report.links.unique = 2;
    report.links.unresolved = 1;
    report.links.externalized = 1;

    expect(
      reconciliationAction(
        {
          kind: "relation",
          reason: "cross_project_reconcile",
          sourceKey: "OTHER-1",
          targetId: null,
        },
        report,
        [],
      ),
    ).toBe("skip");
    expect(
      reconciliationAction(
        {
          kind: "relation",
          reason: "needs_relation_reconcile",
          sourceKey: "SHDEV-2",
          targetId: "SHDEV-002",
        },
        report,
        [],
      ),
    ).toBe("skip");
  });

  it("accepts a cross-project link resolved inside a multi-project batch", () => {
    const report = reportTemplate("dry-run");
    report.links.unique = 1;

    expect(
      reconciliationAction(
        {
          kind: "relation",
          reason: "cross_project_reconcile",
          sourceKey: "BETA-1",
          targetId: "REEF-002",
        },
        report,
        [],
      ),
    ).toBe("skip");
  });

  it("keeps missing link semantics as a conflict", () => {
    const report = reportTemplate("dry-run");
    report.links.unique = 1;
    report.links.unresolved = 1;
    report.links.unmapped = 1;

    expect(
      reconciliationAction(
        {
          kind: "relation",
          reason: "cross_project_reconcile",
          sourceKey: "OTHER-1",
          targetId: null,
        },
        report,
        [],
      ),
    ).toBe("conflict");
  });
});
