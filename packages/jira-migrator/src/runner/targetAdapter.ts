import {
  type ActivityEventInput,
  type AkbAdapter,
  type AkbReadIssueResult,
  type AkbUpdateIssueResult,
  type AkbWriteIssueResult,
  ConflictError,
  type IssueMetadata,
  NotFoundError,
  type PlanningCatalog,
  type Release,
  type Sprint,
  akbAllocateNextIssueId,
  akbAppendActivityEvents,
  akbClaimIssueId,
  akbCreateRelease,
  akbCreateSprint,
  akbGetCurrentActor,
  akbIssueDocumentUri,
  akbListPlanningCatalog,
  akbReadIssue,
  akbReadPlanningCreateClaim,
  akbUpdateIssue,
  akbWriteIssue,
  createAkbAdapter,
} from "@reef/core";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import type {
  JiraPlanningAction,
  JiraPlanningTargetResolution,
} from "../planning/entities.js";
import { canonicalizeJson } from "../rawArchive.js";
import type { JiraRelatedImportTarget } from "../related/contracts.js";
import { jiraOwnerIdentity } from "./ownership.js";
import { createAkbRelatedTarget } from "./relatedTargetAdapter.js";
import {
  customFieldsWithSidecar,
  issueProjection,
  issueProjectionKeys,
  parseMeta,
  sidecarFor,
} from "./targetSupport.js";

export interface AkbJiraMigrationTargetConfig {
  baseUrl: string;
  jwt: string;
  vault: string;
  issuePrefix?: string;
}

interface TargetCore {
  createAdapter(input: { baseUrl: string; jwt: string }): AkbAdapter;
  getCurrentActor(input: {
    adapter: AkbAdapter;
    jwt: string;
  }): Promise<{ actor: string | null }>;
  listPlanningCatalog(input: {
    adapter: AkbAdapter;
    vault: string;
  }): Promise<PlanningCatalog>;
  createRelease(input: {
    adapter: AkbAdapter;
    vault: string;
    item: Omit<Release, "id">;
    idempotencyKey?: string;
  }): Promise<Release>;
  createSprint(input: {
    adapter: AkbAdapter;
    vault: string;
    item: Omit<Sprint, "id">;
    idempotencyKey?: string;
  }): Promise<Sprint>;
  readPlanningCreateClaim(input: {
    adapter: AkbAdapter;
    vault: string;
    kind: "release" | "sprint";
    idempotencyKey: string;
  }): Promise<Release | Sprint | null>;
  allocateNextIssueId(input: {
    adapter: AkbAdapter;
    vault: string;
    prefix: string;
  }): Promise<string>;
  writeIssue(input: {
    adapter: AkbAdapter;
    vault: string;
    issue: IssueMetadata;
    content?: string;
    claimFirst?: boolean;
  }): Promise<AkbWriteIssueResult>;
  updateIssue(input: {
    adapter: AkbAdapter;
    vault: string;
    id: string;
    partial: Partial<IssueMetadata>;
    content?: string;
    message?: string;
    expectedCommit?: string;
    expectedUpdatedAt?: string;
  }): Promise<AkbUpdateIssueResult>;
  readIssue(input: {
    adapter: AkbAdapter;
    vault: string;
    id: string;
  }): Promise<AkbReadIssueResult>;
  claimIssueId(input: {
    adapter: AkbAdapter;
    vault: string;
    issue: IssueMetadata;
  }): Promise<void>;
}

const defaultCore: TargetCore = {
  createAdapter: createAkbAdapter,
  getCurrentActor: akbGetCurrentActor,
  listPlanningCatalog: akbListPlanningCatalog,
  createRelease: akbCreateRelease,
  createSprint: akbCreateSprint,
  readPlanningCreateClaim: akbReadPlanningCreateClaim,
  allocateNextIssueId: akbAllocateNextIssueId,
  writeIssue: akbWriteIssue,
  updateIssue: akbUpdateIssue,
  readIssue: akbReadIssue,
  claimIssueId: akbClaimIssueId,
};

export interface JiraIssueApplyReadback {
  reefId: string;
  documentUri: string;
  commitHash: string;
}

export class JiraTargetConflictError extends Error {
  readonly code = "target_issue_id_conflict";

  constructor() {
    super("target_issue_id_conflict");
    this.name = "JiraTargetConflictError";
  }
}

export interface JiraIssueTargetOwner {
  jira_cloud_id: string;
  project_key: string;
  issue_id: string;
  issue_key: string;
}

export interface AkbJiraMigrationTarget {
  readonly adapter: AkbAdapter;
  preflight(): Promise<{
    actor: string;
    vault: string;
    planning: PlanningCatalog;
  }>;
  planIssueIds(owners: readonly JiraIssueTargetOwner[]): Promise<string[]>;
  applyPlanning(
    action: JiraPlanningAction,
  ): Promise<JiraPlanningTargetResolution>;
  readPlanningClaim(
    action: JiraPlanningAction,
  ): Promise<JiraPlanningTargetResolution | null>;
  applyIssue(
    plan: JiraIssueImportPlan,
    action: "create" | "update",
    approvedReadback?: AkbReadIssueResult,
  ): Promise<JiraIssueApplyReadback>;
  readIssue(id: string): Promise<AkbReadIssueResult>;
  claimIssue(plan: JiraIssueImportPlan): Promise<void>;
  relatedTarget(): JiraRelatedImportTarget;
  appendActivity(events: readonly ActivityEventInput[]): Promise<void>;
  activityMatches(events: readonly ActivityEventInput[]): Promise<boolean>;
}

export function createAkbJiraMigrationTarget(
  config: AkbJiraMigrationTargetConfig,
  core: TargetCore = defaultCore,
): AkbJiraMigrationTarget {
  const adapter = core.createAdapter({
    baseUrl: config.baseUrl,
    jwt: config.jwt,
  });
  const vault = config.vault;
  const readIssue = (id: string) => core.readIssue({ adapter, vault, id });
  const updateIssue = (
    id: string,
    partial: Partial<IssueMetadata>,
    content?: string,
    expected?: { commit: string | null; updatedAt: string },
  ) =>
    core.updateIssue({
      adapter,
      vault,
      id,
      partial,
      ...(content !== undefined ? { content } : {}),
      ...(expected?.commit ? { expectedCommit: expected.commit } : {}),
      ...(expected ? { expectedUpdatedAt: expected.updatedAt } : {}),
      message: `Reconcile ${id} Jira migration data`,
    });
  const { allIssueRows, related, activityMatches } = createAkbRelatedTarget({
    adapter,
    vault,
    readIssue,
    updateIssue,
  });
  return {
    adapter,
    async preflight() {
      const [{ actor }, planning] = await Promise.all([
        core.getCurrentActor({ adapter, jwt: config.jwt }),
        core.listPlanningCatalog({ adapter, vault }),
      ]);
      if (!actor) throw new Error("target_identity_unavailable");
      return { actor, vault, planning };
    },
    async planIssueIds(owners) {
      if (owners.length === 0) return [];
      const prefix = config.issuePrefix ?? "REEF";
      const rows = await allIssueRows();
      const existing = new Set(
        rows.flatMap((row) =>
          typeof row.reef_id === "string" ? [row.reef_id] : [],
        ),
      );
      const ownedIds = new Map<string, string>();
      for (const row of rows) {
        if (typeof row.reef_id !== "string") continue;
        const meta = parseMeta(row.meta);
        const customFields = parseMeta(meta.custom_fields);
        const migration = parseMeta(customFields.jira_migration);
        const owner = migration.owner;
        const key = jiraOwnerIdentity(owner);
        if (!key) continue;
        if (ownedIds.has(key)) {
          throw new Error("target_issue_owner_claim_ambiguous");
        }
        ownedIds.set(key, row.reef_id);
      }
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const pattern = new RegExp(`^${escapedPrefix}-(\\d+)$`, "u");
      let next = [...existing].reduce((maximum, id) => {
        const match = pattern.exec(id);
        return match?.[1]
          ? Math.max(maximum, Number.parseInt(match[1], 10))
          : maximum;
      }, 0);
      const width = Math.max(
        3,
        ...[...existing].flatMap((id) => {
          const match = pattern.exec(id);
          return match?.[1] ? [match[1].length] : [];
        }),
      );
      const candidates: string[] = [];
      for (const owner of owners) {
        const ownerIdentity = jiraOwnerIdentity(owner);
        if (!ownerIdentity) throw new Error("target_issue_owner_invalid");
        const ownedId = ownedIds.get(ownerIdentity);
        if (ownedId) {
          candidates.push(ownedId);
          continue;
        }
        let candidate: string;
        do {
          next += 1;
          candidate = `${prefix}-${String(next).padStart(width, "0")}`;
        } while (existing.has(candidate));
        candidates.push(candidate);
        existing.add(candidate);
      }
      return candidates;
    },
    async applyPlanning(action) {
      if (action.classification === "conflict") {
        throw new Error("jira_planning_conflict");
      }
      if (action.classification === "unsupported" || !action.target) {
        throw new Error("jira_planning_unsupported");
      }
      if (action.classification === "reuse") {
        if (!action.targetId) throw new Error("jira_planning_target_missing");
        const planning = await core.listPlanningCatalog({ adapter, vault });
        const readback =
          action.target.kind === "release"
            ? planning.releases.find(
                (candidate) => candidate.id === action.targetId,
              )
            : planning.sprints.find(
                (candidate) => candidate.id === action.targetId,
              );
        if (!readback) throw new Error("target_planning_readback_failed");
        const readbackProjection = Object.fromEntries(
          Object.keys(action.target.item).map((key) => [
            key,
            readback[key as keyof typeof readback],
          ]),
        );
        if (
          canonicalizeJson(readbackProjection) !==
          canonicalizeJson(action.target.item)
        ) {
          throw new Error("target_planning_readback_failed");
        }
        return {
          sourceIdentity: action.sourceIdentity,
          targetKind: action.target.kind,
          targetId: action.targetId,
        };
      }
      const item =
        action.target.kind === "release"
          ? await core.createRelease({
              adapter,
              vault,
              item: action.target.item,
              idempotencyKey: action.sourceIdentity.key,
            })
          : await core.createSprint({
              adapter,
              vault,
              item: action.target.item,
              idempotencyKey: action.sourceIdentity.key,
            });
      const planning = await core.listPlanningCatalog({ adapter, vault });
      const readback =
        action.target.kind === "release"
          ? planning.releases.find((candidate) => candidate.id === item.id)
          : planning.sprints.find((candidate) => candidate.id === item.id);
      if (!readback) throw new Error("target_planning_readback_failed");
      const readbackProjection = Object.fromEntries(
        Object.keys(action.target.item).map((key) => [
          key,
          readback[key as keyof typeof readback],
        ]),
      );
      if (
        canonicalizeJson(readbackProjection) !==
        canonicalizeJson(action.target.item)
      ) {
        throw new Error("target_planning_readback_failed");
      }
      return {
        sourceIdentity: action.sourceIdentity,
        targetKind: action.target.kind,
        targetId: item.id,
      };
    },
    async readPlanningClaim(action) {
      if (!action.target) return null;
      const claimed = await core.readPlanningCreateClaim({
        adapter,
        vault,
        kind: action.target.kind,
        idempotencyKey: action.sourceIdentity.key,
      });
      if (!claimed) return null;
      const projection = Object.fromEntries(
        Object.keys(action.target.item).map((key) => [
          key,
          claimed[key as keyof typeof claimed],
        ]),
      );
      if (
        canonicalizeJson(projection) !== canonicalizeJson(action.target.item)
      ) {
        return null;
      }
      return {
        sourceIdentity: action.sourceIdentity,
        targetKind: action.target.kind,
        targetId: claimed.id,
      };
    },
    async applyIssue(plan, action, approvedReadback) {
      const desired = plan.desired.issue;
      if (
        !desired ||
        (plan.status !== "ready" && plan.status !== "ready_with_warnings")
      ) {
        throw new Error("jira_issue_plan_not_writable");
      }
      let commitHash: string;
      let expectedIssue = desired;
      if (action === "create") {
        let current: AkbReadIssueResult | null = null;
        try {
          current = await core.readIssue({
            adapter,
            vault,
            id: desired.id,
          });
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
        if (current) {
          const desiredOwner = parseMeta(
            parseMeta(desired.custom_fields).jira_migration,
          ).owner;
          const currentMigration = parseMeta(
            parseMeta(current.issue.custom_fields).jira_migration,
          );
          const desiredOwnerIdentity = jiraOwnerIdentity(desiredOwner);
          if (
            desiredOwnerIdentity &&
            jiraOwnerIdentity(currentMigration.owner) ===
              desiredOwnerIdentity &&
            currentMigration.reservation === true &&
            current.issue.archived_at != null
          ) {
            const result = await core.writeIssue({
              adapter,
              vault,
              issue: desired,
              content: plan.desired.content,
              claimFirst: true,
            });
            commitHash = result.commit_hash;
          } else {
            const desiredKeys = issueProjectionKeys(desired);
            if (
              canonicalizeJson(issueProjection(current.issue, desiredKeys)) !==
                canonicalizeJson(issueProjection(desired, desiredKeys)) ||
              current.content !== plan.desired.content
            ) {
              throw new JiraTargetConflictError();
            }
            return {
              reefId: desired.id,
              documentUri: akbIssueDocumentUri(vault, desired.id),
              commitHash: current.commit_hash ?? "",
            };
          }
        } else {
          const result = await core.writeIssue({
            adapter,
            vault,
            issue: desired,
            content: plan.desired.content,
            claimFirst: true,
          });
          commitHash = result.commit_hash;
        }
      } else {
        const current =
          approvedReadback ??
          (await core.readIssue({
            adapter,
            vault,
            id: desired.id,
          }));
        const desiredOwner = parseMeta(
          parseMeta(desired.custom_fields).jira_migration,
        ).owner;
        const currentOwner = parseMeta(
          parseMeta(current.issue.custom_fields).jira_migration,
        ).owner;
        const desiredOwnerIdentity = jiraOwnerIdentity(desiredOwner);
        if (
          !desiredOwnerIdentity ||
          jiraOwnerIdentity(currentOwner) !== desiredOwnerIdentity
        ) {
          throw new JiraTargetConflictError();
        }
        expectedIssue = {
          ...desired,
          depends_on: current.issue.depends_on,
          blocks: current.issue.blocks,
          related_to: current.issue.related_to,
          external_refs: current.issue.external_refs,
          custom_fields: customFieldsWithSidecar(
            desired,
            sidecarFor(current.issue),
            current.issue.custom_fields,
          ),
        };
        const expectedKeys = issueProjectionKeys(expectedIssue);
        if (
          canonicalizeJson(issueProjection(current.issue, expectedKeys)) ===
            canonicalizeJson(issueProjection(expectedIssue, expectedKeys)) &&
          current.content === plan.desired.content
        ) {
          return {
            reefId: desired.id,
            documentUri: akbIssueDocumentUri(vault, desired.id),
            commitHash: current.commit_hash ?? "",
          };
        }
        const result = await core.updateIssue({
          adapter,
          vault,
          id: desired.id,
          partial: expectedIssue,
          content: plan.desired.content,
          message: `Update ${desired.id} from Jira migration`,
          ...(current.commit_hash
            ? { expectedCommit: current.commit_hash }
            : {}),
          expectedUpdatedAt: current.issue.updated_at,
        });
        commitHash = result.commit_hash;
      }
      const readback = await core.readIssue({
        adapter,
        vault,
        id: desired.id,
      });
      const desiredKeys = issueProjectionKeys(expectedIssue);
      const desiredProjection = issueProjection(expectedIssue, desiredKeys);
      const projectedReadback = issueProjection(readback.issue, desiredKeys);
      if (
        canonicalizeJson(projectedReadback) !==
          canonicalizeJson(desiredProjection) ||
        readback.content !== plan.desired.content
      ) {
        throw new Error("target_issue_readback_failed");
      }
      return {
        reefId: desired.id,
        documentUri: akbIssueDocumentUri(vault, desired.id),
        commitHash,
      };
    },
    readIssue(id) {
      return core.readIssue({ adapter, vault, id });
    },
    async claimIssue(plan) {
      const desired = plan.desired.issue;
      if (
        !desired ||
        (plan.status !== "ready" && plan.status !== "ready_with_warnings")
      ) {
        throw new Error("jira_issue_plan_not_claimable");
      }
      try {
        await core.claimIssueId({ adapter, vault, issue: desired });
      } catch (error) {
        if (error instanceof ConflictError) throw new JiraTargetConflictError();
        throw error;
      }
    },
    relatedTarget() {
      return related;
    },
    async appendActivity(events) {
      for (const event of events) {
        if (!event.eventKey) {
          throw new Error("target_activity_event_key_required");
        }
      }
      await akbAppendActivityEvents(adapter, vault, [...events]);
      if (!(await activityMatches(events))) {
        throw new Error("target_activity_readback_failed");
      }
    },
    activityMatches,
  };
}
