import { describe, expect, it } from "vitest";
import { jiraOwnerIdentity } from "./ownership.js";

describe("jiraOwnerIdentity", () => {
  it("uses stable cloud and issue ids across mutable key renames", () => {
    expect(
      jiraOwnerIdentity({
        jira_cloud_id: "cloud-1",
        issue_id: "10001",
        project_key: "ALPHA",
        issue_key: "ALPHA-1",
      }),
    ).toBe(
      jiraOwnerIdentity({
        jira_cloud_id: "cloud-1",
        issue_id: "10001",
        project_key: "RENAMED",
        issue_key: "RENAMED-7",
      }),
    );
  });

  it("rejects a different stable source identity", () => {
    expect(
      jiraOwnerIdentity({ jira_cloud_id: "cloud-1", issue_id: "10001" }),
    ).not.toBe(
      jiraOwnerIdentity({ jira_cloud_id: "cloud-1", issue_id: "10002" }),
    );
  });
});
