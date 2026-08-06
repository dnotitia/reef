import { describe, expect, it } from "vitest";
import { JiraChangelogHistorySchema } from "../payloads.js";
import { classifyJiraSprintHistory } from "./sprintHistory.js";

const relations = [
  { sourceKey: "cloud:sprint:1", sourceId: "1", name: "Sprint 1" },
  { sourceKey: "cloud:sprint:2", sourceId: "2", name: "Sprint 2" },
] as const;

const catalog = [
  {
    id: "1",
    state: "closed",
    name: "Sprint 1",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-07T23:59:59.000Z",
    completeDate: "2026-01-07T23:59:59.000Z",
    originBoardId: null,
    goal: null,
  },
  {
    id: "2",
    state: "closed",
    name: "Sprint 2",
    startDate: "2026-01-08T00:00:00.000Z",
    endDate: "2026-01-14T23:59:59.000Z",
    completeDate: "2026-01-14T23:59:59.000Z",
    originBoardId: null,
    goal: null,
  },
] as const;

describe("Jira sprint history classification", () => {
  it("classifies work activity in two sprint windows as long-running", () => {
    const result = classifyJiraSprintHistory({
      relations,
      catalog,
      changelog: [
        JiraChangelogHistorySchema.parse({
          id: "h-1",
          created: "2026-01-03T12:00:00.000Z",
          items: [{ field: "status", fieldId: "status" }],
        }),
        JiraChangelogHistorySchema.parse({
          id: "h-2",
          created: "2026-01-10T12:00:00.000Z",
          items: [{ field: "summary", fieldId: "summary" }],
        }),
      ],
    });

    expect(result).toEqual({
      classification: "long_running",
      primarySourceKey: "cloud:sprint:2",
      activitySprintIds: ["1", "2"],
    });
  });

  it("classifies cumulative sprint membership without work activity as rollover", () => {
    const result = classifyJiraSprintHistory({
      relations,
      catalog,
      changelog: [
        JiraChangelogHistorySchema.parse({
          id: "h-sprint",
          created: "2026-01-10T12:00:00.000Z",
          items: [{ field: "Sprint", fieldId: "customfield_10020" }],
        }),
      ],
    });

    expect(result).toEqual({
      classification: "rollover",
      primarySourceKey: "cloud:sprint:2",
      activitySprintIds: [],
    });
  });

  it("stays indeterminate when sprint windows or history are incomplete", () => {
    const result = classifyJiraSprintHistory({
      relations,
      catalog: catalog.map((sprint) => ({ ...sprint, endDate: null })),
      changelog: [],
    });

    expect(result.classification).toBe("indeterminate");
    expect(result.primarySourceKey).toBe("cloud:sprint:2");
  });
});
