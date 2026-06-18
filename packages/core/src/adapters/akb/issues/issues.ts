import { NotFoundError } from "../../../errors";
import type { IssueMetadata, Status } from "../../../schemas/issues/metadata";
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
  issuePathFor,
  issueRowMutableFields,
  makeIssueResourceLabel,
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
import { appendStatusChangeEvent } from "./activity";
export { buildIssueMetadataFromCreateInput } from "./createMetadata";
export { allocateNextIssueId, listIssueRelations } from "./issueRelations";
export { listIssues } from "./listIssues";

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
  const { adapter, vault, issue, content = "" } = params;
  return withSpan("akb.write_issue", { vault, id: issue.id }, async () => {
    // Assumes `reef_issues` exists (provisioned by `ensureReefTables` at vault
    // creation / config write), mirroring `writeConfig`. A missing table
    // surfaces loudly from the INSERT rather than being silently auto-healed.
    const body = buildPutRequestBody(vault, issue, content);
    const payload = await adapter.request("/api/v1/documents", {
      method: "POST",
      body,
      resource: makeIssueResourceLabel(issue.id),
    });
    const put = ensureDocumentPutResponse(payload);

    // Insert the queryable projection row keyed to the document. On failure,
    // compensate by deleting the document we just created — a doc without a
    // row is invisible to the board, so we does not leave that orphan behind.
    // `assignBacklogRank` appends a new backlog issue to the manual-order tail
    // (REEF-176) so the backlog does not gains an unranked row.
    try {
      await insertIssueRow(adapter, vault, issue, put.uri, {
        assignBacklogRank: true,
      });
    } catch (err) {
      await deleteDocumentQuietly(adapter, vault, put.path);
      throw err;
    }
    return {
      path: put.path,
      commit_hash: put.commit_hash,
    };
  });
}

export async function updateIssue(
  params: UpdateIssueParams,
): Promise<UpdateIssueResult> {
  const { adapter, vault, id, partial, content, message } = params;
  return withSpan("akb.update_issue", { vault, id }, async (span) => {
    const current = await readIssue({ adapter, vault, id });
    const mergedIssue = mergeIssue(current.issue, partial);
    const mergedBody = content ?? current.content;

    // The akb document is the canonical source for the body + native-projected
    // fields (title→summary, labels→tags, depends_on/blocks→relations). PATCH
    // it when one of those actually changed — status/priority/etc. live
    // just in the table, so flipping a status shouldn't churn a git commit.
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
    // the row). A clean status/priority edit (docDirty=false) does not touched the
    // document, so there is nothing to rewind.
    // Born-correct backlog rank (REEF-176): an issue demoted INTO the backlog
    // with no rank yet appends to the manual-order tail, so the backlog does not
    // gains an unranked row. A status change WITHIN the backlog, or the return
    // of an already-ranked issue, leaves the existing rank untouched. (`rank` is
    // not an updatable field, so `mergedIssue.rank` is the current row's value.)
    const enteringBacklog =
      mergedIssue.status === "backlog" &&
      current.issue.status !== "backlog" &&
      mergedIssue.rank == null;
    // Capture the status this write actually overwrote, atomically with the
    // write itself. The `prev` CTE locks the row with `FOR UPDATE`, so under a
    // concurrent last-write-wins race it blocks on the in-flight writer and then
    // re-reads that writer's freshly committed status (READ COMMITTED EvalPlanQual)
    // — the same version the `upd` CTE then overwrites. Both CTEs therefore act on
    // one locked current row, so the recorded `from` is the value the write truly
    // replaced, never a stale `readIssue` snapshot (A: todo→in_progress, then B
    // records in_progress→done, not a phantom todo→done). The UPDATE stays
    // unconditional LWW — no CAS, per the adapter contract; the lock only
    // serializes the read-old-then-write so the audit `from` is faithful.
    let committedFromStatus: string | undefined;
    try {
      const updateRes = await runSql(
        adapter,
        vault,
        `WITH prev AS (SELECT reef_id, status AS from_status FROM ${tableRef(
          REEF_ISSUES_TABLE,
        )} WHERE reef_id = ${quoteText(
          id,
          "reef_id",
        )} FOR UPDATE), upd AS (UPDATE ${tableRef(
          REEF_ISSUES_TABLE,
        )} SET ${buildRowAssignments(
          issueRowMutableFields(
            mergedIssue,
            enteringBacklog ? { rankExpr: backlogTailRankExpr() } : undefined,
          ),
        )} FROM prev WHERE ${tableRef(
          REEF_ISSUES_TABLE,
        )}.reef_id = prev.reef_id RETURNING ${tableRef(
          REEF_ISSUES_TABLE,
        )}.reef_id) SELECT from_status FROM prev`,
      );
      committedFromStatus =
        updateRes.kind === "table_query"
          ? (updateRes.items[0]?.from_status as string | undefined)
          : undefined;
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
    // just known after the write. Read it back when we entered the backlog so the
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
    // change, so a failed append must not fail the issue update; the row's own
    // `last_status_change` stays the single-event safety net (AC5).
    //
    // `from` is the status the write actually overwrote (captured atomically by
    // the locked `prev` CTE), so the recorded transition stays correct under
    // concurrent updates. The event fires only when that committed status actually
    // moved AND this update carried a transition timestamp — `partial`, not the
    // merged value, so the signal is "this caller stamped a status change" rather
    // than "the row happens to have a last_status_change". `at` is that caller
    // timestamp (the canonical transition time + idempotency-key source). The
    // web/agent funnels always provide it via `buildIssueUpdateMetadataPatch`; a
    // raw status flip that omits it (no event time to key on), or an update that
    // did not commit a status row (`committedFromStatus` absent), records nothing.
    // It is NOT gated on the timestamp differing from the row's prior value — two
    // transitions sharing one timestamp are distinct events (the key carries
    // from→to) and must both be logged.
    const statusTo = mergedIssue.status;
    const transitionAt = partial.last_status_change;
    if (
      committedFromStatus != null &&
      committedFromStatus !== statusTo &&
      transitionAt != null
    ) {
      try {
        await appendStatusChangeEvent(adapter, vault, {
          reefId: id,
          from: committedFromStatus as Status,
          to: statusTo,
          at: transitionAt,
          actor: mergedIssue.updated_by,
          source: mergedIssue.source ?? null,
        });
      } catch (err) {
        span.addEvent("activity_append_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
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
 * materialization, curated re-space) can not leave the server partially
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
