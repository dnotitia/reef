import { describe, expect, it } from "vitest";
import {
  jiraChangelogPageFixture,
  jiraCommentPageFixture,
  jiraIssueFixture,
  jiraSearchFixture,
} from "./fixtures.js";
import {
  JiraChangelogPageSchema,
  JiraCommentPageSchema,
  JiraIssueSchema,
  JiraSearchResponseSchema,
  normalizeJiraIssue,
} from "./payloads.js";

describe("Jira payload schemas and normalizers", () => {
  it("parses and normalizes an issue detail payload with attachments and links", () => {
    const issue = JiraIssueSchema.parse(jiraIssueFixture);
    const normalized = normalizeJiraIssue(issue);

    expect(normalized).toMatchObject({
      id: "10001",
      key: "SHDEV-1",
      summary: "Ship SHDEV pilot migration",
      projectKey: "SHDEV",
      issueType: "Task",
      status: "In Progress",
      labels: ["migration", "pilot"],
      attachments: [
        {
          id: "30001",
          filename: "brief.pdf",
          mimeType: "application/pdf",
        },
      ],
      links: [
        {
          id: "40001",
          direction: "outward",
          issueKey: "SHDEV-2",
          label: "blocks",
        },
      ],
      users: {
        assignee: {
          accountId: "acct-assignee",
          emailAddress: "operator@example.com",
          displayName: "Operator",
          active: true,
          accountType: "atlassian",
        },
        reporter: {
          accountId: "acct-reporter",
          emailAddress: "requester@example.com",
          displayName: "Requester",
          active: true,
          accountType: "atlassian",
        },
      },
    });
  });

  it("parses enhanced JQL search pages with a next-page token", () => {
    const page = JiraSearchResponseSchema.parse(jiraSearchFixture);

    expect(page.nextPageToken).toBe("next-token");
    expect(page.issues).toHaveLength(1);
  });

  it("parses comment and changelog pages for fixture-driven imports", () => {
    expect(
      JiraCommentPageSchema.parse(jiraCommentPageFixture).comments[0]?.id,
    ).toBe("50001");
    expect(
      JiraChangelogPageSchema.parse(jiraChangelogPageFixture).values[0]?.id,
    ).toBe("60001");
  });
});
