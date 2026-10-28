import { NotFoundError, SchemaValidationError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { parseAkbDocumentUri } from "../core/documentUri";
import type { AkbAdapter } from "../core/http";
import { SqlParameterBuilder } from "../core/sql";
import { selectIssueRows } from "./issueRows";

export type IssueRelationUris = { depends_on: string[]; related_to: string[] };

export function resolveRelationUris(
  vault: string,
  issue: Pick<IssueMetadata, "depends_on" | "blocks" | "related_to">,
  targets: ReadonlyMap<string, string>,
): IssueRelationUris {
  const resolve = (id: string) => {
    const uri = targets.get(id);
    if (!uri) throw new NotFoundError({ resource: `issue ${id}` });
    if (parseAkbDocumentUri(uri)?.vault !== vault) {
      throw new SchemaValidationError({
        issues: [`Invalid document URI for ${id}`],
      });
    }
    return uri;
  };
  return {
    depends_on: [...new Set((issue.depends_on ?? []).map(resolve))],
    related_to: [
      ...new Set(
        [...(issue.blocks ?? []), ...(issue.related_to ?? [])].map(resolve),
      ),
    ],
  };
}

export async function readRelationUris(
  adapter: AkbAdapter,
  vault: string,
  issue: Pick<IssueMetadata, "depends_on" | "blocks" | "related_to">,
): Promise<IssueRelationUris> {
  const ids = [
    ...new Set([
      ...(issue.depends_on ?? []),
      ...(issue.blocks ?? []),
      ...(issue.related_to ?? []),
    ]),
  ];
  if (!ids.length) return { depends_on: [], related_to: [] };
  const params = new SqlParameterBuilder();
  const placeholders = ids.map((id) => params.add(id, "reef_id"));
  const rows = await selectIssueRows(
    adapter,
    vault,
    `reef_id IN (${placeholders.join(", ")})`,
    undefined,
    undefined,
    params,
  );
  const targets = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.reef_id === "string" && typeof row.document_uri === "string")
      targets.set(row.reef_id, row.document_uri);
  }
  return resolveRelationUris(vault, issue, targets);
}
