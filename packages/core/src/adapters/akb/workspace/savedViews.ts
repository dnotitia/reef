import { ZodError } from "zod";
import { NotFoundError, SchemaValidationError } from "../../../errors";
import {
  type SavedIssueView,
  SavedIssueViewSchema,
  normalizeSavedIssueViewName,
} from "../../../schemas/issues/savedView";
import {
  type AkbAdapter,
  REEF_VIEWS_TABLE,
  buildRowAssignments,
  decodeSettingsValue,
  ensureReefTables,
  isMissingTableError,
  quoteIdent,
  quoteJson,
  quoteText,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import type {
  CreateSavedIssueViewParams,
  DeleteSavedIssueViewParams,
  ListSavedIssueViewsParams,
  SavedIssueViewResult,
  UpdateSavedIssueViewParams,
} from "../core/types";

function rowToSavedView(row: Record<string, unknown>): SavedIssueView {
  try {
    return SavedIssueViewSchema.parse({
      ...row,
      payload: decodeSettingsValue(row.payload),
    });
  } catch (error) {
    throw new SchemaValidationError({
      clientValidated: false,
      issues:
        error instanceof ZodError
          ? error.issues.map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`,
            )
          : ["Saved view row validation failed"],
    });
  }
}

async function selectRows(
  adapter: AkbAdapter,
  vault: string,
  where?: string,
): Promise<Record<string, unknown>[]> {
  const result = await runSql(
    adapter,
    vault,
    `SELECT * FROM ${tableRef(REEF_VIEWS_TABLE)}${
      where ? ` WHERE ${where}` : ""
    } ORDER BY name_key ASC, id ASC`,
  );
  return result.kind === "table_query" ? result.items : [];
}

export async function listSavedIssueViews(
  params: ListSavedIssueViewsParams,
): Promise<SavedIssueView[]> {
  return withSpan(
    "akb.list_saved_issue_views",
    { vault: params.vault },
    async (span) => {
      try {
        const rows = await selectRows(params.adapter, params.vault);
        const views = rows.flatMap((row) => {
          try {
            return [rowToSavedView(row)];
          } catch {
            return [];
          }
        });
        span.setAttribute("saved_view_count", views.length);
        return views;
      } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
    },
  );
}

export async function createSavedIssueView(
  params: CreateSavedIssueViewParams,
): Promise<SavedIssueViewResult> {
  return withSpan(
    "akb.create_saved_issue_view",
    { vault: params.vault },
    async () => {
      await ensureReefTables({ adapter: params.adapter, vault: params.vault });
      const name = params.view.name.trim();
      const fields: Array<[string, string]> = [
        ["name", quoteText(name, "saved view name")],
        [
          "name_key",
          quoteText(normalizeSavedIssueViewName(name), "saved view name key"),
        ],
        ["owner", quoteText(params.owner, "saved view owner")],
        ["payload", quoteJson(params.view.payload)],
      ];
      const result = await runSql(
        params.adapter,
        params.vault,
        `INSERT INTO ${tableRef(REEF_VIEWS_TABLE)} (${fields
          .map(([column]) => quoteIdent(column))
          .join(
            ", ",
          )}) VALUES (${fields.map(([, value]) => value).join(", ")}) RETURNING *`,
      );
      const row = result.kind === "table_query" ? result.items[0] : undefined;
      if (!row)
        throw new SchemaValidationError({
          issues: ["Saved view insert returned no row"],
        });
      return { view: rowToSavedView(row) };
    },
  );
}

export async function updateSavedIssueView(
  params: UpdateSavedIssueViewParams,
): Promise<SavedIssueViewResult> {
  return withSpan(
    "akb.update_saved_issue_view",
    { vault: params.vault },
    async () => {
      await ensureReefTables({ adapter: params.adapter, vault: params.vault });
      const fields: Array<[string, string]> = [];
      if (params.patch.name !== undefined) {
        const name = params.patch.name.trim();
        fields.push(
          ["name", quoteText(name, "saved view name")],
          [
            "name_key",
            quoteText(normalizeSavedIssueViewName(name), "saved view name key"),
          ],
        );
      }
      if (params.patch.payload !== undefined) {
        fields.push(["payload", quoteJson(params.patch.payload)]);
      }
      const result = await runSql(
        params.adapter,
        params.vault,
        `UPDATE ${tableRef(REEF_VIEWS_TABLE)} SET ${buildRowAssignments(
          fields,
        )} WHERE id = ${quoteText(params.id, "saved view id")} RETURNING *`,
      );
      const row = result.kind === "table_query" ? result.items[0] : undefined;
      if (!row)
        throw new NotFoundError({ resource: `saved view ${params.id}` });
      return { view: rowToSavedView(row) };
    },
  );
}

export async function deleteSavedIssueView(
  params: DeleteSavedIssueViewParams,
): Promise<void> {
  await withSpan(
    "akb.delete_saved_issue_view",
    { vault: params.vault },
    async () => {
      try {
        await runSql(
          params.adapter,
          params.vault,
          `DELETE FROM ${tableRef(REEF_VIEWS_TABLE)} WHERE id = ${quoteText(
            params.id,
            "saved view id",
          )}`,
        );
      } catch (error) {
        if (isMissingTableError(error)) {
          throw new NotFoundError({ resource: `saved view ${params.id}` });
        }
        throw error;
      }
    },
  );
}
