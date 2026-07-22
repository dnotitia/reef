import { fingerprintJiraState } from "../execution/diff.js";
import type {
  JiraRemoteLinkPayload,
  NormalizedJiraIssueLink,
} from "../payloads.js";
import type {
  JiraLinkMapping,
  JiraRelatedImportTarget,
  JiraRelationKind,
} from "./contracts.js";

export const sameLinkMapping = (
  mapping: JiraLinkMapping,
  link: NormalizedJiraIssueLink,
): boolean =>
  (mapping.typeId !== undefined ||
    (mapping.name !== undefined &&
      mapping.inward !== undefined &&
      mapping.outward !== undefined)) &&
  (mapping.typeId === undefined || mapping.typeId === link.typeId) &&
  (mapping.name === undefined || mapping.name === link.type) &&
  (mapping.inward === undefined || mapping.inward === link.inward) &&
  (mapping.outward === undefined || mapping.outward === link.outward);

export const canonicalRemoteLinkIdentity = (
  remote: JiraRemoteLinkPayload,
): string =>
  remote.globalId
    ? `global:${remote.globalId}`
    : `content-sha256:${fingerprintJiraState({ application: remote.application ?? null, object: remote.object, relationship: remote.relationship ?? null })}`;

export const safeRemoteLinkUrl = (value: string | undefined): string | null => {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

export const canonicalizeJiraRelation = (
  mapping: JiraLinkMapping,
  direction: NormalizedJiraIssueLink["direction"],
  currentReefId: string,
  linkedReefId: string,
): {
  sourceReefId: string;
  targetReefId: string;
  relation: JiraRelationKind;
  inverseRelation: JiraRelationKind;
} => {
  if (mapping.kind === "symmetric") {
    const [sourceReefId, targetReefId] = [currentReefId, linkedReefId].sort();
    return {
      sourceReefId,
      targetReefId,
      relation: "related_to",
      inverseRelation: "related_to",
    };
  }
  return {
    sourceReefId: direction === "outward" ? currentReefId : linkedReefId,
    targetReefId: direction === "outward" ? linkedReefId : currentReefId,
    relation: mapping.outwardRelation,
    inverseRelation: mapping.inwardRelation,
  };
};

export const reconcileProvisionalLinkRefs = async (
  target: JiraRelatedImportTarget,
  jiraCloudId: string,
  linkId: string,
): Promise<void> => {
  const keys = new Set(
    (await target.listExternalRefKeys(`jira-link:${jiraCloudId}:`)).filter(
      (key) => key.endsWith(`:${linkId}`),
    ),
  );
  for (const key of keys) {
    const existing = await target.readExternalRef(key);
    if (!existing) continue;
    if (
      existing.provenance.source !== "jira" ||
      existing.provenance.link_id !== linkId ||
      existing.provenance.unresolved !== true
    )
      throw new Error("external_ref_reconciliation_mismatch");
    await target.deleteExternalRef(key);
    if ((await target.readExternalRef(key)) !== null)
      throw new Error("external_ref_delete_readback_mismatch");
  }
};
