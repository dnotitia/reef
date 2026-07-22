import type { ClosedReason, IssueType, Priority, Status } from "@reef/core";
import type {
  JiraAccountMappingArtifact,
  ReefActorDirectoryEntry,
} from "../accounts/mapping.js";
import type { RawArchiveReference } from "../archive/model.js";
import type {
  JiraFieldCatalogSnapshot,
  JiraFieldOverrides,
} from "../jira/fieldCatalog.js";
import type { JiraIssuePayload } from "../payloads.js";
import type { JiraPlanningTargetMappings } from "../planning/entities.js";
import type { JiraRankImportPlan } from "../planning/rank.js";

export interface JiraStatusMappingRule {
  id?: string;
  name?: string;
  categoryKey?: string;
  status: Status;
  closedReason?: ClosedReason;
}

export interface JiraIssueTypeMappingRule {
  id?: string;
  name?: string;
  issueType: IssueType;
}

export interface JiraPriorityMappingRule {
  id?: string;
  name?: string;
  priority: Priority;
}

export interface JiraIssueMappingPolicy {
  statuses: readonly JiraStatusMappingRule[];
  issueTypes: readonly JiraIssueTypeMappingRule[];
  priorities: readonly JiraPriorityMappingRule[];
}

export interface JiraIssueRawArchiveReferences {
  issue?: RawArchiveReference;
  descriptionAdf?: RawArchiveReference;
  watcherList?: RawArchiveReference;
  media?: Readonly<Record<string, RawArchiveReference>>;
}

export interface BuildJiraIssueImportPlanInput {
  issue: JiraIssuePayload;
  targetReefId: string;
  jiraCloudId: string;
  targetVault: string;
  runAt: string;
  migrationActor: string;
  fieldCatalog: JiraFieldCatalogSnapshot;
  fieldOverrides?: JiraFieldOverrides;
  policy: JiraIssueMappingPolicy;
  accountMapping: {
    artifact: JiraAccountMappingArtifact;
    directory?: readonly ReefActorDirectoryEntry[];
  };
  planningMappings: JiraPlanningTargetMappings;
  targetIdsByJiraKey: Readonly<Record<string, string>>;
  configuredPrimary?: {
    releaseSourceKey?: string;
    sprintSourceKey?: string;
  };
  rankPlan?: JiraRankImportPlan | null;
  rawArchiveReferences: JiraIssueRawArchiveReferences;
}
