import type {
  JiraChangelogHistoryPayload,
  NormalizedJiraSprint,
} from "../payloads.js";

export type JiraSprintHistoryClassification =
  | "long_running"
  | "rollover"
  | "indeterminate";

export interface JiraSprintHistoryRelation {
  sourceKey: string;
  sourceId: string;
  name: string | null;
}

export interface JiraSprintHistoryResult {
  classification: JiraSprintHistoryClassification;
  primarySourceKey: string | undefined;
  activitySprintIds: readonly string[];
}

const sprintHistoryField = (field: string, fieldId: string | null): boolean =>
  fieldId === "customfield_10020" || field.trim().toLowerCase() === "sprint";

const parseDate = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const sprintWindow = (
  sprint: NormalizedJiraSprint,
): { start: number; end: number } | null => {
  const start = parseDate(sprint.startDate);
  const end = parseDate(sprint.endDate ?? sprint.completeDate);
  if (start === null || end === null || end < start) return null;
  return { start, end };
};

const currentSprintOrder = (
  relations: readonly JiraSprintHistoryRelation[],
  catalog: readonly NormalizedJiraSprint[],
): JiraSprintHistoryRelation[] => {
  const byId = new Map(catalog.map((sprint) => [String(sprint.id), sprint]));
  return relations
    .map((relation, index) => ({
      relation,
      index,
      sprint: byId.get(relation.sourceId),
    }))
    .sort((left, right) => {
      const leftStart = left.sprint ? parseDate(left.sprint.startDate) : null;
      const rightStart = right.sprint
        ? parseDate(right.sprint.startDate)
        : null;
      if (
        leftStart !== null &&
        rightStart !== null &&
        leftStart !== rightStart
      ) {
        return leftStart - rightStart;
      }
      return left.index - right.index;
    })
    .map(({ relation }) => relation);
};

/**
 * Distinguishes a genuine multi-sprint work span from a ticket that was merely
 * carried forward.  Jira's Sprint field is a cumulative array, so the array
 * itself is not evidence of work in every sprint.  Changelog activity in two
 * dated sprint windows is the positive signal for `long_running`; otherwise a
 * dated cumulative history is classified as `rollover`.
 */
export const classifyJiraSprintHistory = (input: {
  relations: readonly JiraSprintHistoryRelation[];
  catalog: readonly NormalizedJiraSprint[];
  changelog: readonly JiraChangelogHistoryPayload[];
}): JiraSprintHistoryResult => {
  if (input.relations.length <= 1) {
    return {
      classification: "indeterminate",
      primarySourceKey: input.relations[0]?.sourceKey,
      activitySprintIds: [],
    };
  }
  const byId = new Map(
    input.catalog.map((sprint) => [String(sprint.id), sprint]),
  );
  const ordered = currentSprintOrder(input.relations, input.catalog);
  const windows = ordered.flatMap((relation) => {
    const sprint = byId.get(relation.sourceId);
    const window = sprint ? sprintWindow(sprint) : null;
    return window ? [{ relation, window }] : [];
  });
  if (windows.length < 2 || input.changelog.length === 0) {
    return {
      classification: "indeterminate",
      primarySourceKey: ordered.at(-1)?.sourceKey,
      activitySprintIds: [],
    };
  }

  const activitySprintIds = new Set<string>();
  for (const history of input.changelog) {
    const timestamp = parseDate(history.created);
    if (timestamp === null) continue;
    const hasWorkActivity = history.items.some(
      (item) => !sprintHistoryField(item.field, item.fieldId ?? null),
    );
    if (!hasWorkActivity) continue;
    const activeWindow = windows.find(
      ({ window }) => timestamp >= window.start && timestamp <= window.end,
    );
    if (activeWindow) activitySprintIds.add(activeWindow.relation.sourceId);
  }

  const activityOrder = windows.filter(({ relation }) =>
    activitySprintIds.has(relation.sourceId),
  );
  if (activityOrder.length >= 2) {
    return {
      classification: "long_running",
      primarySourceKey: activityOrder.at(-1)?.relation.sourceKey,
      activitySprintIds: [...activitySprintIds],
    };
  }
  return {
    classification: "rollover",
    primarySourceKey: ordered.at(-1)?.sourceKey,
    activitySprintIds: [...activitySprintIds],
  };
};
