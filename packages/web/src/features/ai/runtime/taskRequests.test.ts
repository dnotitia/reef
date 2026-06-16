// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  activityScanRun,
  chatWorkspaceRun,
  issueEnrichmentRun,
} from "./taskRequests";

const issueDraftFields = {
  title: "Create stream client",
  issue_type: "task" as const,
  priority: null,
  assigned_to: null,
  requester: null,
  reporter: null,
  start_date: null,
  due_date: null,
  milestone_id: null,
  sprint_id: null,
  release_id: null,
  estimate_points: null,
  severity: null,
  parent_id: null,
  labels: [],
  depends_on: [],
  blocks: [],
  related_to: [],
  external_refs: [],
};

describe("agent run task request builders", () => {
  it("lets chat, enrichment, and activity presenters share the run hook", () => {
    expect(
      chatWorkspaceRun({
        messages: [
          {
            id: "m-1",
            role: "user",
            parts: [{ type: "text", text: "Status?" }],
          },
        ],
      }).task_id,
    ).toBe("chat.workspace");

    expect(
      issueEnrichmentRun({
        issueId: "REEF-044",
        vault: "reef-test",
        draft: {
          fields: issueDraftFields,
          content: "Implement shared runtime.",
        },
      }).task_id,
    ).toBe("issue.enrichment");

    expect(
      activityScanRun({
        owner: "acme",
        repo: "reef",
        vault: "reef-test",
        since: null,
        projectPrefix: "REEF",
      }).task_id,
    ).toBe("activity.scan");
  });
});
