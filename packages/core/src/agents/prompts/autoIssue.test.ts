import { describe, expect, it } from "vitest";
import {
  buildAutoIssueSystemPrompt,
  buildAutoIssueUserPrompt,
} from "./autoIssue";

describe("buildAutoIssueSystemPrompt", () => {
  it("contains project prefix in example ID format", () => {
    const prompt = buildAutoIssueSystemPrompt("REEF");
    expect(prompt).toContain("REEF-001");
  });

  it("uses provided project prefix", () => {
    const prompt = buildAutoIssueSystemPrompt("MYPROJ");
    expect(prompt).toContain("MYPROJ");
    expect(prompt).toContain("MYPROJ-001");
  });

  it("returns null rule for trivial activity", () => {
    const prompt = buildAutoIssueSystemPrompt("REEF");
    expect(prompt).toContain("null");
    expect(prompt).toContain("trivial");
  });

  it("includes current date and timezone context for conservative date extraction", () => {
    const prompt = buildAutoIssueSystemPrompt("REEF");
    expect(prompt).toMatch(/Today is \d{4}-\d{2}-\d{2}/);
    expect(prompt).toContain("Timezone:");
  });

  it("lists trivial activity examples", () => {
    const prompt = buildAutoIssueSystemPrompt("REEF");
    expect(prompt).toContain("Dependency version bumps");
    expect(prompt).toContain("Merge commits");
  });

  it("instructs the agent to return null for semantic duplicates of existing issues", () => {
    const prompt = buildAutoIssueSystemPrompt("REEF");
    expect(prompt).toContain("SEMANTICALLY a duplicate");
    expect(prompt).toContain("search_issues/read_issue");
    expect(prompt).toContain("done and closed");
  });

  it("contains required JSON schema fields", () => {
    const prompt = buildAutoIssueSystemPrompt("REEF");
    expect(prompt).toContain("title");
    expect(prompt).toContain("content");
    expect(prompt).toContain("priority");
    expect(prompt).toContain("milestone_id");
    expect(prompt).toContain("sprint_id");
    expect(prompt).toContain("release_id");
    expect(prompt).toContain("labels");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("reasoning");
  });

  it("instructs the agent to use issue template context when present", () => {
    const prompt = buildAutoIssueSystemPrompt("REEF");
    expect(prompt).toContain("Issue Templates");
    expect(prompt).toContain("read_template");
    expect(prompt).toContain("markdown body as the structural basis");
  });
});

describe("buildAutoIssueUserPrompt", () => {
  const baseActivity = {
    eventType: "pull_request",
    actor: "minsu",
    sourceRepo: "myorg/myapp",
  };

  it("includes PR number, title and branch", () => {
    const prompt = buildAutoIssueUserPrompt({
      activity: {
        ...baseActivity,
        pr: {
          number: 42,
          title: "Add rate limiting",
          headBranch: "feature/rate-limit",
          createdAt: "2026-04-07T08:00:00Z",
          updatedAt: "2026-04-07T12:00:00Z",
          commitMessages: ["feat: add rate limiting middleware"],
        },
      },
    });
    expect(prompt).toContain("42");
    expect(prompt).toContain("Add rate limiting");
    expect(prompt).toContain("feature/rate-limit");
    expect(prompt).toContain("Activity date: 2026-04-07T08:00:00Z");
    expect(prompt).toContain("Created: 2026-04-07T08:00:00Z");
  });

  it("includes commit hash (first 7 chars) and message", () => {
    const prompt = buildAutoIssueUserPrompt({
      activity: {
        ...baseActivity,
        commit: {
          hash: "abc1234def5678",
          message: "fix: correct token expiry logic",
          branch: "main",
          authoredDate: "2026-04-06T09:00:00Z",
          committedDate: "2026-04-06T10:00:00Z",
          changedFiles: ["src/auth.ts"],
        },
      },
    });
    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("fix: correct token expiry logic");
    expect(prompt).toContain("Activity date: 2026-04-06T10:00:00Z");
    expect(prompt).toContain("Committed: 2026-04-06T10:00:00Z");
  });

  it("does not include static existing issue context", () => {
    const prompt = buildAutoIssueUserPrompt({
      activity: { ...baseActivity },
    });
    expect(prompt).not.toContain("Existing Issues Context");
    expect(prompt).not.toContain("REEF-001");
  });

  it("shows no template catalog when no templates are available", () => {
    const prompt = buildAutoIssueUserPrompt({
      activity: { ...baseActivity },
    });
    expect(prompt).toContain("Issue Templates:");
    expect(prompt).toContain("(none)");
  });

  it("includes issue template catalog summary without markdown body", () => {
    const prompt = buildAutoIssueUserPrompt({
      activity: { ...baseActivity },
      templateCatalog: [
        {
          name: "bug",
          label: "Bug Report",
          description: "Use for regressions",
          title_prefix: "Bug: ",
          priority: "high",
          default_labels: ["bug", "needs-triage"],
        },
      ],
    });
    expect(prompt).toContain("Issue Templates:");
    expect(prompt).toContain("name:bug");
    expect(prompt).toContain("label:Bug Report");
    expect(prompt).toContain("title_prefix:Bug: ");
    expect(prompt).toContain("default_labels:[bug, needs-triage]");
    expect(prompt).not.toContain("## Problem");
    expect(prompt).not.toContain("## Expected Behavior");
  });

  it("includes assignable planning context when available", () => {
    const prompt = buildAutoIssueUserPrompt({
      activity: { ...baseActivity },
      planningCatalog: {
        sprints: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Sprint 12",
            status: "active",
            start_date: "2026-04-01",
            end_date: "2026-04-14",
            goal: "Ship onboarding",
          },
        ],
        milestones: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Beta",
            status: "open",
            target_date: "2026-04-30",
            description: "",
          },
        ],
        releases: [],
      },
    });
    expect(prompt).toContain("## Planning Context");
    expect(prompt).toContain("Sprint 12");
    expect(prompt).toContain("22222222-2222-4222-8222-222222222222");
    expect(prompt).toContain("Do not infer from date ranges alone");
  });
});
