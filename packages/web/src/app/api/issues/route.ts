import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  parseIssueListQueryParams,
  parseVaultParam,
  resolveOptionalActor,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { tracer } from "@/lib/telemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  CreateIssueRequestSchema,
  IssueListItemSchema,
  type IssueListQuery,
  IssueListQuerySchema,
  akbAddIssueReference as addIssueReference,
  akbAllocateNextIssueId as allocateNextIssueId,
  buildIssueMetadataFromCreateInput,
  hasAnyFilter,
  akbListIssues as listIssues,
  akbWriteIssue as writeIssue,
} from "@reef/core";

/**
 * POST /api/issues — create a user-authored issue in the active vault.
 *
 * The handler allocates the next sequential ID against the current vault's
 * issues, builds issue metadata, and writes via the akb adapter. The adapter
 * is per-request; JWT is held just in closure scope.
 */
export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = CreateIssueRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, create, prefix, references } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const result = await tracer.startActiveSpan(
      "route.create_issue",
      async (span) => {
        span.setAttribute("vault", vault);
        span.setAttribute("prefix", prefix);
        try {
          const id = await allocateNextIssueId({ adapter, vault, prefix });
          span.setAttribute("issue_id", id);

          const issue = buildIssueMetadataFromCreateInput({
            id,
            create,
            author: actor,
            source: "user:create_issue",
          });
          await writeIssue({ adapter, vault, issue, content: create.content });
          // Link cited akb documents as `references` edges now that the issue
          // exists (REEF-083 AC4). A link failure should not undo a successfully
          // created issue, so failures are collected and returned to the client
          // (which warns the user) rather than thrown or silently dropped.
          const failedReferences: string[] = [];
          for (const targetUri of references ?? []) {
            try {
              await addIssueReference(adapter, vault, id, targetUri);
            } catch (refErr) {
              logger.error(
                { err: refErr, vault, id },
                "create_issue reference link failed",
              );
              failedReferences.push(targetUri);
            }
          }
          span.setAttribute("reference_count", (references ?? []).length);
          span.setAttribute("reference_failures", failedReferences.length);
          return { issue, failedReferences };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          throw err;
        } finally {
          span.end();
        }
      },
    );

    return Response.json(
      { issue: result.issue, failed_references: result.failedReferences },
      { status: 201 },
    );
  } catch (err) {
    logger.error({ err, vault, prefix }, "create_issue failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}

/**
 * GET /api/issues?vault={vault_name} — list every issue in the active vault.
 *
 * akb does not surface response ETags today, so the client leans on
 * TanStack Query's staleTime alone. Mutations invalidate the list key to
 * bypass staleness when needed.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const rawQuery = parseIssueListQueryParams(new URL(request.url).searchParams);
  let query: IssueListQuery | undefined;
  if (rawQuery) {
    const parsed = IssueListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) return invalidBodyResponse(parsed.error);
    query = parsed.data;
  }

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  // Explicit filters take precedence over the default landing view — the
  // default view applies when no narrowing facet is present. It needs the
  // current actor (My Issues), decoded straight from the session-cookie JWT
  // claims with no akb round-trip in the common case (REEF-324; `/auth/me` is a
  // fallback for older tokens). failure to resolve it is non-fatal — the view
  // degrades to the active-sprint / status-window floor rather than erroring.
  const defaultViewActive = !!query?.default_view && !hasAnyFilter(query);
  const actor = defaultViewActive
    ? ((await resolveOptionalActor(request)) ?? undefined)
    : undefined;

  try {
    const result = await tracer.startActiveSpan(
      "route.list_issues",
      async (span) => {
        span.setAttribute("vault", vault);
        span.setAttribute("filtered", query != null);
        span.setAttribute("default_view", defaultViewActive);
        try {
          const res = await listIssues({ adapter, vault, query, actor });
          span.setAttribute("issue_count", res.issues.length);
          return {
            issues: res.issues.map((issue) => IssueListItemSchema.parse(issue)),
            next_cursor: res.next_cursor ?? null,
          };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          throw err;
        } finally {
          span.end();
        }
      },
    );

    // A paginated request (explicit `limit`) gets the full envelope; the
    // unpaginated full-list response stays `{ issues }` for old-shape.
    return Response.json(
      query?.limit != null
        ? {
            issues: result.issues,
            next_cursor: result.next_cursor,
            column_counts: null,
          }
        : { issues: result.issues },
    );
  } catch (err) {
    logger.error({ err, vault }, "list_issues failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
