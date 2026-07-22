import type {
  JiraIssueDeferredItem,
  JiraPlanningAssociation,
} from "./importPlan.js";

export const planAssociations = (
  kind: "version" | "sprint",
  relations: readonly {
    sourceKey: string;
    sourceId: string;
    name: string | null;
  }[],
  mappings: Readonly<Record<string, string>>,
  configuredPrimary: string | undefined,
  deferred: JiraIssueDeferredItem[],
): JiraPlanningAssociation[] => {
  const selected =
    relations.length === 1
      ? relations[0]?.sourceKey
      : configuredPrimary &&
          relations.some((item) => item.sourceKey === configuredPrimary)
        ? configuredPrimary
        : undefined;
  const selectionReason =
    relations.length === 1
      ? "single_relation"
      : selected
        ? "configured_primary"
        : "owner_decision_required";

  if (relations.length > 1 && !selected) {
    for (const relation of relations) {
      deferred.push({
        kind: kind === "version" ? "release" : "sprint",
        reason: "owner_decision_required",
        sourceKey: relation.sourceKey,
        targetId: mappings[relation.sourceKey] ?? null,
      });
    }
  }

  return relations.map((relation) => {
    const primary = relation.sourceKey === selected;
    const targetId = mappings[relation.sourceKey] ?? null;
    if (!targetId) {
      deferred.push({
        kind: kind === "version" ? "release" : "sprint",
        reason:
          kind === "version" ? "needs_release_mapping" : "needs_sprint_mapping",
        sourceKey: relation.sourceKey,
        targetId: null,
      });
    }
    return {
      kind,
      sourceKey: relation.sourceKey,
      sourceId: relation.sourceId,
      name: relation.name,
      primary,
      selectionReason,
      targetId,
    };
  });
};
