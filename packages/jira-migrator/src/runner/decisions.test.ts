import { describe, expect, it } from "vitest";
import type { JiraChangelogPlan } from "../issues/changelog.js";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import {
  mappedFingerprintForChangelog,
  mappedFingerprintForIssue,
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
  it("ignores migration timestamps in issue mapped state", () => {
    expect(
      mappedFingerprintForIssue(issuePlan("2026-07-27T00:00:00.000Z")),
    ).toBe(mappedFingerprintForIssue(issuePlan("2026-07-28T00:00:00.000Z")));
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
