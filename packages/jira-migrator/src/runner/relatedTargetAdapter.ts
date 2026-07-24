import {
  type ActivityEventInput,
  type AkbAdapter,
  type AkbReadIssueResult,
  type AkbUpdateIssueResult,
  type Comment,
  type IssueAttachment,
  type IssueMetadata,
  NotFoundError,
  akbCreateComment,
  akbDownloadIssueAttachmentByFileUri,
  akbListComments,
  akbListIssueActivity,
  akbListIssueAttachments,
  akbUpdateComment,
  akbUploadIssueAttachment,
} from "@reef/core";
import { canonicalizeJson } from "../rawArchive.js";
import type {
  JiraImportedAttachmentInput,
  JiraImportedCommentInput,
  JiraRelatedImportTarget,
} from "../related/contracts.js";
import {
  type MigrationSidecar,
  addUnique,
  customFieldsWithSidecar,
  parseMeta,
  quote,
  removeValue,
  sidecarFor,
  sql,
} from "./targetSupport.js";

interface RelatedTargetDependencies {
  adapter: AkbAdapter;
  vault: string;
  readIssue(id: string): Promise<AkbReadIssueResult>;
  updateIssue(
    id: string,
    partial: Partial<IssueMetadata>,
    content?: string,
    expected?: { commit: string | null; updatedAt: string },
  ): Promise<AkbUpdateIssueResult>;
}

export function createAkbRelatedTarget(input: RelatedTargetDependencies) {
  const { adapter, vault, readIssue, updateIssue } = input;
  const allIssueRows = () =>
    sql(adapter, vault, "SELECT reef_id, meta FROM reef_issues");
  const readDocumentedIssue = async (
    id: string,
  ): Promise<AkbReadIssueResult | null> => {
    try {
      return await readIssue(id);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  };
  const sidecarIssueId = async (
    field: "relations" | "external_refs",
    idempotencyKey: string,
  ): Promise<string | null> => {
    const rows = await sql(
      adapter,
      vault,
      `SELECT reef_id FROM reef_issues WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(meta::jsonb->'custom_fields'->'jira_migration'->'${field}', '[]'::jsonb)) AS record WHERE record->>'idempotencyKey' = ${quote(
        idempotencyKey,
      )}) LIMIT 2`,
    );
    const ids = rows.flatMap((row) =>
      typeof row.reef_id === "string" ? [row.reef_id] : [],
    );
    if (ids.length > 1) {
      throw new Error(`target_${field}_idempotency_key_ambiguous`);
    }
    return ids[0] ?? null;
  };
  const findRelation = async (idempotencyKey: string) => {
    const id = await sidecarIssueId("relations", idempotencyKey);
    if (!id) return null;
    const readback = await readDocumentedIssue(id);
    if (!readback) return null;
    const issue = readback.issue;
    const record = sidecarFor(issue).relations.find(
      (candidate) => candidate.idempotencyKey === idempotencyKey,
    );
    return record ? { issue, readback, record } : null;
  };
  const findExternalRef = async (idempotencyKey: string) => {
    const id = await sidecarIssueId("external_refs", idempotencyKey);
    if (!id) return null;
    const readback = await readDocumentedIssue(id);
    if (!readback) return null;
    const issue = readback.issue;
    const record = sidecarFor(issue).externalRefs.find(
      (candidate) => candidate.idempotencyKey === idempotencyKey,
    );
    return record ? { issue, readback, record } : null;
  };
  const readVerifiedRelation = async (idempotencyKey: string) => {
    const found = await findRelation(idempotencyKey);
    if (!found) return null;
    const { issue, record } = found;
    if (
      issue.id !== record.sourceReefId ||
      !(issue[record.relation] ?? []).includes(record.targetReefId)
    ) {
      return null;
    }
    const target = await readDocumentedIssue(record.targetReefId);
    if (
      !target ||
      !(target.issue[record.inverseRelation] ?? []).includes(
        record.sourceReefId,
      )
    ) {
      return null;
    }
    return record;
  };
  const readVerifiedExternalRef = async (idempotencyKey: string) => {
    const found = await findExternalRef(idempotencyKey);
    if (!found) return null;
    const { issue, record } = found;
    if (
      issue.id !== record.reefId ||
      !(issue.external_refs ?? []).some(
        (candidate) =>
          canonicalizeJson(candidate) === canonicalizeJson(record.ref),
      )
    ) {
      return null;
    }
    return record;
  };
  const deleteOwnedRelation = async (idempotencyKey: string): Promise<void> => {
    const found = await findRelation(idempotencyKey);
    if (!found) return;
    const { issue, readback, record } = found;
    const targetReadback = await readIssue(record.targetReefId);
    const targetIssue = targetReadback.issue;
    const sidecar = sidecarFor(issue);
    sidecar.relations = sidecar.relations.filter(
      (candidate) => candidate.idempotencyKey !== idempotencyKey,
    );
    const ownsSamePhysicalEdge = (
      candidate: MigrationSidecar["relations"][number],
    ): boolean =>
      (candidate.sourceReefId === record.sourceReefId &&
        candidate.targetReefId === record.targetReefId &&
        candidate.relation === record.relation &&
        candidate.inverseRelation === record.inverseRelation) ||
      (candidate.sourceReefId === record.targetReefId &&
        candidate.targetReefId === record.sourceReefId &&
        candidate.relation === record.inverseRelation &&
        candidate.inverseRelation === record.relation);
    const relationStillReferenced =
      sidecar.relations.some(ownsSamePhysicalEdge) ||
      sidecarFor(targetIssue).relations.some(ownsSamePhysicalEdge);
    const targetHadInverse =
      !relationStillReferenced &&
      record.targetCreatedByMigration === true &&
      (targetIssue[record.inverseRelation] ?? []).includes(record.sourceReefId);
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
            : record.sourceCreatedByMigration === true
              ? removeValue(issue[record.relation], record.targetReefId)
              : issue[record.relation],
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
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
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
      const owners = await sql(
        adapter,
        vault,
        `SELECT reef_id FROM reef_attachments WHERE file_uri = ${quote(
          fileUri,
        )} ORDER BY reef_id`,
      );
      if (owners.length !== 1 || owners[0]?.reef_id !== reefId) {
        throw new Error("attachment_ownership_mismatch");
      }
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
        try {
          await adapter.request(
            `/api/v1/files/${encodeURIComponent(vault)}/${encodeURIComponent(fileId)}`,
            { method: "DELETE", resource: `Jira attachment ${fileId}` },
          );
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      }
      await sql(
        adapter,
        vault,
        `DELETE FROM reef_attachments WHERE reef_id = ${quote(
          reefId,
        )} AND file_uri = ${quote(fileUri)}`,
      );
      const remainingOwners = await sql(
        adapter,
        vault,
        `SELECT reef_id FROM reef_attachments WHERE file_uri = ${quote(
          fileUri,
        )} LIMIT 1`,
      );
      if (remainingOwners.length > 0) {
        throw new Error("attachment_delete_readback_mismatch");
      }
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
      const existing = await findRelation(input.idempotencyKey);
      if (
        existing &&
        (existing.record.sourceReefId !== input.sourceReefId ||
          existing.record.targetReefId !== input.targetReefId ||
          existing.record.relation !== input.relation ||
          existing.record.inverseRelation !== input.inverseRelation)
      ) {
        await deleteOwnedRelation(input.idempotencyKey);
      }
      const sourceReadback = await readIssue(input.sourceReefId);
      const targetReadback = await readIssue(input.targetReefId);
      const source = sourceReadback.issue;
      const targetIssue = targetReadback.issue;
      const sourceBefore = source[input.relation] ?? [];
      const targetBefore = targetIssue[input.inverseRelation] ?? [];
      const sourceSidecar = sidecarFor(source);
      const targetSidecar = sidecarFor(targetIssue);
      const previous = sourceSidecar.relations.find(
        (record) => record.idempotencyKey === input.idempotencyKey,
      );
      const directEdgeRecords = sourceSidecar.relations.filter(
        (record) =>
          record.sourceReefId === input.sourceReefId &&
          record.targetReefId === input.targetReefId &&
          record.relation === input.relation &&
          record.inverseRelation === input.inverseRelation,
      );
      const reverseEdgeRecords = targetSidecar.relations.filter(
        (record) =>
          record.sourceReefId === input.targetReefId &&
          record.targetReefId === input.sourceReefId &&
          record.relation === input.inverseRelation &&
          record.inverseRelation === input.relation,
      );
      const sourceCreatedByMigration =
        previous?.sourceCreatedByMigration ??
        (directEdgeRecords.some(
          (record) => record.sourceCreatedByMigration === true,
        ) ||
          reverseEdgeRecords.some(
            (record) => record.targetCreatedByMigration === true,
          ) ||
          !sourceBefore.includes(input.targetReefId));
      const targetCreatedByMigration =
        previous?.targetCreatedByMigration ??
        (directEdgeRecords.some(
          (record) => record.targetCreatedByMigration === true,
        ) ||
          reverseEdgeRecords.some(
            (record) => record.sourceCreatedByMigration === true,
          ) ||
          !targetBefore.includes(input.sourceReefId));
      sourceSidecar.relations = sourceSidecar.relations
        .filter((record) => record.idempotencyKey !== input.idempotencyKey)
        .concat({
          ...input,
          sourceCreatedByMigration,
          targetCreatedByMigration,
        });
      try {
        await updateIssue(
          input.sourceReefId,
          {
            [input.relation]: addUnique(sourceBefore, input.targetReefId),
            custom_fields: customFieldsWithSidecar(source, sourceSidecar),
          },
          undefined,
          {
            commit: sourceReadback.commit_hash,
            updatedAt: source.updated_at,
          },
        );
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
      } catch (error) {
        const [currentSource, currentTarget] = await Promise.all([
          readDocumentedIssue(input.sourceReefId).catch(() => null),
          readDocumentedIssue(input.targetReefId).catch(() => null),
        ]);
        const currentSidecar = currentSource
          ? sidecarFor(currentSource.issue)
          : null;
        const owned = currentSidecar?.relations.some(
          (record) => record.idempotencyKey === input.idempotencyKey,
        );
        const forwardPresent =
          currentSource?.issue[input.relation]?.includes(input.targetReefId) ??
          false;
        const inversePresent =
          currentTarget?.issue[input.inverseRelation]?.includes(
            input.sourceReefId,
          ) ?? false;
        if (owned && forwardPresent && currentTarget) {
          if (inversePresent) return;
          try {
            await updateIssue(
              input.targetReefId,
              {
                [input.inverseRelation]: addUnique(
                  currentTarget.issue[input.inverseRelation] ?? [],
                  input.sourceReefId,
                ),
              },
              undefined,
              {
                commit: currentTarget.commit_hash,
                updatedAt: currentTarget.issue.updated_at,
              },
            );
            return;
          } catch {
            const targetAfterAttempt = await readDocumentedIssue(
              input.targetReefId,
            ).catch(() => null);
            if (
              targetAfterAttempt?.issue[input.inverseRelation]?.includes(
                input.sourceReefId,
              )
            ) {
              return;
            }
            // Roll back the operation marker and its forward edge below. A
            // retry can then reconcile both endpoints from a clean state.
          }
        }
        if (owned && currentSource && currentSidecar) {
          currentSidecar.relations = currentSidecar.relations.filter(
            (record) => record.idempotencyKey !== input.idempotencyKey,
          );
          const relationStillReferenced = currentSidecar.relations.some(
            (record) =>
              record.sourceReefId === input.sourceReefId &&
              record.targetReefId === input.targetReefId &&
              record.relation === input.relation &&
              record.inverseRelation === input.inverseRelation,
          );
          const preserveForward =
            sourceBefore.includes(input.targetReefId) ||
            relationStillReferenced;
          await updateIssue(
            input.sourceReefId,
            {
              [input.relation]: preserveForward
                ? currentSource.issue[input.relation]
                : removeValue(
                    currentSource.issue[input.relation],
                    input.targetReefId,
                  ),
              custom_fields: customFieldsWithSidecar(
                currentSource.issue,
                currentSidecar,
              ),
            },
            undefined,
            {
              commit: currentSource.commit_hash,
              updatedAt: currentSource.issue.updated_at,
            },
          ).catch(() => undefined);
        }
        throw error;
      }
    },
    async hasRelation(idempotencyKey) {
      return (await readVerifiedRelation(idempotencyKey)) !== null;
    },
    async readRelation(idempotencyKey) {
      const record = await readVerifiedRelation(idempotencyKey);
      if (!record) return null;
      return {
        sourceReefId: record.sourceReefId,
        targetReefId: record.targetReefId,
        relation: record.relation,
        inverseRelation: record.inverseRelation,
      };
    },
    deleteRelation: deleteOwnedRelation,
    async putExternalRef(input) {
      const existingOwner = await findExternalRef(input.idempotencyKey);
      if (existingOwner && existingOwner.issue.id !== input.reefId) {
        throw new Error("external_ref_ownership_mismatch");
      }
      const readback = await readIssue(input.reefId);
      const issue = readback.issue;
      const sidecar = sidecarFor(issue);
      const previous = sidecar.externalRefs.find(
        (record) => record.idempotencyKey === input.idempotencyKey,
      );
      const refFingerprint = canonicalizeJson(input.ref);
      const previousOwnsSameRef =
        previous !== undefined &&
        canonicalizeJson(previous.ref) === refFingerprint
          ? previous.createdByMigration
          : undefined;
      const createdByMigration =
        previousOwnsSameRef ??
        (sidecar.externalRefs.some(
          (record) =>
            canonicalizeJson(record.ref) === refFingerprint &&
            record.createdByMigration === true,
        ) ||
          !(issue.external_refs ?? []).some(
            (candidate) => canonicalizeJson(candidate) === refFingerprint,
          ));
      sidecar.externalRefs = sidecar.externalRefs
        .filter((record) => record.idempotencyKey !== input.idempotencyKey)
        .concat({ ...input, createdByMigration });
      const previousStillReferenced =
        previous !== undefined &&
        sidecar.externalRefs.some(
          (record) =>
            canonicalizeJson(record.ref) === canonicalizeJson(previous.ref),
        );
      const removePrevious =
        previous?.createdByMigration === true && !previousStillReferenced;
      const refs = [
        ...(issue.external_refs ?? []).filter(
          (candidate) =>
            canonicalizeJson(candidate) !== refFingerprint &&
            (!removePrevious ||
              canonicalizeJson(candidate) !== canonicalizeJson(previous?.ref)),
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
      return (await readVerifiedExternalRef(idempotencyKey)) !== null;
    },
    async readExternalRef(idempotencyKey) {
      const record = await readVerifiedExternalRef(idempotencyKey);
      if (!record) return null;
      return {
        reefId: record.reefId,
        ref: record.ref,
        provenance: record.provenance,
      };
    },
    async listExternalRefKeys(prefix) {
      const rows = await sql(
        adapter,
        vault,
        `SELECT DISTINCT record->>'idempotencyKey' AS idempotency_key FROM reef_issues CROSS JOIN LATERAL jsonb_array_elements(COALESCE(meta::jsonb->'custom_fields'->'jira_migration'->'external_refs', '[]'::jsonb)) AS record WHERE LEFT(record->>'idempotencyKey', ${
          prefix.length
        }) = ${quote(prefix)} ORDER BY idempotency_key`,
      );
      return rows.flatMap((row) =>
        typeof row.idempotency_key === "string" ? [row.idempotency_key] : [],
      );
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
          canonicalizeJson(candidate.ref) === canonicalizeJson(record.ref),
      );
      await updateIssue(
        record.reefId,
        {
          external_refs: refStillReferenced
            ? issue.external_refs
            : record.createdByMigration === true
              ? (issue.external_refs ?? []).filter(
                  (candidate) =>
                    canonicalizeJson(candidate) !==
                    canonicalizeJson(record.ref),
                )
              : issue.external_refs,
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
  return { allIssueRows, related, activityMatches };
}
