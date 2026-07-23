import { isDeepStrictEqual } from "node:util";
import { ConflictError, NotFoundError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  REEF_ISSUES_TABLE,
  backlogTailRankExpr,
  buildIssueDocPatchBody,
  buildPutRequestBody,
  buildRowAssignments,
  deleteDocumentQuietly,
  ensureDocumentPutResponse,
  ensureDocumentResponse,
  insertIssueRow,
  issueDocumentUri,
  issuePathFor,
  issueRowMutableFields,
  makeIssueResourceLabel,
  quoteJson,
  quoteNumberOrNull,
  quoteText,
  rowToIssue,
  runSql,
  selectIssueRows,
  stringArraysEqual,
  tableRef,
  withSpan,
} from "../core/shared";
import type {
  AllocateNextIssueIdParams,
  ClaimIssueIdParams,
  DeleteIssueParams,
  ReadIssueParams,
  ReadIssueResult,
  ReorderBacklogParams,
  UpdateIssueParams,
  UpdateIssueResult,
  WriteIssueParams,
  WriteIssueResult,
  WriteMultipleIssuesInput,
  WriteMultipleIssuesItemResult,
  WriteMultipleIssuesOutput,
} from "../core/types";
import {
  appendActivityEvents,
  appendStatusChangeEvent,
  diffFieldActivityEvents,
} from "./activity";
export { buildIssueMetadataFromCreateInput } from "./createMetadata";
export { allocateNextIssueId, listIssueRelations } from "./issueRelations";
export { listIssues } from "./listIssues";
export {
  searchSimilarIssues,
  type SearchSimilarIssuesParams,
} from "./similarIssues";

const sameJiraMigrationOwner = (left: unknown, right: unknown): boolean => {
  if (
    !left ||
    typeof left !== "object" ||
    Array.isArray(left) ||
    !right ||
    typeof right !== "object" ||
    Array.isArray(right)
  ) {
    return false;
  }
  const leftOwner = left as Record<string, unknown>;
  const rightOwner = right as Record<string, unknown>;
  return (
    typeof leftOwner.jira_cloud_id === "string" &&
    typeof leftOwner.issue_id === "string" &&
    leftOwner.jira_cloud_id === rightOwner.jira_cloud_id &&
    leftOwner.issue_id === rightOwner.issue_id
  );
};

export async function readIssue(
  params: ReadIssueParams,
): Promise<ReadIssueResult> {
  const { adapter, vault, id } = params;
  return withSpan("akb.read_issue", { vault, id }, async () => {
    // The document carries the markdown body + path/commit; the reef_issues
    // row carries the queryable fields. Fetch the document first (its 404 is
    // the canonical "not found"), then the row, and join them.
    const docPayload = await adapter.request(
      `/api/v1/documents/${encodeURIComponent(vault)}/${issuePathFor(id)}`,
      { resource: makeIssueResourceLabel(id) },
    );
    const doc = ensureDocumentResponse(docPayload);
    const rows = await selectIssueRows(
      adapter,
      vault,
      `reef_id = ${quoteText(id, "reef_id")}`,
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundError({ resource: makeIssueResourceLabel(id) });
    }
    return {
      issue: rowToIssue(row),
      path: doc.path,
      commit_hash: doc.current_commit ?? null,
      content: doc.content ?? "",
    };
  });
}

export async function writeIssue(
  params: WriteIssueParams,
): Promise<WriteIssueResult> {
  const { adapter, vault, issue, content = "", claimFirst = false } = params;
  return withSpan("akb.write_issue", { vault, id: issue.id }, async () => {
    // Assumes `reef_issues` exists (provisioned by `ensureReefTables` at vault
    // creation / config write), mirroring `writeConfig`. A missing table
    // surfaces loudly from the INSERT rather than being silently auto-healed.
    const body = buildPutRequestBody(vault, issue, content);
    if (claimFirst) {
      try {
        await insertIssueRow(
          adapter,
          vault,
          issue,
          issueDocumentUri(vault, issue.id),
          { assignBacklogRank: true },
        );
      } catch (error) {
        const existing = (
          await selectIssueRows(
            adapter,
            vault,
            `reef_id = ${quoteText(issue.id, "reef_id")}`,
          )
        )[0];
        const existingIssue = existing ? rowToIssue(existing) : null;
        const owner = (
          issue.custom_fields?.jira_migration as
            | Record<string, unknown>
            | undefined
        )?.owner;
        const existingOwner = (
          existingIssue?.custom_fields?.jira_migration as
            | Record<string, unknown>
            | undefined
        )?.owner;
        const relationKeys = new Set(["depends_on", "blocks", "related_to"]);
        const desiredKeys = Object.keys(issue).filter(
          (key) => issue[key as keyof IssueMetadata] !== undefined,
        );
        const desiredProjection = Object.fromEntries(
          desiredKeys.map((key) => [key, issue[key as keyof IssueMetadata]]),
        );
        const existingProjection = existingIssue
          ? Object.fromEntries(
              desiredKeys.map((key) => [
                key,
                relationKeys.has(key) &&
                existingIssue[key as keyof IssueMetadata] === undefined
                  ? []
                  : existingIssue[key as keyof IssueMetadata],
              ]),
            )
          : null;
        if (
          !existingIssue ||
          existing.document_uri !== issueDocumentUri(vault, issue.id) ||
          owner === undefined ||
          !sameJiraMigrationOwner(existingOwner, owner)
        ) {
          throw error;
        }
        if (!isDeepStrictEqual(existingProjection, desiredProjection)) {
          await runSql(
            adapter,
            vault,
            `UPDATE ${tableRef(REEF_ISSUES_TABLE)} SET ${buildRowAssignments(
              issueRowMutableFields(issue),
            )} WHERE reef_id = ${quoteText(
              issue.id,
              "reef_id",
            )} AND meta::jsonb->'custom_fields'->'jira_migration'->'owner' = ${quoteJson(
              existingOwner,
            )}::jsonb`,
          );
          const refreshed = (
            await selectIssueRows(
              adapter,
              vault,
              `reef_id = ${quoteText(issue.id, "reef_id")}`,
            )
          )[0];
          const refreshedIssue = refreshed ? rowToIssue(refreshed) : null;
          const refreshedProjection = refreshedIssue
            ? Object.fromEntries(
                desiredKeys.map((key) => [
                  key,
                  relationKeys.has(key) &&
                  refreshedIssue[key as keyof IssueMetadata] === undefined
                    ? []
                    : refreshedIssue[key as keyof IssueMetadata],
                ]),
              )
            : null;
          if (!isDeepStrictEqual(refreshedProjection, desiredProjection)) {
            throw error;
          }
        }
      }
    }
    const payload = await adapter.request("/api/v1/documents", {
      method: "POST",
      body,
      resource: makeIssueResourceLabel(issue.id),
    });
    const put = ensureDocumentPutResponse(payload);

    // Insert the queryable projection row keyed to the document. On failure,
    // compensate by deleting the document we created — a doc without a
    // row is invisible to the board, so we do not leave that orphan behind.
    // `assignBacklogRank` appends a new backlog issue to the manual-order tail
    // (REEF-176) so the backlog does not gain an unranked row.
    if (!claimFirst) {
      try {
        await insertIssueRow(adapter, vault, issue, put.uri, {
          assignBacklogRank: true,
        });
      } catch (err) {
        await deleteDocumentQuietly(adapter, vault, put.path);
        throw err;
      }
    }
    return {
      path: put.path,
      commit_hash: put.commit_hash,
    };
  });
}

export async function claimIssueId(params: ClaimIssueIdParams): Promise<void> {
  const { adapter, vault, issue } = params;
  const owner = (
    issue.custom_fields?.jira_migration as Record<string, unknown> | undefined
  )?.owner;
  if (owner === undefined) throw new Error("issue_claim_owner_required");
  const reservation: IssueMetadata = {
    ...issue,
    parent_id: undefined,
    depends_on: [],
    related_to: [],
    blocks: [],
  };
  try {
    await insertIssueRow(
      adapter,
      vault,
      reservation,
      issueDocumentUri(vault, issue.id),
      { assignBacklogRank: true },
    );
  } catch (error) {
    const existing = (
      await selectIssueRows(
        adapter,
        vault,
        `reef_id = ${quoteText(issue.id, "reef_id")}`,
      )
    )[0];
    const existingIssue = existing ? rowToIssue(existing) : null;
    const existingOwner = (
      existingIssue?.custom_fields?.jira_migration as
        | Record<string, unknown>
        | undefined
    )?.owner;
    if (
      !existingIssue ||
      existing.document_uri !== issueDocumentUri(vault, issue.id) ||
      !sameJiraMigrationOwner(existingOwner, owner)
    ) {
      throw error;
    }
  }
}

export async function updateIssue(
  params: UpdateIssueParams,
): Promise<UpdateIssueResult> {
  const {
    adapter,
    vault,
    id,
    partial,
    content,
    message,
    expectedCommit,
    expectedUpdatedAt,
  } = params;
  return withSpan("akb.update_issue", { vault, id }, async (span) => {
    const current = await readIssue({ adapter, vault, id });
    const mergedIssue = mergeIssue(current.issue, partial);
    const mergedBody = content ?? current.content;

    // The akb document is the canonical source for the body + native-projected
    // fields (title→summary, labels→tags, depends_on/blocks→relations). PATCH
    // it when one of those actually changed — status/priority/etc. live
    // in the table, so flipping a status shouldn't churn a git commit.
    const docDirty =
      content !== undefined ||
      mergedIssue.title !== current.issue.title ||
      !stringArraysEqual(mergedIssue.labels, current.issue.labels) ||
      !stringArraysEqual(mergedIssue.depends_on, current.issue.depends_on) ||
      !stringArraysEqual(mergedIssue.related_to, current.issue.related_to) ||
      !stringArraysEqual(mergedIssue.blocks, current.issue.blocks);

    const docPath = `/api/v1/documents/${encodeURIComponent(vault)}/${issuePathFor(id)}`;
    let commitHash = current.commit_hash ?? "";
    if (docDirty) {
      const updateBody = buildIssueDocPatchBody(mergedIssue, mergedBody);
      if (message !== undefined) {
        updateBody.message = message;
      }
      if (expectedCommit) {
        // Document-level OCC (REEF-227): akb rejects this PATCH with 409
        // (→ ConflictError) when the document's current commit moved past the
        // base the editor read. One precondition guards every document-projected
        // field — body, title, labels→tags, depends_on/blocks/related_to→
        // relations — so a concurrent external edit surfaces as a retryable save
        // conflict instead of being silently overwritten. Row-edits does not
        // reach here, staying last-write-wins. A 409 fires before the row UPDATE
        // below, so nothing diverges and no compensation is needed. The
        // compensating re-PATCH deliberately omits the precondition: it is a
        // forced rewind, not a user edit racing a concurrent writer.
        updateBody.expected_commit = expectedCommit;
      }
      const payload = await adapter.request(docPath, {
        method: "PATCH",
        body: updateBody,
        resource: makeIssueResourceLabel(id),
      });
      commitHash = ensureDocumentPutResponse(payload).commit_hash;
    }

    // consistently update the row — even a body edit — so akb bumps the row's
    // auto `updated_at`, the canonical "last changed" timestamp. The document
    // and row are non-transactional: if the document already advanced to a new
    // commit (docDirty) but this row UPDATE fails, compensate by re-PATCHing the
    // document back to its prior values so the two stores don't diverge. The
    // compensation is best-effort and the original error wins, mirroring the
    // sagas in `writeIssue` (delete the orphaned doc) and `deleteIssue` (restore
    // the row). A clean status/priority edit (docDirty=false) does not touch the
    // document, so there is nothing to rewind.
    // Born-correct backlog rank (REEF-176): an issue demoted INTO the backlog
    // with no rank yet appends to the manual-order tail, so the backlog does not
    // gain an unranked row. A status change WITHIN the backlog, or the return
    // of an already-ranked issue, leaves the existing rank untouched. (`rank` is
    // not an updatable field, so `mergedIssue.rank` is the current row's value.)
    const enteringBacklog =
      mergedIssue.status === "backlog" &&
      current.issue.status !== "backlog" &&
      mergedIssue.rank == null;
    try {
      const rowUpdate = await runSql(
        adapter,
        vault,
        expectedUpdatedAt
          ? `WITH upd AS (UPDATE ${tableRef(
              REEF_ISSUES_TABLE,
            )} SET ${buildRowAssignments(
              issueRowMutableFields(
                mergedIssue,
                enteringBacklog
                  ? { rankExpr: backlogTailRankExpr() }
                  : undefined,
              ),
            )} WHERE reef_id = ${quoteText(
              id,
              "reef_id",
            )} AND updated_at = ${quoteText(
              expectedUpdatedAt,
              "expected updated_at",
            )} RETURNING reef_id) SELECT reef_id FROM upd`
          : `UPDATE ${tableRef(REEF_ISSUES_TABLE)} SET ${buildRowAssignments(
              issueRowMutableFields(
                mergedIssue,
                enteringBacklog
                  ? { rankExpr: backlogTailRankExpr() }
                  : undefined,
              ),
            )} WHERE reef_id = ${quoteText(id, "reef_id")}`,
      );
      if (
        expectedUpdatedAt &&
        rowUpdate.kind === "table_query" &&
        rowUpdate.items.length === 0
      ) {
        throw new ConflictError({ path: issuePathFor(id) });
      }
    } catch (err) {
      if (docDirty) {
        const revertBody = buildIssueDocPatchBody(
          current.issue,
          current.content,
        );
        revertBody.message = `Revert ${id} document: row update failed`;
        await adapter
          .request(docPath, {
            method: "PATCH",
            body: revertBody,
            resource: makeIssueResourceLabel(id),
          })
          .catch(() => {
            // Best-effort compensation; the original row-update error takes
            // precedence. If this re-PATCH also fails the stores stay diverged,
            // same contract as the other two sagas' best-effort compensations.
          });
      }
      throw err;
    }

    // The tail rank was assigned by an in-statement subquery, so its value is
    // known after the write. Read it back when we entered the backlog so the
    // returned issue — and the detail/list caches `useUpdateIssue` seeds from it —
    // carry the real rank instead of the pre-assignment null, upholding the
    // born-correct invariant (REEF-176). fires on demote-into-backlog.
    if (enteringBacklog) {
      const [row] = await selectIssueRows(
        adapter,
        vault,
        `reef_id = ${quoteText(id, "reef_id")}`,
      );
      if (row?.rank != null) {
        mergedIssue.rank = Number(row.rank);
      }
    }

    // Record the status transition as an immutable activity event (REEF-063).
    // This is the reef-web code funnel: every code path that changes status
    // (PATCH route, activity-inbox approve, agent-artifact approve) flows
    // through here. Best-effort — the row UPDATE above already committed the
    // change, so a failed append should not fail the issue update; the row's own
    // `last_status_change` stays the single-event safety net (AC5).
    //
    // `from` is the status this write observed in `readIssue` — the same snapshot
    // the row UPDATE above is itself computed from, so the event is consistent
    // with what this write actually did. reef is last-write-wins with no CAS or
    // row-locking plumbing (root AGENTS.md), and the akb runtime SQL surface does
    // not expose the locking primitives a serializable `from` would need, so two
    // racing status writes can each log their own observed transition rather than
    // one globally-ordered chain — the deliberate LWW trade-off the rest of the
    // system already makes. The event fires when the status moved AND this
    // update carried a transition timestamp in `partial` (not the merged value):
    // "this caller stamped a status change", which is exactly what
    // `buildIssueUpdateMetadataPatch` does on every web/agent funnel. `at` is that
    // caller timestamp (the canonical transition time + idempotency-key source).
    // It is NOT gated on the timestamp differing from the row's prior value — two
    // transitions sharing one timestamp are distinct events (the key carries
    // from→to) and needs both to be logged.
    const statusFrom = current.issue.status;
    const statusTo = mergedIssue.status;
    const transitionAt = partial.last_status_change;
    if (statusFrom !== statusTo && transitionAt != null) {
      try {
        await appendStatusChangeEvent(adapter, vault, {
          reefId: id,
          from: statusFrom,
          to: statusTo,
          at: transitionAt,
          actor: mergedIssue.updated_by,
          // This update's provenance, not the issue's stale stored source: a
          // manual web move (no source on the patch) records null, an
          // approve/scan move records its `ai-agent:*` source. Using
          // `mergedIssue.source` would stamp an AI-created issue's old source
          // onto a later manual transition.
          source: partial.source ?? null,
        });
      } catch (err) {
        span.addEvent("activity_append_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record the non-status field changes as immutable activity events
    // (REEF-126), extending the same best-effort code funnel above to assignee,
    // priority, planning links, and newly-linked delivery refs. Gated on the
    // caller-stamped `updated_at` — present on every web/agent funnel via
    // `buildIssueUpdateMetadataPatch` — so all events from one save share that
    // single timestamp (events group under one instant, AC3) and a literal retry
    // of the same patch reproduces their keys. status_change is deliberately not
    // re-derived here; it keeps its own funnel keyed on `last_status_change`.
    // Best-effort: the row UPDATE already committed, so a failed append should not
    // fail the issue update.
    const fieldChangeAt = partial.updated_at;
    if (fieldChangeAt != null) {
      const fieldEvents = diffFieldActivityEvents(
        id,
        current.issue,
        mergedIssue,
        {
          at: fieldChangeAt,
          actor: mergedIssue.updated_by,
          source: partial.source ?? null,
        },
      );
      if (fieldEvents.length > 0) {
        try {
          await appendActivityEvents(adapter, vault, fieldEvents);
        } catch (err) {
          span.addEvent("activity_append_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return {
      commit_hash: commitHash,
      issue: mergedIssue,
      content: mergedBody,
    };
  });
}

function mergeIssue(
  current: IssueMetadata,
  partial: Partial<IssueMetadata>,
): IssueMetadata {
  // Drop undefined keys so we don't clobber existing fields. Explicit `null`
  // is the "clear this field" sentinel — used by the archive/unarchive flow
  // to clear `archived_at`. We delete the key entirely rather than carry
  // `null` so the field maps to a SQL NULL via `quoteTextOrNull`.
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    if (value === null) {
      delete merged[key];
      continue;
    }
    merged[key] = value;
  }
  return merged as IssueMetadata;
}

export async function deleteIssue(params: DeleteIssueParams): Promise<void> {
  const { adapter, vault, id } = params;
  await withSpan("akb.delete_issue", { vault, id }, async () => {
    // Capture the row first so we can compensate if the document delete fails
    // after the row delete — the two stores are non-transactional.
    const rows = await selectIssueRows(
      adapter,
      vault,
      `reef_id = ${quoteText(id, "reef_id")}`,
    );
    const row = rows[0];

    await runSql(
      adapter,
      vault,
      `DELETE FROM ${tableRef(REEF_ISSUES_TABLE)} WHERE reef_id = ${quoteText(
        id,
        "reef_id",
      )}`,
    );

    try {
      await adapter.request(
        `/api/v1/documents/${encodeURIComponent(vault)}/${issuePathFor(id)}`,
        {
          method: "DELETE",
          resource: makeIssueResourceLabel(id),
        },
      );
    } catch (err) {
      // A 404 means the document was already gone — the delete is effectively
      // complete, so leave the row deleted and propagate. Any other failure
      // leaves an orphaned document (invisible to the board and a future
      // id-allocation collision), so restore the row before surfacing it.
      if (row && !(err instanceof NotFoundError)) {
        await insertIssueRow(
          adapter,
          vault,
          rowToIssue(row),
          String(row.document_uri),
        ).catch(() => {
          // Best-effort compensation; the original error takes precedence.
        });
      }
      throw err;
    }
  });
}

/**
 * Persist a backlog drag-reorder's `rank` writes (REEF-129) as ONE atomic SQL
 * `UPDATE … SET rank = CASE reef_id … END` so a multi-row reorder (tail
 * materialization, curated re-space) does not leave the server partially
 * reordered the way independent per-row PATCHes could. `rank` is a typed row
 * column absent from the document, so this is a pure row update — no document
 * PATCH, no commit, no compensation saga. Last-write-wins, like every row edit.
 *
 * akb bumps `updated_at` on the write and projects `updated_by` from
 * `meta.last_editor`, so the same statement stamps `last_editor` with the actor
 * — otherwise reordered rows would read as freshly updated by a stale editor.
 */
export async function reorderBacklogIssues(
  params: ReorderBacklogParams,
): Promise<void> {
  const { adapter, vault, assignments, actor } = params;
  if (assignments.length === 0) return;
  await withSpan(
    "akb.reorder_backlog",
    { vault, count: assignments.length },
    async () => {
      const cases = assignments
        .map(
          (a) =>
            `WHEN ${quoteText(a.id, "reorder reef_id")} THEN ${quoteNumberOrNull(
              a.rank,
            )}`,
        )
        .join(" ");
      const ids = assignments
        .map((a) => quoteText(a.id, "reorder reef_id"))
        .join(", ");
      const editor = `to_jsonb(${quoteText(actor, "reorder actor")}::text)`;
      // Scope the write to rows actually in the active backlog: `status =
      // 'backlog'` AND not archived. A stale client (its backlog query can stay
      // fresh up to `staleTime` while another user promotes, closes, or archives
      // an issue) should not stamp rank / updated_at / last_editor onto a row
      // outside the active backlog — an archived backlog issue keeps its status
      // but is excluded by `archived_at IS NULL`, so the status guard alone would
      // still corrupt it. Rows outside the active backlog are simply skipped.
      const backlog = quoteText("backlog", "reorder status guard");
      await runSql(
        adapter,
        vault,
        `UPDATE ${tableRef(REEF_ISSUES_TABLE)} SET "rank" = CASE "reef_id" ${cases} END, ` +
          `"meta" = jsonb_set("meta"::jsonb, '{last_editor}', ${editor})::json ` +
          `WHERE "reef_id" IN (${ids}) AND "status" = ${backlog} AND "archived_at" IS NULL`,
      );
    },
  );
}

export async function writeMultipleIssues(
  input: WriteMultipleIssuesInput,
): Promise<WriteMultipleIssuesOutput> {
  const { adapter, vault, issues } = input;
  return withSpan(
    "akb.write_multiple_issues",
    { vault, count: issues.length },
    async (span) => {
      const results: WriteMultipleIssuesItemResult[] = [];
      // Sequential to keep per-item errors attributable and to play nicely
      // with akb's git serialization (one commit at a time per vault).
      for (const { issue, content } of issues) {
        try {
          const written = await writeIssue({ adapter, vault, issue, content });
          results.push({
            id: issue.id,
            success: true,
            path: written.path,
            commit_hash: written.commit_hash,
          });
        } catch (err) {
          results.push({
            id: issue.id,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
          span.addEvent("issue_write_failed", { id: issue.id });
        }
      }
      span.setAttribute("succeeded", results.filter((r) => r.success).length);
      return { results };
    },
  );
}
