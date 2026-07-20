export const jiraIssueFixture = {
  id: "10001",
  key: "ALPHA-1",
  self: "https://example.atlassian.net/rest/api/3/issue/10001",
  fields: {
    summary: "Ship synthetic migration fixture",
    description: {
      type: "doc",
      version: 1,
      content: [],
    },
    created: "2026-06-01T01:00:00.000+0000",
    updated: "2026-06-03T02:00:00.000+0000",
    labels: ["migration", "pilot"],
    project: {
      id: "200",
      key: "ALPHA",
      name: "Alpha",
    },
    issuetype: {
      id: "10002",
      name: "Task",
    },
    status: {
      id: "3",
      name: "In Progress",
    },
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
    attachment: [
      {
        id: "30001",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        size: 1024,
        content:
          "https://example.atlassian.net/rest/api/3/attachment/content/30001",
        created: "2026-06-01T02:00:00.000+0000",
      },
    ],
    issuelinks: [
      {
        id: "40001",
        type: {
          id: "10000",
          name: "Blocks",
          inward: "is blocked by",
          outward: "blocks",
        },
        outwardIssue: {
          id: "10002",
          key: "ALPHA-2",
          fields: {
            summary: "Downstream task",
          },
        },
      },
    ],
  },
} as const;

export const jiraSearchFixture = {
  issues: [jiraIssueFixture],
  nextPageToken: "next-token",
  isLast: false,
} as const;

export const jiraCommentPageFixture = {
  startAt: 0,
  maxResults: 1,
  total: 2,
  comments: [
    {
      id: "50001",
      body: {
        type: "doc",
        version: 1,
        content: [],
      },
      created: "2026-06-02T01:00:00.000+0000",
      updated: "2026-06-02T01:10:00.000+0000",
      author: {
        accountId: "acct-commenter",
        emailAddress: "commenter@example.com",
        displayName: "Commenter",
        active: true,
        accountType: "atlassian",
      },
    },
  ],
} as const;

export const jiraChangelogPageFixture = {
  startAt: 0,
  maxResults: 1,
  total: 2,
  isLast: false,
  values: [
    {
      id: "60001",
      created: "2026-06-03T01:00:00.000+0000",
      author: {
        accountId: "acct-changelog",
        emailAddress: "operator@example.com",
        displayName: "Operator",
        active: true,
        accountType: "atlassian",
      },
      items: [
        {
          field: "status",
          fromString: "To Do",
          toString: "In Progress",
        },
      ],
    },
  ],
} as const;

export const jiraVersionPageFixture = {
  startAt: 0,
  maxResults: 1,
  total: 2,
  isLast: false,
  values: [
    {
      id: "70001",
      projectId: 200,
      name: "1.0",
      description: "First migration release",
      startDate: "2026-07-01",
      releaseDate: "2026-07-31",
      released: false,
      archived: false,
    },
  ],
} as const;

export const jiraSprintPageFixture = {
  startAt: 0,
  maxResults: 1,
  total: 2,
  isLast: false,
  values: [
    {
      id: 80001,
      state: "active",
      name: "Migration Sprint 1",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-14T00:00:00.000Z",
      originBoardId: 90001,
      goal: "Prove the generic migration",
    },
  ],
} as const;

export const jiraFieldCatalogFixture = [
  {
    id: "summary",
    name: "Summary",
    custom: false,
    schema: { type: "string", system: "summary" },
  },
  {
    id: "customfield_10420",
    name: "Sprint",
    custom: true,
    schema: {
      type: "array",
      items: "json",
      custom: "com.pyxis.greenhopper.jira:gh-sprint",
      customId: 10420,
    },
  },
] as const;
