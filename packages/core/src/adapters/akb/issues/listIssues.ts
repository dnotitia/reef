import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { hasAnyFilter } from "../../../schemas/issues/requests";
import {
  buildDefaultViewWhere,
  buildIssueOrderBy,
  buildIssueWhere,
  buildKeysetWhere,
  decodeCursor,
  encodeCursor,
  isMissingTableError,
  rowToIssue,
  selectIssueRows,
  withSpan,
} from "../core/shared";
import type { ListIssuesParams, ListIssuesResult } from "../core/types";
import { SqlParameterBuilder } from "../core/sql";

export async function listIssues(
  params: ListIssuesParams,
): Promise<ListIssuesResult> {
  const { adapter, vault, query, actor } = params;
  return withSpan("akb.list_issues", { vault }, async (span) => {
    // Single query against the projection table — no per-document body fetch. A
    // `query` is translated to a server-side WHERE / ORDER BY; `default_view`
    // resolves the narrow landing view; `limit`/`cursor` add keyset pagination.
    // Sort when the client explicitly selected one, or — when paginating —
    // a stable default so the keyset is deterministic. Otherwise emit no
    // ORDER BY, preserving akb's natural order (matching the unsorted client).
    const limit = query?.limit;
    const paginating = limit != null || query?.cursor != null;
    const sortField =
      query?.sort_field ?? (paginating ? "created_at" : undefined);
    const sortOrder = query?.sort_order ?? "desc";
    const orderBy = sortField
      ? buildIssueOrderBy(sortField, sortOrder)
      : undefined;

    // Explicit facets take precedence over the default landing view — just fall
    // into the default view when the request carries no narrowing filter. The
    // active-sprint pick and the My-Issues existence test are folded into this
    // single list query as subqueries (REEF-324), so the landing no longer pays
    // a separate active-sprint or existence-probe akb round-trip. The resolved
    // scope stays up-front-consistent across cursor pages because the `EXISTS`
    // test does not depend on the keyset appended below.
    const defaultViewActive = !!query?.default_view && !hasAnyFilter(query);
    if (defaultViewActive) span.setAttribute("default_view", true);
    span.setAttribute("filtered", query != null);

    const cursor =
      query?.cursor && sortField ? decodeCursor(query.cursor) : undefined;
    const buildWhere = (
      sqlParams: SqlParameterBuilder,
      withActiveSprint = true,
    ): string | undefined => {
      const baseWhere = defaultViewActive
        ? buildDefaultViewWhere(
            { actor: actor ?? null, withActiveSprint },
            sqlParams,
          )
        : query
          ? buildIssueWhere(query, sqlParams)
          : undefined;
      const keysetWhere =
        cursor && sortField
          ? buildKeysetWhere(sortField, sortOrder, cursor, sqlParams)
          : undefined;
      return baseWhere && keysetWhere
        ? `${baseWhere} AND ${keysetWhere}`
        : (keysetWhere ?? baseWhere);
    };
    const fetchLimit = limit != null ? limit + 1 : undefined;

    let rawRows: Record<string, unknown>[];
    try {
      const sqlParams = new SqlParameterBuilder();
      rawRows = await selectIssueRows(
        adapter,
        vault,
        buildWhere(sqlParams),
        orderBy,
        fetchLimit,
        sqlParams,
      );
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
      // The folded default view embeds a `reef_sprints` subquery. A vault that
      // has `reef_issues` but not `reef_sprints` (a pre-planning vault) fails the
      // whole query on the missing relation; retry once without the sprint fold
      // so the view degrades to the floor / My Issues — the resilience the old
      // separate `getActiveSprint` call had — instead of a blank board. A
      // genuinely does not-onboarded vault (`reef_issues` also missing) fails the
      // retry too and yields the empty result below.
      if (!defaultViewActive) {
        span.setAttribute("table_exists", false);
        return { issues: [], next_cursor: null };
      }
      try {
        const retryParams = new SqlParameterBuilder();
        rawRows = await selectIssueRows(
          adapter,
          vault,
          buildWhere(retryParams, false),
          orderBy,
          fetchLimit,
          retryParams,
        );
      } catch (retryErr) {
        if (isMissingTableError(retryErr)) {
          span.setAttribute("table_exists", false);
          return { issues: [], next_cursor: null };
        }
        throw retryErr;
      }
    }

    // Fetched `limit + 1` as a sentinel: a full extra row means there is a next
    // page. Derive the cursor from the RAW row (before parsing / skipping).
    let nextCursor: string | null = null;
    if (sortField && limit != null && rawRows.length > limit) {
      nextCursor = encodeCursor(rawRows[limit - 1], sortField);
      rawRows = rawRows.slice(0, limit);
    }
    span.setAttribute("row_count", rawRows.length);

    const issues: IssueMetadata[] = [];
    for (const row of rawRows) {
      try {
        issues.push(rowToIssue(row));
      } catch (err) {
        // Skip a malformed row rather than failing the whole board.
        span.addEvent("issue_row_skipped", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    span.setAttribute("issue_count", issues.length);
    return { issues, next_cursor: nextCursor };
  });
}
