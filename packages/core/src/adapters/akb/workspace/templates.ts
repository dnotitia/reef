import { ZodError } from "zod";
import { NotFoundError, SchemaValidationError } from "../../../errors";
import {
  type Template,
  TemplateSchema,
} from "../../../schemas/issues/template";
import {
  type AkbAdapter,
  REEF_TEMPLATES_TABLE,
  buildRowAssignments,
  decodeStringArray,
  isMissingTableError,
  quoteIdent,
  quoteJson,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
  withSpan,
} from "../core/shared";
import { ensureReefTables } from "../core/shared";
import type {
  DeleteTemplateParams,
  ListTemplatesParams,
  ReadTemplateParams,
  ReadTemplateResult,
  TemplateEntry,
  WriteTemplateParams,
} from "../core/types";

function rowToTemplate(row: Record<string, unknown>): Template {
  const candidate: Record<string, unknown> = {
    name: row.name,
    label: row.label,
    description: typeof row.description === "string" ? row.description : "",
    default_labels: decodeStringArray(row.default_labels) ?? [],
    body: typeof row.body === "string" ? row.body : "",
    ...(row.title_prefix != null && { title_prefix: row.title_prefix }),
    ...(row.priority != null && { priority: row.priority }),
  };
  try {
    return TemplateSchema.parse(candidate);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["Template row validation failed"],
    });
  }
}

/**
 * The mutable template-row columns and their SQL value literals. Shared by
 * INSERT and UPDATE — `name` is the immutable key, added separately on INSERT
 * and used in the WHERE clause on UPDATE. `meta` is reserved for future
 * extension fields and is left untouched (NULL) by writes today.
 */
function templateRowMutableFields(template: Template): Array<[string, string]> {
  return [
    ["label", quoteText(template.label, "template label")],
    ["description", quoteText(template.description, "template description")],
    [
      "title_prefix",
      quoteTextOrNull(template.title_prefix, "template title_prefix"),
    ],
    ["priority", quoteTextOrNull(template.priority, "template priority")],
    ["default_labels", quoteJson(template.default_labels ?? [])],
    ["body", quoteText(template.body, "template body")],
  ];
}

/** Run a `SELECT * FROM reef_templates [WHERE ...]` and return the raw rows. */
async function selectTemplateRows(
  adapter: AkbAdapter,
  vault: string,
  where?: string,
): Promise<Record<string, unknown>[]> {
  const sql = `SELECT * FROM ${tableRef(REEF_TEMPLATES_TABLE)}${
    where ? ` WHERE ${where}` : ""
  }`;
  const res = await runSql(adapter, vault, sql);
  return res.kind === "table_query" ? res.items : [];
}

export async function readTemplate(
  params: ReadTemplateParams,
): Promise<ReadTemplateResult> {
  const { adapter, vault, name } = params;
  return withSpan("akb.read_template", { vault, name }, async () => {
    let rows: Record<string, unknown>[];
    try {
      rows = await selectTemplateRows(
        adapter,
        vault,
        `name = ${quoteText(name, "template name")}`,
      );
    } catch (err) {
      // A does not-provisioned table reads as "no such template".
      if (isMissingTableError(err)) {
        throw new NotFoundError({ resource: `template ${name}` });
      }
      throw err;
    }
    const row = rows[0];
    if (!row) {
      throw new NotFoundError({ resource: `template ${name}` });
    }
    return { template: rowToTemplate(row) };
  });
}

/**
 * writeTemplate — upserts the template row keyed by `name`. A SELECT probe
 * routes the write through UPDATE when the row already exists (preserving the
 * akb-auto `created_at`) and INSERT otherwise. Last-write-wins, non-
 * transactional.
 *
 * Provisions `reef_templates` lazily via `ensureReefTables` (mirroring
 * `writeConfig`, NOT `writeIssue`): `listTemplates` treats a missing table as
 * an empty list, so the Settings "add a template" flow is a legitimate path
 * even on a vault that predates the table — the first write should create it
 * rather than 500.
 */
export async function writeTemplate(
  params: WriteTemplateParams,
): Promise<void> {
  const { adapter, vault, template } = params;
  return withSpan(
    "akb.write_template",
    { vault, name: template.name },
    async (span) => {
      await ensureReefTables({ adapter, vault });
      const nameLiteral = quoteText(template.name, "template name");
      const existing = await selectTemplateRows(
        adapter,
        vault,
        `name = ${nameLiteral}`,
      );
      const fields = templateRowMutableFields(template);
      if (existing.length > 0) {
        span.setAttribute("template_exists", true);
        await runSql(
          adapter,
          vault,
          `UPDATE ${tableRef(REEF_TEMPLATES_TABLE)} SET ${buildRowAssignments(
            fields,
          )} WHERE name = ${nameLiteral}`,
        );
        return;
      }
      span.setAttribute("template_exists", false);
      const columns = ["name", ...fields.map(([c]) => c)]
        .map(quoteIdent)
        .join(", ");
      const values = [nameLiteral, ...fields.map(([, v]) => v)].join(", ");
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(REEF_TEMPLATES_TABLE)} (${columns}) VALUES (${values})`,
      );
    },
  );
}

export async function deleteTemplate(
  params: DeleteTemplateParams,
): Promise<void> {
  const { adapter, vault, name } = params;
  await withSpan("akb.delete_template", { vault, name }, async () => {
    try {
      await runSql(
        adapter,
        vault,
        `DELETE FROM ${tableRef(REEF_TEMPLATES_TABLE)} WHERE name = ${quoteText(
          name,
          "template name",
        )}`,
      );
    } catch (err) {
      // Deleting from a does not-provisioned table is a no-op, not an error.
      if (isMissingTableError(err)) return;
      throw err;
    }
  });
}

export async function listTemplates(
  params: ListTemplatesParams,
): Promise<TemplateEntry[]> {
  const { adapter, vault } = params;
  return withSpan("akb.list_templates", { vault }, async (span) => {
    let rows: Record<string, unknown>[];
    try {
      rows = await selectTemplateRows(adapter, vault);
    } catch (err) {
      // First-run: the table may not exist yet → surface an empty list so
      // Settings can show the seed-defaults CTA without a 500.
      if (isMissingTableError(err)) {
        span.setAttribute("table_exists", false);
        return [];
      }
      throw err;
    }
    span.setAttribute("template_count", rows.length);
    return rows.map((row) => ({ template: rowToTemplate(row) }));
  });
}
