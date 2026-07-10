import { describe, expect, it } from "vitest";
import {
  jiraChangelogPageFixture,
  jiraCommentPageFixture,
  jiraFieldCatalogFixture,
  jiraIssueFixture,
  jiraSearchFixture,
  jiraSprintPageFixture,
  jiraVersionPageFixture,
} from "./fixtures.js";
import {
  JiraChangelogPageSchema,
  JiraCommentPageSchema,
  JiraFieldCatalogSchema,
  JiraIssueSchema,
  JiraSearchResponseSchema,
  JiraSprintPageSchema,
  JiraVersionPageSchema,
  findJiraSprintFieldId,
  normalizeIssueSprintReferences,
  normalizeJiraIssue,
  normalizeJiraSprint,
  normalizeJiraVersion,
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

  it("normalizes Version and Sprint catalogs without retaining unrelated wire fields", () => {
    const version = normalizeJiraVersion(
      JiraVersionPageSchema.parse(jiraVersionPageFixture).values[0],
    );
    const sprint = normalizeJiraSprint(
      JiraSprintPageSchema.parse(jiraSprintPageFixture).values[0],
    );

    expect(version).toMatchObject({
      id: "70001",
      projectId: "200",
      name: "1.0",
      released: false,
    });
    expect(sprint).toMatchObject({
      id: "80001",
      state: "active",
      originBoardId: "90001",
    });
    expect(version).not.toHaveProperty("self");
    expect(sprint).not.toHaveProperty("self");
  });

  it("discovers the Sprint custom field from the Jira field schema instead of a fixed id", () => {
    const fields = JiraFieldCatalogSchema.parse(jiraFieldCatalogFixture);
    const issue = JiraIssueSchema.parse({
      ...jiraIssueFixture,
      fields: {
        ...jiraIssueFixture.fields,
        customfield_10420: jiraSprintPageFixture.values,
      },
    });

    expect(findJiraSprintFieldId(fields)).toBe("customfield_10420");
    expect(normalizeIssueSprintReferences(issue, fields)).toEqual([
      expect.objectContaining({ id: "80001", name: "Migration Sprint 1" }),
    ]);
  });
});
