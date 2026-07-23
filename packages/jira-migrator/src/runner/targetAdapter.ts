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
  type PlanningCatalog,
  type Release,
  type Sprint,
  akbAllocateNextIssueId,
  akbAppendActivityEvents,
  akbCreateComment,
  akbCreateRelease,
  akbCreateSprint,
  akbDownloadIssueAttachmentByFileUri,
  akbGetCurrentActor,
  akbIssueDocumentUri,
  akbListComments,
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
  }): Promise<AkbWriteIssueResult>;
  updateIssue(input: {
    adapter: AkbAdapter;
    vault: string;
    id: string;
    partial: Partial<IssueMetadata>;
    content?: string;
    message?: string;
    expectedCommit?: string;
  }): Promise<AkbUpdateIssueResult>;
  readIssue(input: {
    adapter: AkbAdapter;
    vault: string;
    id: string;
  }): Promise<AkbReadIssueResult>;
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
};

const incrementIssueId = (first: string, offset: number): string => {
  const match = /^(.*?)-(\d+)$/u.exec(first);
  if (!match?.[1] || !match[2]) throw new Error("target_issue_id_invalid");
  const number = Number(match[2]) + offset;
  return `${match[1]}-${String(number).padStart(match[2].length, "0")}`;
};

export interface JiraIssueApplyReadback {
  reefId: string;
  documentUri: string;
  commitHash: string;
}

export interface AkbJiraMigrationTarget {
  readonly adapter: AkbAdapter;
  preflight(): Promise<{
    actor: string;
    vault: string;
    planning: PlanningCatalog;
  }>;
  reserveIssueIds(count: number): Promise<string[]>;
  applyPlanning(
    action: JiraPlanningAction,
  ): Promise<JiraPlanningTargetResolution>;
  applyIssue(
    plan: JiraIssueImportPlan,
    action: "create" | "update",
  ): Promise<JiraIssueApplyReadback>;
  readIssue(id: string): Promise<AkbReadIssueResult>;
  relatedTarget(): JiraRelatedImportTarget;
  appendActivity(events: readonly ActivityEventInput[]): Promise<void>;
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
): Record<string, unknown> => ({
  ...parseMeta(issue.custom_fields),
  jira_migration: {
    relations: sidecar.relations,
    external_refs: sidecar.externalRefs,
  },
});

const addUnique = (values: readonly string[] | undefined, value: string) =>
  [...new Set([...(values ?? []), value])].sort();

const removeValue = (values: readonly string[] | undefined, value: string) =>
  (values ?? []).filter((candidate) => candidate !== value).sort();

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
  ) =>
    core.updateIssue({
      adapter,
      vault,
      id,
      partial,
      ...(content !== undefined ? { content } : {}),
      message: `Reconcile ${id} Jira migration data`,
    });
  const allIssueIds = async (): Promise<string[]> =>
    (await sql(adapter, vault, "SELECT reef_id FROM reef_issues")).flatMap(
      (row) => (typeof row.reef_id === "string" ? [row.reef_id] : []),
    );
  const findRelation = async (idempotencyKey: string) => {
    for (const id of await allIssueIds()) {
      const issue = (await readIssue(id)).issue;
      const record = sidecarFor(issue).relations.find(
        (candidate) => candidate.idempotencyKey === idempotencyKey,
      );
      if (record) return { issue, record };
    }
    return null;
  };
  const findExternalRef = async (idempotencyKey: string) => {
    for (const id of await allIssueIds()) {
      const issue = (await readIssue(id)).issue;
      const record = sidecarFor(issue).externalRefs.find(
        (candidate) => candidate.idempotencyKey === idempotencyKey,
      );
      if (record) return { issue, record };
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
        { createdAt: input.createdAt, editedAt: input.editedAt },
      );
      await sql(
        adapter,
        vault,
        `UPDATE reef_comments SET meta = jsonb_set(meta::jsonb, '{jira_idempotency_key}', to_jsonb(${quote(
          input.idempotencyKey,
        )}::text))::json WHERE id = ${quote(comment.id)}`,
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
      await updateIssue(reefId, {}, markdown);
    },
    async putRelation(input) {
      const source = (await readIssue(input.sourceReefId)).issue;
      const targetIssue = (await readIssue(input.targetReefId)).issue;
      const sourceBefore = source[input.relation] ?? [];
      const targetBefore = targetIssue[input.inverseRelation] ?? [];
      await updateIssue(input.sourceReefId, {
        [input.relation]: addUnique(sourceBefore, input.targetReefId),
      });
      try {
        await updateIssue(input.targetReefId, {
          [input.inverseRelation]: addUnique(targetBefore, input.sourceReefId),
        });
        const sidecar = sidecarFor(source);
        sidecar.relations = sidecar.relations
          .filter((record) => record.idempotencyKey !== input.idempotencyKey)
          .concat({ ...input });
        await updateIssue(input.sourceReefId, {
          custom_fields: customFieldsWithSidecar(source, sidecar),
        });
      } catch (error) {
        await updateIssue(input.sourceReefId, {
          [input.relation]: sourceBefore,
        }).catch(() => undefined);
        await updateIssue(input.targetReefId, {
          [input.inverseRelation]: targetBefore,
        }).catch(() => undefined);
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
      const { issue, record } = found;
      const targetIssue = (await readIssue(record.targetReefId)).issue;
      const sidecar = sidecarFor(issue);
      sidecar.relations = sidecar.relations.filter(
        (candidate) => candidate.idempotencyKey !== idempotencyKey,
      );
      await updateIssue(record.sourceReefId, {
        [record.relation]: removeValue(
          issue[record.relation],
          record.targetReefId,
        ),
        custom_fields: customFieldsWithSidecar(issue, sidecar),
      });
      await updateIssue(record.targetReefId, {
        [record.inverseRelation]: removeValue(
          targetIssue[record.inverseRelation],
          record.sourceReefId,
        ),
      });
    },
    async putExternalRef(input) {
      const issue = (await readIssue(input.reefId)).issue;
      const sidecar = sidecarFor(issue);
      sidecar.externalRefs = sidecar.externalRefs
        .filter((record) => record.idempotencyKey !== input.idempotencyKey)
        .concat({ ...input });
      const refs = [
        ...(issue.external_refs ?? []).filter(
          (candidate) =>
            JSON.stringify(candidate) !== JSON.stringify(input.ref),
        ),
        input.ref,
      ];
      await updateIssue(input.reefId, {
        external_refs: refs,
        custom_fields: customFieldsWithSidecar(issue, sidecar),
      });
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
      const { issue, record } = found;
      const sidecar = sidecarFor(issue);
      sidecar.externalRefs = sidecar.externalRefs.filter(
        (candidate) => candidate.idempotencyKey !== idempotencyKey,
      );
      await updateIssue(record.reefId, {
        external_refs: (issue.external_refs ?? []).filter(
          (candidate) =>
            JSON.stringify(candidate) !== JSON.stringify(record.ref),
        ),
        custom_fields: customFieldsWithSidecar(issue, sidecar),
      });
    },
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
    async reserveIssueIds(count) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("target_issue_reservation_count_invalid");
      }
      if (count === 0) return [];
      const first = await core.allocateNextIssueId({
        adapter,
        vault,
        prefix: config.issuePrefix ?? "REEF",
      });
      return Array.from({ length: count }, (_, index) =>
        incrementIssueId(first, index),
      );
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
      if (action === "create") {
        const result = await core.writeIssue({
          adapter,
          vault,
          issue: desired,
          content: plan.desired.content,
        });
        commitHash = result.commit_hash;
      } else {
        const current = await core.readIssue({
          adapter,
          vault,
          id: desired.id,
        });
        const result = await core.updateIssue({
          adapter,
          vault,
          id: desired.id,
          partial: desired,
          content: plan.desired.content,
          message: `Update ${desired.id} from Jira migration`,
          ...(current.commit_hash
            ? { expectedCommit: current.commit_hash }
            : {}),
        });
        commitHash = result.commit_hash;
      }
      const readback = await core.readIssue({
        adapter,
        vault,
        id: desired.id,
      });
      if (
        readback.issue.id !== desired.id ||
        readback.issue.title !== desired.title
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
    relatedTarget() {
      return related;
    },
    async appendActivity(events) {
      await akbAppendActivityEvents(adapter, vault, [...events]);
    },
  };
}
