import { describe, expect, it } from "vitest";
import {
  buildJiraAccountMigrationReport,
  buildUnmappedJiraUsersCustomFields,
  collectJiraUserObservations,
  createJiraAccountMappingArtifact,
  mapJiraChangelogActor,
  mapJiraCommentActor,
  mapJiraIssueActors,
  upsertJiraAccountMappingArtifact,
} from "./accountMapping.js";
import {
  jiraChangelogPageFixture,
  jiraCommentPageFixture,
  jiraIssueFixture,
} from "./fixtures.js";
import {
  JiraChangelogPageSchema,
  JiraCommentPageSchema,
  JiraIssueSchema,
} from "./payloads.js";

const directory = [
  {
    actor: "reef-operator",
    emailAddress: "operator@example.com",
  },
] as const;

const first = <T>(items: readonly T[]): T => {
  const item = items[0];
  if (!item) throw new Error("expected fixture item");
  return item;
};

describe("Jira account mapping", () => {
  it("collects Jira user originals, maps actors, and preserves unmapped fallback users", () => {
    const issue = JiraIssueSchema.parse(jiraIssueFixture);
    const comments = JiraCommentPageSchema.parse(
      jiraCommentPageFixture,
    ).comments;
    const changelog = JiraChangelogPageSchema.parse(
      jiraChangelogPageFixture,
    ).values;
    const artifact = createJiraAccountMappingArtifact({
      jiraCloudId: "cloud-abc",
      overrides: {
        "acct-reporter": {
          actor: "reef-requester",
          reason: "requester account uses a shared email alias in Jira",
        },
      },
    });

    const observations = collectJiraUserObservations({
      issue,
      comments,
      changelog,
    });
    const { artifact: nextArtifact, report } = upsertJiraAccountMappingArtifact(
      {
        artifact,
        observations: [...observations, first(observations)],
        directory,
        observedAt: "2026-07-09T07:00:00.000Z",
      },
    );
    const migrationReport = buildJiraAccountMigrationReport(
      nextArtifact,
      report,
    );

    expect(migrationReport).toMatchObject({
      jiraCloudId: "cloud-abc",
      users: expect.arrayContaining([
        {
          accountId: "acct-assignee",
          emailAddress: "operator@example.com",
          displayName: "Operator",
          active: true,
          accountType: "atlassian",
          actor: "reef-operator",
          mappingStrategy: "email",
          projectKeys: ["ALPHA"],
        },
        {
          accountId: "acct-reporter",
          emailAddress: "requester@example.com",
          displayName: "Requester",
          active: true,
          accountType: "atlassian",
          actor: "reef-requester",
          mappingStrategy: "override",
          projectKeys: ["ALPHA"],
        },
      ]),
      changes: {
        added: expect.arrayContaining([
          {
            accountId: "acct-assignee",
            actor: "reef-operator",
            changedFields: [],
          },
          {
            accountId: "acct-commenter",
            actor: "jira:acct-commenter",
            changedFields: [],
          },
        ]),
      },
    });
    expect(
      (["added", "changed", "unchanged"] as const).flatMap((kind) =>
        report[kind]
          .filter((change) => change.accountId === "acct-assignee")
          .map(() => kind),
      ),
    ).toEqual(["added"]);

    const issueActors = mapJiraIssueActors(issue, {
      artifact: nextArtifact,
      directory,
    });
    const commentActor = mapJiraCommentActor(first(comments), {
      artifact: nextArtifact,
      directory,
    });
    const changelogActor = mapJiraChangelogActor(first(changelog), {
      artifact: nextArtifact,
      directory,
    });

    expect(issueActors).toMatchObject({
      assignee: { actor: "reef-operator", strategy: "email" },
      reporter: { actor: "reef-requester", strategy: "override" },
      requester: { actor: "reef-requester", strategy: "override" },
    });
    expect(commentActor).toMatchObject({
      context: "comment_author",
      actor: "jira:acct-commenter",
      strategy: "fallback",
    });
    expect(changelogActor).toMatchObject({
      context: "changelog_actor",
      actor: "reef-operator",
      strategy: "email",
    });

    expect(
      buildUnmappedJiraUsersCustomFields([
        issueActors.assignee,
        issueActors.reporter,
        issueActors.requester,
        commentActor,
        changelogActor,
      ]),
    ).toEqual({
      jira: {
        users: [
          {
            context: "comment_author",
            actor: "jira:acct-commenter",
            accountId: "acct-commenter",
            emailAddress: "commenter@example.com",
            displayName: "Commenter",
            active: true,
            accountType: "atlassian",
            raw: {
              accountId: "acct-commenter",
              emailAddress: "commenter@example.com",
              displayName: "Commenter",
              active: true,
              accountType: "atlassian",
            },
          },
        ],
      },
    });
  });

  it("shares a cloud account artifact across synthetic projects and reports idempotent changes", () => {
    const alphaIssue = JiraIssueSchema.parse(jiraIssueFixture);
    const betaIssue = JiraIssueSchema.parse({
      ...jiraIssueFixture,
      key: "BETA-1",
      fields: {
        ...jiraIssueFixture.fields,
        project: {
          ...jiraIssueFixture.fields.project,
          key: "BETA",
          name: "Beta",
        },
      },
    });
    const renamedBetaIssue = JiraIssueSchema.parse({
      ...jiraIssueFixture,
      key: "BETA-1",
      fields: {
        ...jiraIssueFixture.fields,
        project: {
          ...jiraIssueFixture.fields.project,
          key: "BETA",
          name: "Beta",
        },
        assignee: {
          ...jiraIssueFixture.fields.assignee,
          displayName: "Operator Renamed",
        },
      },
    });
    const privacyFilteredIssue = JiraIssueSchema.parse({
      ...jiraIssueFixture,
      fields: {
        ...jiraIssueFixture.fields,
        assignee: {
          accountId: "acct-assignee",
          displayName: "Operator",
          active: true,
          accountType: "atlassian",
        },
      },
    });
    const onlyAssignee = (issue: typeof alphaIssue) =>
      collectJiraUserObservations({ issue }).filter(
        (observation) => observation.user.accountId === "acct-assignee",
      );
    let artifact = createJiraAccountMappingArtifact({
      jiraCloudId: "cloud-abc",
    });

    let result = upsertJiraAccountMappingArtifact({
      artifact,
      observations: onlyAssignee(alphaIssue),
      directory,
      observedAt: "2026-07-09T07:00:00.000Z",
    });
    expect(result.report.added).toHaveLength(1);
    artifact = result.artifact;

    result = upsertJiraAccountMappingArtifact({
      artifact,
      observations: onlyAssignee(privacyFilteredIssue),
      directory: [],
      observedAt: "2026-07-09T07:00:30.000Z",
    });
    expect(result.report).toMatchObject({
      added: [],
      changed: [],
      unchanged: [
        {
          accountId: "acct-assignee",
          actor: "reef-operator",
          changedFields: [],
        },
      ],
    });
    expect(result.artifact.accounts["acct-assignee"]).toMatchObject({
      actor: "reef-operator",
      emailAddress: "operator@example.com",
      mappingStrategy: "email",
    });
    artifact = result.artifact;

    result = upsertJiraAccountMappingArtifact({
      artifact,
      observations: onlyAssignee(alphaIssue),
      directory,
      observedAt: "2026-07-09T07:01:00.000Z",
    });
    expect(result.report).toMatchObject({
      added: [],
      changed: [],
      unchanged: [
        {
          accountId: "acct-assignee",
          actor: "reef-operator",
          changedFields: [],
        },
      ],
    });
    artifact = result.artifact;

    result = upsertJiraAccountMappingArtifact({
      artifact,
      observations: onlyAssignee(betaIssue),
      directory,
      observedAt: "2026-07-09T07:02:00.000Z",
    });
    expect(result.report.changed).toEqual([
      {
        accountId: "acct-assignee",
        actor: "reef-operator",
        changedFields: ["projectKeys"],
      },
    ]);
    expect(result.artifact.accounts["acct-assignee"]?.projectKeys).toEqual([
      "ALPHA",
      "BETA",
    ]);
    artifact = result.artifact;

    result = upsertJiraAccountMappingArtifact({
      artifact,
      observations: onlyAssignee(renamedBetaIssue),
      directory,
      observedAt: "2026-07-09T07:03:00.000Z",
    });
    expect(result.report.changed).toEqual([
      {
        accountId: "acct-assignee",
        actor: "reef-operator",
        changedFields: ["displayName"],
      },
    ]);
    expect(
      buildJiraAccountMigrationReport(result.artifact, result.report),
    ).toMatchObject({
      users: [
        {
          accountId: "acct-assignee",
          displayName: "Operator Renamed",
          projectKeys: ["ALPHA", "BETA"],
        },
      ],
      changes: {
        changed: [
          {
            accountId: "acct-assignee",
            changedFields: ["displayName"],
          },
        ],
      },
    });
  });

  it("uses the same resolver precedence for Jira issue creators", () => {
    const issue = JiraIssueSchema.parse({
      ...jiraIssueFixture,
      fields: {
        ...jiraIssueFixture.fields,
        creator: {
          accountId: "acct-creator",
          emailAddress: "operator@example.com",
          displayName: "Creator",
        },
      },
    });
    const artifact = createJiraAccountMappingArtifact({
      jiraCloudId: "cloud-abc",
    });
    expect(collectJiraUserObservations({ issue })).toContainEqual(
      expect.objectContaining({ context: "creator", issueKey: "ALPHA-1" }),
    );
    expect(
      mapJiraIssueActors(issue, { artifact, directory }).creator,
    ).toMatchObject({
      context: "creator",
      actor: "reef-operator",
      strategy: "email",
    });
  });

  it("stops using an override after the operator removes it from the artifact", () => {
    const issue = JiraIssueSchema.parse(jiraIssueFixture);
    const reporterObservation = collectJiraUserObservations({ issue }).filter(
      (observation) => observation.user.accountId === "acct-reporter",
    );
    let artifact = createJiraAccountMappingArtifact({
      jiraCloudId: "cloud-abc",
      overrides: {
        "acct-reporter": {
          actor: "reef-requester",
          reason: "operator confirmed requester account",
        },
      },
    });

    let result = upsertJiraAccountMappingArtifact({
      artifact,
      observations: reporterObservation,
      observedAt: "2026-07-09T07:00:00.000Z",
    });
    artifact = result.artifact;
    expect(artifact.accounts["acct-reporter"]).toMatchObject({
      actor: "reef-requester",
      mappingStrategy: "override",
      overrideReason: "operator confirmed requester account",
    });

    result = upsertJiraAccountMappingArtifact({
      artifact: { ...artifact, overrides: {} },
      observations: reporterObservation,
      directory: [],
      observedAt: "2026-07-09T08:00:00.000Z",
    });

    expect(result.artifact.accounts["acct-reporter"]).toMatchObject({
      actor: "jira:acct-reporter",
      mappingStrategy: "fallback",
      overrideReason: null,
    });
    expect(result.report.changed).toEqual([
      {
        accountId: "acct-reporter",
        actor: "jira:acct-reporter",
        changedFields: ["actor", "mappingStrategy", "overrideReason"],
      },
    ]);
    expect(
      mapJiraIssueActors(issue, { artifact: result.artifact }).reporter,
    ).toMatchObject({
      actor: "jira:acct-reporter",
      strategy: "fallback",
      overrideReason: null,
    });
  });
});
