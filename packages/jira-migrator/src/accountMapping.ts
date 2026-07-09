import {
  type JiraChangelogItemPayload,
  type JiraCommentPayload,
  type JiraIssuePayload,
  type JiraUserPayload,
  type NormalizedJiraUser,
  normalizeJiraUser,
} from "./payloads.js";

export type JiraActorMappingContext =
  | "assignee"
  | "reporter"
  | "requester"
  | "comment_author"
  | "changelog_actor";

export type JiraActorMappingStrategy =
  | "override"
  | "email"
  | "fallback"
  | "missing";

export interface ReefActorDirectoryEntry {
  actor: string;
  emailAddress: string | readonly string[];
  displayName?: string;
}

export interface JiraAccountOverride {
  actor: string;
  reason?: string;
}

export interface JiraAccountMappingRecord {
  accountId: string;
  emailAddress: string | null;
  displayName: string | null;
  active: boolean | null;
  accountType: string | null;
  actor: string;
  mappingStrategy: Exclude<JiraActorMappingStrategy, "missing">;
  overrideReason: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  projectKeys: string[];
}

export interface JiraAccountMappingArtifact {
  version: 1;
  jiraCloudId: string;
  accounts: Record<string, JiraAccountMappingRecord>;
  overrides: Record<string, JiraAccountOverride>;
}

export interface JiraActorMappingResult {
  context: JiraActorMappingContext;
  actor: string | null;
  strategy: JiraActorMappingStrategy;
  jiraUser: NormalizedJiraUser | null;
  overrideReason: string | null;
}

export interface JiraUserObservation {
  context: JiraActorMappingContext;
  issueKey: string;
  projectKey: string | null;
  user: NormalizedJiraUser;
}

export interface JiraAccountChange {
  accountId: string;
  actor: string;
  changedFields: string[];
}

export interface JiraAccountMappingChangeReport {
  added: JiraAccountChange[];
  changed: JiraAccountChange[];
  unchanged: JiraAccountChange[];
}

type JiraAccountChangeKind = keyof JiraAccountMappingChangeReport;

interface PendingJiraAccountChange {
  kind: JiraAccountChangeKind;
  change: JiraAccountChange;
}

export interface UpsertJiraAccountMappingOptions {
  artifact: JiraAccountMappingArtifact;
  observations: readonly JiraUserObservation[];
  directory?: readonly ReefActorDirectoryEntry[];
  observedAt: string;
}

export interface JiraAccountReportUser {
  accountId: string;
  emailAddress: string | null;
  displayName: string | null;
  active: boolean | null;
  accountType: string | null;
  actor: string;
  mappingStrategy: Exclude<JiraActorMappingStrategy, "missing">;
  projectKeys: string[];
}

export interface JiraAccountMigrationReport {
  jiraCloudId: string;
  users: JiraAccountReportUser[];
  changes: JiraAccountMappingChangeReport;
}

export interface JiraUsersCustomFields {
  jira: {
    users: Array<{
      context: JiraActorMappingContext;
      actor: string | null;
      accountId: string | null;
      emailAddress: string | null;
      displayName: string | null;
      active: boolean | null;
      accountType: string | null;
      raw: JiraUserPayload;
    }>;
  };
}

const emptyChangeReport = (): JiraAccountMappingChangeReport => ({
  added: [],
  changed: [],
  unchanged: [],
});

const normalizeEmail = (email: string | null | undefined): string | null => {
  const trimmed = email?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
};

const sortedUnique = (values: readonly string[]): string[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));

const fallbackActorForAccount = (accountId: string): string =>
  `jira:${accountId}`;

const toNormalizedJiraUser = (
  user: JiraUserPayload | NormalizedJiraUser | null | undefined,
): NormalizedJiraUser | null => {
  if (!user) return null;
  return typeof user === "object" && "raw" in user
    ? (user as NormalizedJiraUser)
    : normalizeJiraUser(user as JiraUserPayload);
};

const findDirectoryActor = (
  emailAddress: string | null,
  directory: readonly ReefActorDirectoryEntry[],
): string | null => {
  const normalizedEmail = normalizeEmail(emailAddress);
  if (!normalizedEmail) return null;

  for (const entry of directory) {
    const emails = Array.isArray(entry.emailAddress)
      ? entry.emailAddress
      : [entry.emailAddress];
    if (emails.some((email) => normalizeEmail(email) === normalizedEmail)) {
      return entry.actor;
    }
  }

  return null;
};

const observedProjectKeys = (
  existing: readonly string[],
  projectKey: string | null,
): string[] => sortedUnique(projectKey ? [...existing, projectKey] : existing);

const changedFields = (
  before: JiraAccountMappingRecord,
  after: JiraAccountMappingRecord,
): string[] => {
  const fields: Array<keyof JiraAccountMappingRecord> = [
    "emailAddress",
    "displayName",
    "active",
    "accountType",
    "actor",
    "mappingStrategy",
    "overrideReason",
  ];
  const changed = fields.filter((field) => before[field] !== after[field]);
  if (before.projectKeys.join("\0") !== after.projectKeys.join("\0")) {
    changed.push("projectKeys");
  }
  return changed;
};

const mergeChangeFields = (
  left: readonly string[],
  right: readonly string[],
): string[] => sortedUnique([...left, ...right]);

const coalesceChange = (
  current: PendingJiraAccountChange | undefined,
  kind: JiraAccountChangeKind,
  change: JiraAccountChange,
): PendingJiraAccountChange => {
  if (!current) return { kind, change };
  if (current.kind === "added") {
    return {
      kind: "added",
      change: {
        ...change,
        changedFields: mergeChangeFields(
          current.change.changedFields,
          change.changedFields,
        ),
      },
    };
  }
  if (current.kind === "changed" || kind === "unchanged") {
    return {
      kind: current.kind,
      change: {
        ...change,
        changedFields: mergeChangeFields(
          current.change.changedFields,
          change.changedFields,
        ),
      },
    };
  }
  return { kind, change };
};

export const createJiraAccountMappingArtifact = (input: {
  jiraCloudId: string;
  overrides?: Record<string, JiraAccountOverride>;
}): JiraAccountMappingArtifact => ({
  version: 1,
  jiraCloudId: input.jiraCloudId,
  accounts: {},
  overrides: input.overrides ?? {},
});

export const resolveJiraActor = (
  context: JiraActorMappingContext,
  user: JiraUserPayload | NormalizedJiraUser | null | undefined,
  options: {
    artifact: JiraAccountMappingArtifact;
    directory?: readonly ReefActorDirectoryEntry[];
  },
): JiraActorMappingResult => {
  const jiraUser = toNormalizedJiraUser(user);
  if (!jiraUser?.accountId) {
    return {
      context,
      actor: null,
      strategy: "missing",
      jiraUser,
      overrideReason: null,
    };
  }

  const override = options.artifact.overrides[jiraUser.accountId];
  if (override) {
    return {
      context,
      actor: override.actor,
      strategy: "override",
      jiraUser,
      overrideReason: override.reason ?? null,
    };
  }

  const emailActor = findDirectoryActor(
    jiraUser.emailAddress,
    options.directory ?? [],
  );
  if (emailActor) {
    return {
      context,
      actor: emailActor,
      strategy: "email",
      jiraUser,
      overrideReason: null,
    };
  }

  const existing = options.artifact.accounts[jiraUser.accountId];
  if (existing) {
    return {
      context,
      actor: existing.actor,
      strategy: existing.mappingStrategy,
      jiraUser,
      overrideReason: existing.overrideReason,
    };
  }

  return {
    context,
    actor: fallbackActorForAccount(jiraUser.accountId),
    strategy: "fallback",
    jiraUser,
    overrideReason: null,
  };
};

export const collectJiraUserObservations = (input: {
  issue: JiraIssuePayload;
  comments?: readonly JiraCommentPayload[];
  changelog?: readonly JiraChangelogItemPayload[];
}): JiraUserObservation[] => {
  const projectKey = input.issue.fields.project?.key ?? null;
  const observations: JiraUserObservation[] = [];
  const push = (
    context: JiraActorMappingContext,
    user: JiraUserPayload | null | undefined,
  ): void => {
    const normalized = normalizeJiraUser(user);
    if (!normalized) return;
    observations.push({
      context,
      issueKey: input.issue.key,
      projectKey,
      user: normalized,
    });
  };

  push("assignee", input.issue.fields.assignee);
  push("reporter", input.issue.fields.reporter);
  for (const comment of input.comments ?? []) {
    push("comment_author", comment.author);
  }
  for (const item of input.changelog ?? []) {
    push("changelog_actor", item.author);
  }

  return observations;
};

export const upsertJiraAccountMappingArtifact = ({
  artifact,
  observations,
  directory = [],
  observedAt,
}: UpsertJiraAccountMappingOptions): {
  artifact: JiraAccountMappingArtifact;
  report: JiraAccountMappingChangeReport;
} => {
  const next: JiraAccountMappingArtifact = {
    ...artifact,
    accounts: { ...artifact.accounts },
    overrides: { ...artifact.overrides },
  };
  const reportByAccount = new Map<string, PendingJiraAccountChange>();

  for (const observation of observations) {
    const accountId = observation.user.accountId;
    if (!accountId) continue;

    const mapping = resolveJiraActor(observation.context, observation.user, {
      artifact: next,
      directory,
    });
    if (!mapping.actor || mapping.strategy === "missing") continue;

    const existing = next.accounts[accountId];
    const record: JiraAccountMappingRecord = {
      accountId,
      emailAddress:
        observation.user.emailAddress ?? existing?.emailAddress ?? null,
      displayName:
        observation.user.displayName ?? existing?.displayName ?? null,
      active: observation.user.active ?? existing?.active ?? null,
      accountType:
        observation.user.accountType ?? existing?.accountType ?? null,
      actor: mapping.actor,
      mappingStrategy: mapping.strategy,
      overrideReason: mapping.overrideReason,
      firstSeenAt: existing?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      projectKeys: observedProjectKeys(
        existing?.projectKeys ?? [],
        observation.projectKey,
      ),
    };

    const change = {
      accountId,
      actor: record.actor,
      changedFields: existing ? changedFields(existing, record) : [],
    };
    if (!existing) {
      reportByAccount.set(
        accountId,
        coalesceChange(reportByAccount.get(accountId), "added", change),
      );
    } else if (change.changedFields.length > 0) {
      reportByAccount.set(
        accountId,
        coalesceChange(reportByAccount.get(accountId), "changed", change),
      );
    } else {
      reportByAccount.set(
        accountId,
        coalesceChange(reportByAccount.get(accountId), "unchanged", change),
      );
    }
    next.accounts[accountId] = record;
  }

  const report = emptyChangeReport();
  for (const { kind, change } of reportByAccount.values()) {
    report[kind].push(change);
  }

  return { artifact: next, report };
};

export const buildJiraAccountMigrationReport = (
  artifact: JiraAccountMappingArtifact,
  changes: JiraAccountMappingChangeReport = emptyChangeReport(),
): JiraAccountMigrationReport => ({
  jiraCloudId: artifact.jiraCloudId,
  users: Object.values(artifact.accounts)
    .sort((left, right) => left.accountId.localeCompare(right.accountId))
    .map((record) => ({
      accountId: record.accountId,
      emailAddress: record.emailAddress,
      displayName: record.displayName,
      active: record.active,
      accountType: record.accountType,
      actor: record.actor,
      mappingStrategy: record.mappingStrategy,
      projectKeys: record.projectKeys,
    })),
  changes,
});

export const buildUnmappedJiraUsersCustomFields = (
  results: readonly JiraActorMappingResult[],
): JiraUsersCustomFields | null => {
  const users = results
    .filter((result) => result.strategy === "fallback")
    .filter((result) => result.jiraUser !== null)
    .map((result) => {
      const jiraUser = result.jiraUser as NormalizedJiraUser;
      return {
        context: result.context,
        actor: result.actor,
        accountId: jiraUser.accountId,
        emailAddress: jiraUser.emailAddress,
        displayName: jiraUser.displayName,
        active: jiraUser.active,
        accountType: jiraUser.accountType,
        raw: jiraUser.raw,
      };
    });

  return users.length > 0 ? { jira: { users } } : null;
};

export const mapJiraIssueActors = (
  issue: JiraIssuePayload,
  options: Parameters<typeof resolveJiraActor>[2],
): {
  assignee: JiraActorMappingResult;
  reporter: JiraActorMappingResult;
  requester: JiraActorMappingResult;
} => ({
  assignee: resolveJiraActor("assignee", issue.fields.assignee, options),
  reporter: resolveJiraActor("reporter", issue.fields.reporter, options),
  requester: resolveJiraActor("requester", issue.fields.reporter, options),
});

export const mapJiraCommentActor = (
  comment: JiraCommentPayload,
  options: Parameters<typeof resolveJiraActor>[2],
): JiraActorMappingResult =>
  resolveJiraActor("comment_author", comment.author, options);

export const mapJiraChangelogActor = (
  item: JiraChangelogItemPayload,
  options: Parameters<typeof resolveJiraActor>[2],
): JiraActorMappingResult =>
  resolveJiraActor("changelog_actor", item.author, options);
