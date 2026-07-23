import {
  type ActivityEventInput,
  type AkbAdapter,
  type AkbReadIssueResult,
  type AkbUpdateIssueResult,
  type AkbWriteIssueResult,
  type Comment,
  type ExternalRef,
  type IssueAttachment,
  type IssueMetadata,
  NotFoundError,
  type PlanningCatalog,
  type Release,
  type Sprint,
  akbAllocateNextIssueId,
  akbAppendActivityEvents,
  akbClaimIssueId,
  akbCreateComment,
  akbCreateRelease,
  akbCreateSprint,
  akbDownloadIssueAttachmentByFileUri,
  akbGetCurrentActor,
  akbIssueDocumentUri,
  akbListComments,
  akbListIssueActivity,
  akbListIssueAttachments,
  akbListPlanningCatalog,
  akbReadIssue,
  akbUpdateComment,
  akbUpdateIssue,
  akbUploadIssueAttachment,
  akbWriteIssue,
  createAkbAdapter,
} from "@reef/core";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import type {
  JiraPlanningAction,
  JiraPlanningTargetResolution,
} from "../planning/entities.js";
import { canonicalizeJson } from "../rawArchive.js";
import type {
  JiraImportedAttachmentInput,
  JiraImportedCommentInput,
  JiraRelatedImportTarget,
  JiraRelationKind,
} from "../related/contracts.js";

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
  }): Promise<Release>;
  createSprint(input: {
    adapter: AkbAdapter;
    vault: string;
    item: Omit<Sprint, "id">;
  }): Promise<Sprint>;
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
  applyIssue(
    plan: JiraIssueImportPlan,
    action: "create" | "update",
  ): Promise<JiraIssueApplyReadback>;
  readIssue(id: string): Promise<AkbReadIssueResult>;
  claimIssue(plan: JiraIssueImportPlan): Promise<void>;
  relatedTarget(): JiraRelatedImportTarget;
  appendActivity(events: readonly ActivityEventInput[]): Promise<void>;
  activityMatches(events: readonly ActivityEventInput[]): Promise<boolean>;
}

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const sql = async (
  adapter: AkbAdapter,
  vault: string,
  statement: string,
): Promise<Record<string, unknown>[]> => {
  const response = (await adapter.request(
    `/api/v1/tables/${encodeURIComponent(vault)}/sql`,
    {
      method: "POST",
      body: { sql: statement },
      resource: `Jira migration data in ${vault}`,
    },
  )) as {
    kind?: string;
    items?: Record<string, unknown>[];
  };
  return response.kind === "table_query" ? (response.items ?? []) : [];
};

const parseMeta = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

interface MigrationSidecar {
  relations: Array<{
    idempotencyKey: string;
    sourceReefId: string;
    targetReefId: string;
    relation: JiraRelationKind;
    inverseRelation: JiraRelationKind;
    provenance: Record<string, unknown>;
  }>;
  externalRefs: Array<{
    idempotencyKey: string;
    reefId: string;
    ref: ExternalRef;
    provenance: Record<string, unknown>;
  }>;
}

const sidecarFor = (issue: IssueMetadata): MigrationSidecar => {
  const custom = parseMeta(issue.custom_fields);
  const migration = parseMeta(custom.jira_migration);
  return {
    relations: Array.isArray(migration.relations)
      ? (migration.relations as MigrationSidecar["relations"])
      : [],
    externalRefs: Array.isArray(migration.external_refs)
      ? (migration.external_refs as MigrationSidecar["externalRefs"])
      : [],
  };
};

const customFieldsWithSidecar = (
  issue: IssueMetadata,
  sidecar: MigrationSidecar,
): Record<string, unknown> => {
  const customFields = parseMeta(issue.custom_fields);
  return {
    ...customFields,
    jira_migration: {
      ...parseMeta(customFields.jira_migration),
      relations: sidecar.relations,
      external_refs: sidecar.externalRefs,
    },
  };
};

const addUnique = (values: readonly string[] | undefined, value: string) =>
  [...new Set([...(values ?? []), value])].sort();

const removeValue = (values: readonly string[] | undefined, value: string) =>
  (values ?? []).filter((candidate) => candidate !== value).sort();

const relationshipKeys = new Set<keyof IssueMetadata>([
  "depends_on",
  "blocks",
  "related_to",
]);

const issueProjectionKeys = (
  issue: IssueMetadata,
): Array<keyof IssueMetadata> =>
  (Object.keys(issue) as Array<keyof IssueMetadata>).filter(
    (key) => issue[key] !== undefined,
  );

const issueProjection = (
  issue: IssueMetadata,
  keys: readonly (keyof IssueMetadata)[],
) =>
  Object.fromEntries(
    keys.map((key) => [
      key,
      relationshipKeys.has(key) && issue[key] === undefined ? [] : issue[key],
    ]),
  );

const jiraOwnerIdentity = (owner: unknown): string | null => {
  const parsed = parseMeta(owner);
  return typeof parsed.jira_cloud_id === "string" &&
    typeof parsed.issue_id === "string"
    ? canonicalizeJson({
        jira_cloud_id: parsed.jira_cloud_id,
        issue_id: parsed.issue_id,
      })
    : null;
};

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
  const allIssueRows = () =>
    sql(adapter, vault, "SELECT reef_id, meta FROM reef_issues");
  const allIssueIds = async (): Promise<string[]> =>
    (await allIssueRows()).flatMap((row) =>
      typeof row.reef_id === "string" ? [row.reef_id] : [],
    );
  const findRelation = async (idempotencyKey: string) => {
    for (const id of await allIssueIds()) {
      const readback = await readIssue(id);
      const issue = readback.issue;
      const record = sidecarFor(issue).relations.find(
        (candidate) => candidate.idempotencyKey === idempotencyKey,
      );
      if (record) return { issue, readback, record };
    }
    return null;
  };
  const findExternalRef = async (idempotencyKey: string) => {
    for (const id of await allIssueIds()) {
      const readback = await readIssue(id);
      const issue = readback.issue;
      const record = sidecarFor(issue).externalRefs.find(
        (candidate) => candidate.idempotencyKey === idempotencyKey,
      );
      if (record) return { issue, readback, record };
    }
    return null;
  };
  const related: JiraRelatedImportTarget = {
    async createComment(input: JiraImportedCommentInput): Promise<Comment> {
      const comment = await akbCreateComment(
        adapter,
        vault,
        input.reefId,
        input.body,
        input.author,
        input.parentCommentId,
        {
          createdAt: input.createdAt,
          editedAt: input.editedAt,
          metadata: { jira_idempotency_key: input.idempotencyKey },
        },
      );
      return comment;
    },
    updateComment(commentId, input) {
      return akbUpdateComment(
        adapter,
        vault,
        input.reefId,
        commentId,
        input.body,
        input.author,
        {
          createdAt: input.createdAt,
          editedAt: input.editedAt,
          metadata: { jira_idempotency_key: input.idempotencyKey },
        },
      );
    },
    async readComment(commentId) {
      const rows = await sql(
        adapter,
        vault,
        `SELECT reef_id FROM reef_comments WHERE id = ${quote(commentId)} LIMIT 1`,
      );
      const reefId = rows[0]?.reef_id;
      if (typeof reefId !== "string") return null;
      return (
        (await akbListComments(adapter, vault, reefId)).find(
          (comment) => comment.id === commentId,
        ) ?? null
      );
    },
    async findCommentByIdempotencyKey(idempotencyKey) {
      const rows = await sql(
        adapter,
        vault,
        `SELECT id, reef_id FROM reef_comments WHERE meta->>'jira_idempotency_key' = ${quote(
          idempotencyKey,
        )} LIMIT 1`,
      );
      const id = rows[0]?.id;
      const reefId = rows[0]?.reef_id;
      if (typeof id !== "string" || typeof reefId !== "string") return null;
      return (
        (await akbListComments(adapter, vault, reefId)).find(
          (comment) => comment.id === id,
        ) ?? null
      );
    },
    async deleteComment(commentId) {
      await sql(
        adapter,
        vault,
        `DELETE FROM reef_comments WHERE id = ${quote(commentId)}`,
      );
    },
    async createAttachment(
      input: JiraImportedAttachmentInput,
    ): Promise<IssueAttachment> {
      return akbUploadIssueAttachment({
        adapter,
        vault,
        reefId: input.reefId,
        filename: input.filename,
        mimeType: input.mimeType,
        bytes: input.bytes,
        author: input.author,
        source: "jira_import",
        createdAt: input.createdAt,
        originalJiraAttachmentId: input.originalJiraAttachmentId,
        meta: {
          ...input.meta,
          jira_idempotency_key: input.idempotencyKey,
        },
      });
    },
    async readAttachment(fileUri) {
      const rows = await sql(
        adapter,
        vault,
        `SELECT reef_id FROM reef_attachments WHERE file_uri = ${quote(
          fileUri,
        )} LIMIT 1`,
      );
      const reefId = rows[0]?.reef_id;
      if (typeof reefId !== "string") return null;
      try {
        const result = await akbDownloadIssueAttachmentByFileUri({
          adapter,
          vault,
          reefId,
          fileUri,
        });
        return {
          attachment: result.attachment,
          bytes: new Uint8Array(result.body),
        };
      } catch {
        return null;
      }
    },
    async findAttachmentByJiraId(reefId, jiraCloudId, jiraAttachmentId) {
      const attachment = (
        await akbListIssueAttachments(adapter, vault, reefId)
      ).find(
        (candidate) =>
          candidate.original_jira_attachment_id === jiraAttachmentId &&
          parseMeta(candidate.meta).jira_cloud_id === jiraCloudId,
      );
      if (!attachment) return null;
      const result = await akbDownloadIssueAttachmentByFileUri({
        adapter,
        vault,
        reefId,
        fileUri: attachment.file_uri,
      });
      return {
        attachment: result.attachment,
        bytes: new Uint8Array(result.body),
      };
    },
    async revokeAttachment({ reefId, fileUri, replacement }) {
      const current = await readIssue(reefId);
      if (current.content.includes(fileUri)) {
        await updateIssue(
          reefId,
          {},
          current.content.replaceAll(fileUri, replacement),
          {
            commit: current.commit_hash,
            updatedAt: current.issue.updated_at,
          },
        );
      }
      const fileId = /\/file\/([^/]+)$/u.exec(fileUri)?.[1];
      if (fileId) {
        await adapter.request(
          `/api/v1/files/${encodeURIComponent(vault)}/${encodeURIComponent(fileId)}`,
          { method: "DELETE", resource: `Jira attachment ${fileId}` },
        );
      }
      await sql(
        adapter,
        vault,
        `DELETE FROM reef_attachments WHERE reef_id = ${quote(
          reefId,
        )} AND file_uri = ${quote(fileUri)}`,
      );
    },
    async hasMediaReference(reefId, fileUri) {
      return (await readIssue(reefId)).content.includes(fileUri);
    },
    async readDescription(reefId) {
      return (await readIssue(reefId)).content;
    },
    async updateDescription(reefId, markdown) {
      const current = await readIssue(reefId);
      await updateIssue(reefId, {}, markdown, {
        commit: current.commit_hash,
        updatedAt: current.issue.updated_at,
      });
    },
    async putRelation(input) {
      const sourceReadback = await readIssue(input.sourceReefId);
      const targetReadback = await readIssue(input.targetReefId);
      const source = sourceReadback.issue;
      const targetIssue = targetReadback.issue;
      const sourceBefore = source[input.relation] ?? [];
      const targetBefore = targetIssue[input.inverseRelation] ?? [];
      await updateIssue(
        input.sourceReefId,
        {
          [input.relation]: addUnique(sourceBefore, input.targetReefId),
        },
        undefined,
        {
          commit: sourceReadback.commit_hash,
          updatedAt: source.updated_at,
        },
      );
      let targetRelationAdded = false;
      try {
        await updateIssue(
          input.targetReefId,
          {
            [input.inverseRelation]: addUnique(
              targetBefore,
              input.sourceReefId,
            ),
          },
          undefined,
          {
            commit: targetReadback.commit_hash,
            updatedAt: targetIssue.updated_at,
          },
        );
        targetRelationAdded = !targetBefore.includes(input.sourceReefId);
        const refreshedSource = await readIssue(input.sourceReefId);
        const sidecar = sidecarFor(refreshedSource.issue);
        sidecar.relations = sidecar.relations
          .filter((record) => record.idempotencyKey !== input.idempotencyKey)
          .concat({ ...input });
        await updateIssue(
          input.sourceReefId,
          {
            custom_fields: customFieldsWithSidecar(
              refreshedSource.issue,
              sidecar,
            ),
          },
          undefined,
          {
            commit: refreshedSource.commit_hash,
            updatedAt: refreshedSource.issue.updated_at,
          },
        );
      } catch (error) {
        const rollback = async (
          reefId: string,
          relation: JiraRelationKind,
          counterpartId: string,
        ) => {
          const current = await readIssue(reefId);
          await updateIssue(
            reefId,
            {
              [relation]: removeValue(current.issue[relation], counterpartId),
            },
            undefined,
            {
              commit: current.commit_hash,
              updatedAt: current.issue.updated_at,
            },
          );
        };
        if (!sourceBefore.includes(input.targetReefId)) {
          await rollback(
            input.sourceReefId,
            input.relation,
            input.targetReefId,
          ).catch(() => undefined);
        }
        if (targetRelationAdded) {
          await rollback(
            input.targetReefId,
            input.inverseRelation,
            input.sourceReefId,
          ).catch(() => undefined);
        }
        throw error;
      }
    },
    async hasRelation(idempotencyKey) {
      return (await findRelation(idempotencyKey)) !== null;
    },
    async readRelation(idempotencyKey) {
      const found = await findRelation(idempotencyKey);
      if (!found) return null;
      const { record } = found;
      return {
        sourceReefId: record.sourceReefId,
        targetReefId: record.targetReefId,
        relation: record.relation,
        inverseRelation: record.inverseRelation,
      };
    },
    async deleteRelation(idempotencyKey) {
      const found = await findRelation(idempotencyKey);
      if (!found) return;
      const { issue, readback, record } = found;
      const targetReadback = await readIssue(record.targetReefId);
      const targetIssue = targetReadback.issue;
      const sidecar = sidecarFor(issue);
      sidecar.relations = sidecar.relations.filter(
        (candidate) => candidate.idempotencyKey !== idempotencyKey,
      );
      const relationStillReferenced = sidecar.relations.some(
        (candidate) =>
          candidate.sourceReefId === record.sourceReefId &&
          candidate.targetReefId === record.targetReefId &&
          candidate.relation === record.relation &&
          candidate.inverseRelation === record.inverseRelation,
      );
      const targetHadInverse =
        !relationStillReferenced &&
        (targetIssue[record.inverseRelation] ?? []).includes(
          record.sourceReefId,
        );
      if (targetHadInverse) {
        await updateIssue(
          record.targetReefId,
          {
            [record.inverseRelation]: removeValue(
              targetIssue[record.inverseRelation],
              record.sourceReefId,
            ),
          },
          undefined,
          {
            commit: targetReadback.commit_hash,
            updatedAt: targetIssue.updated_at,
          },
        );
      }
      try {
        await updateIssue(
          record.sourceReefId,
          {
            [record.relation]: relationStillReferenced
              ? issue[record.relation]
              : removeValue(issue[record.relation], record.targetReefId),
            custom_fields: customFieldsWithSidecar(issue, sidecar),
          },
          undefined,
          {
            commit: readback.commit_hash,
            updatedAt: issue.updated_at,
          },
        );
      } catch (error) {
        const currentSource = await readIssue(record.sourceReefId);
        const sourceStillOwnsRecord = sidecarFor(
          currentSource.issue,
        ).relations.some(
          (candidate) => candidate.idempotencyKey === idempotencyKey,
        );
        if (targetHadInverse && sourceStillOwnsRecord) {
          const currentTarget = await readIssue(record.targetReefId);
          await updateIssue(
            record.targetReefId,
            {
              [record.inverseRelation]: addUnique(
                currentTarget.issue[record.inverseRelation],
                record.sourceReefId,
              ),
            },
            undefined,
            {
              commit: currentTarget.commit_hash,
              updatedAt: currentTarget.issue.updated_at,
            },
          ).catch(() => undefined);
        }
        if (sourceStillOwnsRecord) throw error;
      }
    },
    async putExternalRef(input) {
      const readback = await readIssue(input.reefId);
      const issue = readback.issue;
      const sidecar = sidecarFor(issue);
      const previous = sidecar.externalRefs.find(
        (record) => record.idempotencyKey === input.idempotencyKey,
      );
      sidecar.externalRefs = sidecar.externalRefs
        .filter((record) => record.idempotencyKey !== input.idempotencyKey)
        .concat({ ...input });
      const previousStillReferenced =
        previous !== undefined &&
        sidecar.externalRefs.some(
          (record) =>
            JSON.stringify(record.ref) === JSON.stringify(previous.ref),
        );
      const refs = [
        ...(issue.external_refs ?? []).filter(
          (candidate) =>
            JSON.stringify(candidate) !== JSON.stringify(input.ref) &&
            (previousStillReferenced ||
              JSON.stringify(candidate) !== JSON.stringify(previous?.ref)),
        ),
        input.ref,
      ];
      await updateIssue(
        input.reefId,
        {
          external_refs: refs,
          custom_fields: customFieldsWithSidecar(issue, sidecar),
        },
        undefined,
        {
          commit: readback.commit_hash,
          updatedAt: issue.updated_at,
        },
      );
    },
    async hasExternalRef(idempotencyKey) {
      return (await findExternalRef(idempotencyKey)) !== null;
    },
    async readExternalRef(idempotencyKey) {
      const found = await findExternalRef(idempotencyKey);
      if (!found) return null;
      return {
        reefId: found.record.reefId,
        ref: found.record.ref,
        provenance: found.record.provenance,
      };
    },
    async listExternalRefKeys(prefix) {
      const keys: string[] = [];
      for (const id of await allIssueIds()) {
        const issue = (await readIssue(id)).issue;
        keys.push(
          ...sidecarFor(issue)
            .externalRefs.map((record) => record.idempotencyKey)
            .filter((key) => key.startsWith(prefix)),
        );
      }
      return [...new Set(keys)].sort();
    },
    async deleteExternalRef(idempotencyKey) {
      const found = await findExternalRef(idempotencyKey);
      if (!found) return;
      const { issue, readback, record } = found;
      const sidecar = sidecarFor(issue);
      sidecar.externalRefs = sidecar.externalRefs.filter(
        (candidate) => candidate.idempotencyKey !== idempotencyKey,
      );
      const refStillReferenced = sidecar.externalRefs.some(
        (candidate) =>
          JSON.stringify(candidate.ref) === JSON.stringify(record.ref),
      );
      await updateIssue(
        record.reefId,
        {
          external_refs: refStillReferenced
            ? issue.external_refs
            : (issue.external_refs ?? []).filter(
                (candidate) =>
                  JSON.stringify(candidate) !== JSON.stringify(record.ref),
              ),
          custom_fields: customFieldsWithSidecar(issue, sidecar),
        },
        undefined,
        {
          commit: readback.commit_hash,
          updatedAt: issue.updated_at,
        },
      );
    },
  };
  const activityMatches = async (
    events: readonly ActivityEventInput[],
  ): Promise<boolean> => {
    const byIssue = new Map<string, ActivityEventInput[]>();
    for (const event of events) {
      if (!event.eventKey) return false;
      const issueEvents = byIssue.get(event.reefId) ?? [];
      issueEvents.push(event);
      byIssue.set(event.reefId, issueEvents);
    }
    for (const [reefId, expectedEvents] of byIssue) {
      const actualEvents = await akbListIssueActivity(adapter, vault, reefId);
      for (const expected of expectedEvents) {
        const actual = actualEvents.find(
          (event) => event.event_key === expected.eventKey,
        );
        const expectedProjection = {
          reef_id: expected.reefId,
          event_type: expected.eventType,
          event_key: expected.eventKey,
          actor: expected.actor,
          at: expected.at,
          source: expected.source,
          payload: expected.payload,
        };
        const actualProjection = actual
          ? {
              reef_id: actual.reef_id,
              event_type: actual.event_type,
              event_key: actual.event_key,
              actor: actual.actor,
              at: actual.at,
              source: actual.source,
              payload: actual.payload,
            }
          : null;
        if (
          canonicalizeJson(actualProjection) !==
          canonicalizeJson(expectedProjection)
        ) {
          return false;
        }
      }
    }
    return true;
  };
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
        return {
          sourceIdentity: action.sourceIdentity,
          targetKind:
            action.sourceIdentity.kind === "version" ? "release" : "sprint",
          targetId: action.targetId,
        };
      }
      const item =
        action.target.kind === "release"
          ? await core.createRelease({
              adapter,
              vault,
              item: action.target.item,
            })
          : await core.createSprint({
              adapter,
              vault,
              item: action.target.item,
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
    async applyIssue(plan, action) {
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
          const desiredKeys = issueProjectionKeys(desired);
          if (
            canonicalizeJson(issueProjection(current.issue, desiredKeys)) !==
              canonicalizeJson(issueProjection(desired, desiredKeys)) ||
            current.content !== plan.desired.content
          ) {
            throw new Error("target_issue_id_conflict");
          }
          return {
            reefId: desired.id,
            documentUri: akbIssueDocumentUri(vault, desired.id),
            commitHash: current.commit_hash ?? "",
          };
        }
        const result = await core.writeIssue({
          adapter,
          vault,
          issue: desired,
          content: plan.desired.content,
          claimFirst: true,
        });
        commitHash = result.commit_hash;
      } else {
        const current = await core.readIssue({
          adapter,
          vault,
          id: desired.id,
        });
        expectedIssue = {
          ...desired,
          depends_on: current.issue.depends_on,
          blocks: current.issue.blocks,
          related_to: current.issue.related_to,
          external_refs: current.issue.external_refs,
          custom_fields: customFieldsWithSidecar(
            desired,
            sidecarFor(current.issue),
          ),
        };
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
      await core.claimIssueId({ adapter, vault, issue: desired });
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
