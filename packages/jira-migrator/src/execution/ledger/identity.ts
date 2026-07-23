import { z } from "zod";

export const JiraMigrationEntityKindSchema = z.enum([
  "version",
  "sprint",
  "issue",
  "comment",
  "attachment",
  "changelog_history",
  "relation",
]);
export type JiraMigrationEntityKind = z.infer<
  typeof JiraMigrationEntityKindSchema
>;

const sourceIdentityBase = {
  jira_cloud_id: z.string().min(1),
  key: z.string().min(1),
};

export const JiraMigrationSourceIdentitySchema = z.discriminatedUnion(
  "entity_kind",
  [
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("version"),
        project_id: z.string().min(1),
        version_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("sprint"),
        sprint_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("issue"),
        project_id: z.string().min(1),
        issue_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("comment"),
        issue_id: z.string().min(1),
        comment_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("attachment"),
        issue_id: z.string().min(1).optional(),
        attachment_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("changelog_history"),
        issue_id: z.string().min(1),
        history_id: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...sourceIdentityBase,
        entity_kind: z.literal("relation"),
        source_project_key: z.string().min(1).optional(),
        source_issue_id: z.string().min(1),
        target_issue_id: z.string().min(1),
        link_type: z.string().min(1),
        direction: z.string().min(1),
        link_id: z.string().min(1),
      })
      .strict(),
  ],
);
export type JiraMigrationSourceIdentity = z.infer<
  typeof JiraMigrationSourceIdentitySchema
>;

const encodedKey = (kind: string, parts: readonly string[]): string =>
  `${kind}:${parts.map((value) => encodeURIComponent(value)).join(":")}`;

const canonicalSourceKey = (identity: JiraMigrationSourceIdentity): string => {
  switch (identity.entity_kind) {
    case "version":
      return encodedKey("version", [
        identity.jira_cloud_id,
        identity.project_id,
        identity.version_id,
      ]);
    case "sprint":
      return encodedKey("sprint", [identity.jira_cloud_id, identity.sprint_id]);
    case "issue":
      return encodedKey("issue", [
        identity.jira_cloud_id,
        identity.project_id,
        identity.issue_id,
      ]);
    case "comment":
      return encodedKey("comment", [
        identity.jira_cloud_id,
        identity.issue_id,
        identity.comment_id,
      ]);
    case "attachment":
      return encodedKey("attachment", [
        identity.jira_cloud_id,
        identity.attachment_id,
      ]);
    case "changelog_history":
      return encodedKey("changelog_history", [
        identity.jira_cloud_id,
        identity.issue_id,
        identity.history_id,
      ]);
    case "relation":
      return encodedKey("relation", [identity.jira_cloud_id, identity.link_id]);
  }
};

export const sourceKeyMatchesCanonicalOrLegacy = (
  identity: JiraMigrationSourceIdentity,
  sourceKey: string,
): boolean =>
  sourceKey === canonicalSourceKey(identity) ||
  (identity.entity_kind === "relation" &&
    sourceKey ===
      legacyJiraRelationSourceKey(
        identity.jira_cloud_id,
        identity.source_issue_id,
        identity.target_issue_id,
        identity.link_type,
        identity.direction,
        identity.link_id,
      ));

export const jiraIssueSourceIdentity = (
  jiraCloudId: string,
  projectId: string,
  issueId: string,
) => ({
  entity_kind: "issue" as const,
  jira_cloud_id: jiraCloudId,
  project_id: projectId,
  issue_id: issueId,
  key: encodedKey("issue", [jiraCloudId, projectId, issueId]),
});

export const jiraCommentSourceIdentity = (
  jiraCloudId: string,
  issueId: string,
  commentId: string,
) => ({
  entity_kind: "comment" as const,
  jira_cloud_id: jiraCloudId,
  issue_id: issueId,
  comment_id: commentId,
  key: encodedKey("comment", [jiraCloudId, issueId, commentId]),
});

export const jiraAttachmentSourceIdentity = (
  jiraCloudId: string,
  issueId: string,
  attachmentId: string,
) => ({
  entity_kind: "attachment" as const,
  jira_cloud_id: jiraCloudId,
  issue_id: issueId,
  attachment_id: attachmentId,
  key: encodedKey("attachment", [jiraCloudId, attachmentId]),
});

export const jiraChangelogSourceIdentity = (
  jiraCloudId: string,
  issueId: string,
  historyId: string,
) => ({
  entity_kind: "changelog_history" as const,
  jira_cloud_id: jiraCloudId,
  issue_id: issueId,
  history_id: historyId,
  key: encodedKey("changelog_history", [jiraCloudId, issueId, historyId]),
});

export const jiraRelationSourceIdentity = (
  jiraCloudId: string,
  sourceIssueId: string,
  targetIssueId: string,
  linkType: string,
  direction: string,
  linkId: string,
  sourceProjectKey?: string,
) => ({
  entity_kind: "relation" as const,
  jira_cloud_id: jiraCloudId,
  ...(sourceProjectKey ? { source_project_key: sourceProjectKey } : {}),
  source_issue_id: sourceIssueId,
  target_issue_id: targetIssueId,
  link_type: linkType,
  direction,
  link_id: linkId,
  key: encodedKey("relation", [jiraCloudId, linkId]),
});

export const legacyJiraRelationSourceKey = (
  jiraCloudId: string,
  sourceIssueId: string,
  targetIssueId: string,
  linkType: string,
  direction: string,
  linkId: string,
): string =>
  encodedKey("relation", [
    jiraCloudId,
    sourceIssueId,
    targetIssueId,
    linkType,
    direction,
    linkId,
  ]);
