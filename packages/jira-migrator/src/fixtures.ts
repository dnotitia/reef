export const jiraIssueFixture = {
  id: "10001",
  key: "SHDEV-1",
  self: "https://example.atlassian.net/rest/api/3/issue/10001",
  fields: {
    summary: "Ship SHDEV pilot migration",
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
      key: "SHDEV",
      name: "SHDEV",
    },
    issuetype: {
      id: "10002",
      name: "Task",
    },
    status: {
      id: "3",
      name: "In Progress",
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
          key: "SHDEV-2",
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
        accountId: "abc",
        displayName: "Operator",
        active: true,
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
