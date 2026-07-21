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
  JiraChangelogItemSchema,
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
  it("parses expanded issue fields without treating source timestamps as Reef timestamps", () => {
    const issue = JiraIssueSchema.parse({
      ...jiraIssueFixture,
      fields: {
        ...jiraIssueFixture.fields,
        issuetype: {
          id: "10002",
          name: "Sub-task",
          subtask: true,
          hierarchyLevel: -1,
        },
        status: {
          id: "3",
          name: "Done",
          statusCategory: { id: "3", key: "done", name: "Done" },
        },
        priority: { id: "2", name: "High" },
        creator: { accountId: "creator" },
        parent: { id: "10000", key: "ALPHA-0" },
        duedate: "2026-07-21",
        resolution: { id: "1", name: "Fixed" },
        resolutiondate: "2026-07-20T01:00:00.000Z",
        fixVersions: [{ id: "10", name: "1.0" }],
        versions: [{ id: "9", name: "0.9" }],
        components: [{ id: "8", name: "API" }],
        environment: "production",
        watches: { watchCount: 2, isWatching: false },
        votes: { votes: 1, hasVoted: false },
        timetracking: { originalEstimateSeconds: 3600 },
        worklog: { total: 1, worklogs: [] },
      },
    });
    expect(normalizeJiraIssue(issue)).toMatchObject({
      issueTypeId: "10002",
      issueTypeSubtask: true,
      issueTypeHierarchyLevel: -1,
      statusId: "3",
      statusCategoryKey: "done",
      priority: { id: "2", name: "High" },
      dueDate: "2026-07-21",
      resolution: { id: "1", name: "Fixed" },
      resolutionDate: "2026-07-20T01:00:00.000Z",
      parent: { id: "10000", key: "ALPHA-0" },
      fixVersions: [{ id: "10", name: "1.0" }],
      affectedVersions: [{ id: "9", name: "0.9" }],
      components: [{ id: "8", name: "API" }],
      environment: "production",
      users: { creator: { accountId: "creator" } },
    });
  });

  it("parses and normalizes an issue detail payload with attachments and links", () => {
    const issue = JiraIssueSchema.parse(jiraIssueFixture);
    const normalized = normalizeJiraIssue(issue);

    expect(normalized).toMatchObject({
      id: "10001",
      key: "ALPHA-1",
      summary: "Ship synthetic migration fixture",
      projectKey: "ALPHA",
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
          issueKey: "ALPHA-2",
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
    const history = JiraChangelogPageSchema.parse(jiraChangelogPageFixture)
      .values[0];
    expect(history?.id).toBe("60001");
    expect(history?.items[0]).toEqual({
      field: "status",
      fieldId: "status",
      fieldtype: "jira",
      from: "10000",
      to: "3",
      fromString: "To Do",
      toString: "In Progress",
    });
  });

  it("accepts nullable and omitted Jira changelog item variants without inventing values", () => {
    expect(
      JiraChangelogItemSchema.parse({
        field: "Start date",
        fieldId: "customfield_10015",
        fieldtype: "custom",
        from: null,
        to: "2026-07-21",
        fromString: null,
      }),
    ).toEqual({
      field: "Start date",
      fieldId: "customfield_10015",
      fieldtype: "custom",
      from: null,
      to: "2026-07-21",
      fromString: null,
    });
    expect(JiraChangelogItemSchema.parse({ field: "description" })).toEqual({
      field: "description",
    });
  });

  it("normalizes numeric, string, null, and absent comment parent ids", () => {
    const base = { body: { type: "doc", version: 1, content: [] } };
    const comments = JiraCommentPageSchema.parse({
      startAt: 0,
      maxResults: 4,
      total: 4,
      comments: [
        { ...base, id: 1, parentId: 9 },
        { ...base, id: "2", parentId: "0009" },
        { ...base, id: 3, parentId: null },
        { ...base, id: 4 },
      ],
    }).comments;
    expect(comments.map((item) => item.parentId)).toEqual([
      "9",
      "9",
      null,
      undefined,
    ]);
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
    const fields = JiraFieldCatalogSchema.parse([
      {
        id: "customfield_10000",
        name: "Sprint capacity note",
        custom: true,
        schema: {
          type: "string",
          custom: "com.example:sprint-capacity",
        },
      },
      ...jiraFieldCatalogFixture,
    ]);
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
