import { z } from "zod";
import { ConflictError, IssueRelationBackfillError } from "../../../errors";
import {
  IssueRelationCheckpointSchema,
  IssueRelationVerificationTimeoutSchema,
  type IssueRelationCheckpoint,
  type IssueRelationBackfillProblem,
} from "../../../schemas/issueRelationBackfill";
import { getAkbDocument } from "../core/documents";
import { parseAkbDocumentUri } from "../core/documentUri";
import { createAkbAdapter, DocumentPutResponseSchema } from "../core/http";
import { getResourceRelations, type AkbRelationEdge } from "../core/relations";
import {
  checkVaultWriteAccess,
  createRepairAdapter,
  inspectRelationRows,
  inspectRows,
  readRows,
  relations,
  RELATION_READ_POLICY,
  sourceAndTargetsUnchanged,
  type RelationBackfillParams,
} from "./relationBackfillInventory";

type Progress = {
  phase: "write" | "verify";
  completed: number;
  total: number;
  pending: number;
};
interface RepairParams extends RelationBackfillParams {
  checkpoints: readonly IssueRelationCheckpoint[];
  onProgress?: (progress: Progress) => void;
}
interface ApplyParams extends RepairParams {
  onCheckpoint: (checkpoint: IssueRelationCheckpoint) => Promise<void>;
}
interface VerifyParams extends RepairParams {
  verificationTimeoutMs?: number;
}

function sameUris(first: readonly string[], second: readonly string[]) {
  const a = new Set(first),
    b = new Set(second);
  return a.size === b.size && [...a].every((uri) => b.has(uri));
}
function checkpointMatches(
  checkpoint: IssueRelationCheckpoint | undefined,
  uri: string,
  expected: ReturnType<typeof relations>,
): checkpoint is IssueRelationCheckpoint {
  return (
    checkpoint !== undefined &&
    checkpoint.document_uri === uri &&
    sameUris(checkpoint.depends_on, expected.depends_on) &&
    sameUris(checkpoint.related_to, expected.related_to)
  );
}
function checkpointMap(checkpoints: readonly IssueRelationCheckpoint[]) {
  return new Map(
    z
      .array(IssueRelationCheckpointSchema)
      .parse(checkpoints)
      .map((entry) => [entry.reef_id, entry]),
  );
}

export async function preflightIssueRelationUris(
  params: RelationBackfillParams,
): Promise<{ count: number }> {
  const adapter = createRepairAdapter(params);
  await checkVaultWriteAccess(adapter, params.vault, params.credential);
  return { count: (await inspectRows(adapter, params.vault)).length };
}

export async function applyIssueRelationUris(
  params: ApplyParams,
): Promise<{ count: number; checkpoints: IssueRelationCheckpoint[] }> {
  const { vault, onCheckpoint, onProgress } = params;
  const adapter = createRepairAdapter(params);
  const writer = createAkbAdapter({
    baseUrl: params.baseUrl,
    credential: params.credential,
    fetch: params.fetch,
    requestPolicy: {
      ...(params.requestPolicy ?? RELATION_READ_POLICY),
      timeoutMs: 120_000,
    },
  });
  const written = checkpointMap(params.checkpoints);
  await checkVaultWriteAccess(adapter, vault, params.credential);
  for (let attempt = 0; attempt < 3; attempt++) {
    const inspected = await inspectRows(adapter, vault);
    const rows = await readRows(adapter, vault);
    if (JSON.stringify(inspected) !== JSON.stringify(rows)) continue;
    const snapshot = JSON.stringify(rows);
    const targets = inspectRelationRows(vault, rows);
    let changed = false,
      completed = 0;
    onProgress?.({
      phase: "write",
      completed,
      total: rows.length,
      pending: rows.length,
    });
    for (const row of rows) {
      if (!(await sourceAndTargetsUnchanged(adapter, vault, row, targets))) {
        changed = true;
        break;
      }
      const doc = await getAkbDocument({
        adapter,
        vault,
        uri: row.document_uri,
      });
      const parsed = parseAkbDocumentUri(row.document_uri);
      if (
        !parsed ||
        parsed.vault !== vault ||
        doc.uri !== row.document_uri ||
        !doc.current_commit
      )
        throw new IssueRelationBackfillError({
          vault,
          phase: "write",
          code: "document_missing",
          problems: [
            { reef_id: row.reef_id, reason: "invalid_document_identity" },
          ],
        });
      const expected = relations(vault, row, targets),
        previous = written.get(row.reef_id);
      if (
        !checkpointMatches(previous, row.document_uri, expected) ||
        previous.document_commit !== doc.current_commit
      ) {
        try {
          const result = DocumentPutResponseSchema.parse(
            await writer.request(
              `/api/v1/documents/${encodeURIComponent(vault)}/${parsed.path}`,
              {
                method: "PATCH",
                body: {
                  ...expected,
                  expected_commit: doc.current_commit,
                  message: "Backfill issue relation URIs",
                },
                resource: "issue document",
              },
            ),
          );
          const entry = IssueRelationCheckpointSchema.parse({
            reef_id: row.reef_id,
            document_uri: row.document_uri,
            document_commit: result.commit_hash,
            ...expected,
          });
          await onCheckpoint(entry);
          written.set(row.reef_id, entry);
        } catch (error) {
          if (error instanceof ConflictError) {
            changed = true;
            break;
          }
          throw error;
        }
      }
      if (!(await sourceAndTargetsUnchanged(adapter, vault, row, targets))) {
        changed = true;
        break;
      }
      completed++;
      onProgress?.({
        phase: "write",
        completed,
        total: rows.length,
        pending: rows.length - completed,
      });
    }
    if (!changed && JSON.stringify(await readRows(adapter, vault)) === snapshot)
      return { count: rows.length, checkpoints: [...written.values()] };
  }
  throw new ConflictError({ path: "issue relation backfill" });
}

function graphProblems(
  reefId: string,
  expected: ReturnType<typeof relations>,
  edges: AkbRelationEdge[],
) {
  const problems: IssueRelationBackfillProblem[] = [];
  for (const field of ["depends_on", "related_to"] as const) {
    const selected = edges.filter((edge) => edge.relation === field);
    const actual = new Set(selected.map((edge) => edge.uri)),
      wanted = new Set(expected[field]);
    const missing = [...wanted].filter((uri) => !actual.has(uri));
    const unexpected = new Set(
      selected
        .filter((edge) => edge.kind !== "explicit" && !wanted.has(edge.uri))
        .map((edge) => edge.uri),
    );
    if (missing.length || unexpected.size)
      problems.push({
        reef_id: reefId,
        reason: "projection_pending",
        field,
        missing_count: missing.length,
        unexpected_count: unexpected.size,
      });
  }
  return problems;
}

export async function verifyIssueRelationUris(
  params: VerifyParams,
): Promise<{ count: number }> {
  const { vault, onProgress } = params;
  const timeout = IssueRelationVerificationTimeoutSchema.parse(
    params.verificationTimeoutMs ?? 30 * 60_000,
  );
  const adapter = createRepairAdapter(params),
    written = checkpointMap(params.checkpoints);
  await checkVaultWriteAccess(adapter, vault, params.credential);
  const rows = await readRows(adapter, vault),
    snapshot = JSON.stringify(rows),
    targets = inspectRelationRows(vault, rows);
  let remaining = rows;
  const deadline = Date.now() + timeout;
  let lastProblems: IssueRelationBackfillProblem[] = [];
  const checkDeadline = () => {
    if (Date.now() >= deadline)
      throw new IssueRelationBackfillError({
        vault,
        phase: "verify",
        code: "projection_pending",
        problems: lastProblems.length
          ? lastProblems
          : remaining.map((row) => ({
              reef_id: row.reef_id,
              reason: "verification_incomplete",
            })),
      });
  };
  for (;;) {
    const problems: IssueRelationBackfillProblem[] = [];
    let matched = rows.length - remaining.length;
    for (const row of remaining) {
      checkDeadline();
      const expected = relations(vault, row, targets),
        entry = written.get(row.reef_id);
      if (!checkpointMatches(entry, row.document_uri, expected))
        throw new ConflictError({ path: "issue relation backfill" });
      const before = await getAkbDocument({
        adapter,
        vault,
        uri: row.document_uri,
      });
      if (
        before.current_commit !== entry.document_commit ||
        before.uri !== row.document_uri
      )
        throw new ConflictError({ path: "issue relation backfill" });
      const edges = await getResourceRelations(adapter, {
        uri: row.document_uri,
        direction: "outgoing",
      });
      const pending = graphProblems(row.reef_id, expected, edges);
      if (!pending.length) {
        const after = await getAkbDocument({
          adapter,
          vault,
          uri: row.document_uri,
        });
        if (
          after.current_commit !== before.current_commit ||
          after.uri !== row.document_uri
        )
          throw new ConflictError({ path: "issue relation backfill" });
      }
      problems.push(...pending);
      if (!pending.length) matched++;
      onProgress?.({
        phase: "verify",
        completed: matched,
        total: rows.length,
        pending: rows.length - matched,
      });
    }
    if (JSON.stringify(await readRows(adapter, vault)) !== snapshot)
      throw new ConflictError({ path: "issue relation backfill" });
    const pendingIds = new Set(problems.map((problem) => problem.reef_id));
    onProgress?.({
      phase: "verify",
      completed: rows.length - pendingIds.size,
      total: rows.length,
      pending: pendingIds.size,
    });
    if (!problems.length) {
      if (remaining !== rows) {
        remaining = rows;
        continue;
      }
      return { count: rows.length };
    }
    lastProblems = problems;
    checkDeadline();
    remaining = rows.filter((row) => pendingIds.has(row.reef_id));
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(5_000, deadline - Date.now())),
    );
  }
}
