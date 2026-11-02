import type { IssueRelationBackfillProblem } from "../../../schemas/issueRelationBackfill";
import { z } from "zod";
import {
  IssueRelationBackfillError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import { getAkbDocument } from "../core/documents";
import { parseAkbDocumentUri } from "../core/documentUri";
import {
  createAkbAdapter,
  type AkbAdapter,
  type AkbRequestPolicy,
} from "../core/http";
import { runSql } from "../core/sql";
import { resolveRelationUris } from "./relationUris";

const PAGE_SIZE = 200;
const VaultInfoSchema = z.object({
  status: z.string(),
  is_archived: z.boolean(),
  is_external_git: z.boolean(),
  managed_by: z.string().nullable(),
  role: z.string(),
});
const RowSchema = z.object({
  reef_id: z.string().min(1),
  document_uri: z.string().min(1),
  depends_on: z.union([z.string(), z.array(z.string()), z.null()]),
  related_to: z.union([z.string(), z.array(z.string()), z.null()]),
  blocks: z.union([z.string(), z.array(z.string()), z.null()]),
  updated_at: z.string().min(1),
});
type Row = z.infer<typeof RowSchema>;

function relationArray(value: Row["depends_on"]): string[] {
  return z
    .array(z.string())
    .parse(typeof value === "string" ? JSON.parse(value) : (value ?? []));
}

export async function readRows(
  adapter: AkbAdapter,
  vault: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor = "";
  for (;;) {
    const response = await runSql(
      adapter,
      vault,
      "SELECT reef_id, document_uri, depends_on, related_to, blocks, updated_at FROM reef_issues WHERE reef_id > $1 ORDER BY reef_id LIMIT $2",
      [cursor, PAGE_SIZE],
    );
    if (response.kind !== "table_query")
      throw new SchemaValidationError({ issues: ["Invalid issue inventory"] });
    const page = z.array(RowSchema).parse(response.items);
    for (const row of page) {
      if (row.reef_id <= cursor)
        throw new SchemaValidationError({
          issues: ["Duplicate or unordered issue inventory"],
        });
      cursor = row.reef_id;
      rows.push(row);
    }
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function sourceAndTargetsUnchanged(
  adapter: AkbAdapter,
  vault: string,
  source: Row,
  baseline: ReadonlyMap<string, string>,
): Promise<boolean> {
  const targetIds = [
    ...new Set([
      ...relationArray(source.depends_on),
      ...relationArray(source.blocks),
      ...relationArray(source.related_to),
    ]),
  ];
  const ids = [...new Set([source.reef_id, ...targetIds])];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  const result = await runSql(
    adapter,
    vault,
    `SELECT reef_id, document_uri, depends_on, related_to, blocks, updated_at FROM reef_issues WHERE reef_id IN (${placeholders})`,
    ids,
  );
  if (result.kind !== "table_query")
    throw new SchemaValidationError({ issues: ["Invalid issue inventory"] });
  const rows = z.array(RowSchema).parse(result.items);
  if (rows.length !== ids.length) return false;
  const byId = new Map(rows.map((row) => [row.reef_id, row]));
  if (
    byId.size !== ids.length ||
    JSON.stringify(byId.get(source.reef_id)) !== JSON.stringify(source)
  )
    return false;
  return targetIds.every(
    (id) => byId.get(id)?.document_uri === baseline.get(id),
  );
}

export function relations(
  vault: string,
  row: Row,
  targets: ReadonlyMap<string, string>,
) {
  return resolveRelationUris(
    vault,
    {
      depends_on: relationArray(row.depends_on),
      related_to: relationArray(row.related_to),
      blocks: relationArray(row.blocks),
    },
    targets,
  );
}

export async function inspectRows(
  adapter: AkbAdapter,
  vault: string,
): Promise<Row[]> {
  const rows = await readRows(adapter, vault);
  inspectRelationRows(vault, rows);
  for (const row of rows) {
    const document = await getAkbDocument({
      adapter,
      vault,
      uri: row.document_uri,
    }).catch((error: unknown) => {
      if (error instanceof NotFoundError)
        throw new IssueRelationBackfillError({
          vault,
          phase: "preflight",
          code: "document_missing",
          problems: [{ reef_id: row.reef_id, reason: "missing_document" }],
        });
      throw error;
    });
    if (!document.current_commit || document.uri !== row.document_uri) {
      throw new IssueRelationBackfillError({
        phase: "preflight",
        code: "document_missing",
        vault,
        problems: [
          { reef_id: row.reef_id, reason: "invalid_document_identity" },
        ],
      });
    }
  }
  return rows;
}

export async function checkVaultWriteAccess(
  adapter: AkbAdapter,
  vault: string,
  credential: string,
): Promise<void> {
  const info = VaultInfoSchema.parse(
    await adapter.request(`/api/v1/vaults/${encodeURIComponent(vault)}/info`, {
      resource: "vault",
    }),
  );
  if (
    info.status !== "active" ||
    info.is_archived ||
    info.is_external_git ||
    !["owner", "admin", "writer"].includes(info.role)
  ) {
    throw new SchemaValidationError({ issues: ["Vault is not writable"] });
  }
  const actor = z
    .object({
      auth_method: z.string(),
      is_admin: z.boolean(),
      key_class: z.enum(["pat", "service"]).nullable().optional(),
    })
    .parse(await adapter.request("/api/v1/auth/me", { resource: "account" }));
  if (!actor.is_admin || !["jwt", "pat", "oauth"].includes(actor.auth_method)) {
    throw new SchemaValidationError({
      issues: [
        "Cannot verify write authority for a managed vault with this credential",
      ],
    });
  }
  if (info.managed_by !== null && actor.auth_method === "pat") {
    const scopeSchema = z.object({
      prefixes: z.array(z.string()),
      extra_vaults: z.array(z.string()),
    });
    const tokenSchema = z.object({
      token_id: z.uuid(),
      prefix: z.string().length(12),
      scopes: z.array(z.string()),
      vault_scope: scopeSchema.nullable(),
      key_class: z.enum(["pat", "service"]),
    });
    const { tokens } = z.object({ tokens: z.array(tokenSchema) }).parse(
      await adapter.request("/api/v1/auth/tokens", {
        resource: "token metadata",
      }),
    );
    const matching = tokens.filter((token) =>
      credential.startsWith(token.prefix),
    );
    if (
      matching.length !== 1 ||
      !matching[0] ||
      matching[0].key_class !== actor.key_class
    )
      throw new SchemaValidationError({
        issues: ["Cannot verify current token authority"],
      });
    const token = matching[0];
    if (token.vault_scope !== null) {
      const verified = z
        .object({
          token_id: z.uuid(),
          vault_scope: scopeSchema,
          authorities: z.array(
            z.object({
              vault: z.string(),
              role: z.literal("writer"),
              action: z.literal("*"),
            }),
          ),
        })
        .parse(
          await adapter.request("/api/v1/auth/authority/verify", {
            method: "POST",
            body: {
              vault_scope: token.vault_scope,
              writer_authorities: [{ vault, action: "*" }],
            },
            resource: "authority",
          }),
        );
      if (
        verified.token_id !== token.token_id ||
        JSON.stringify(verified.vault_scope) !==
          JSON.stringify(token.vault_scope) ||
        verified.authorities.length !== 1 ||
        verified.authorities[0]?.vault !== vault
      )
        throw new SchemaValidationError({
          issues: ["Cannot verify current token authority"],
        });
    }
  }
}

export function inspectRelationRows(vault: string, rows: readonly Row[]) {
  const targets = new Map(rows.map((row) => [row.reef_id, row.document_uri]));
  const byUri = new Map(rows.map((row) => [row.document_uri, row.reef_id]));
  const seen = new Set<string>();
  const problems: IssueRelationBackfillProblem[] = [];
  for (const row of rows) {
    if (
      parseAkbDocumentUri(row.document_uri)?.vault !== vault ||
      seen.has(row.document_uri)
    )
      problems.push({
        reef_id: row.reef_id,
        reason: "invalid_document_identity",
      });
    seen.add(row.document_uri);
    for (const field of ["depends_on", "blocks", "related_to"] as const) {
      let refs: string[];
      try {
        refs = relationArray(row[field]);
      } catch {
        problems.push({
          reef_id: row.reef_id,
          field,
          reason: "malformed_array",
        });
        continue;
      }
      for (const [index, ref] of refs.entries()) {
        if (targets.has(ref)) continue;
        const uri = parseAkbDocumentUri(ref);
        const replacement = byUri.get(ref);
        problems.push({
          reef_id: row.reef_id,
          field,
          target_index: index,
          reason: replacement
            ? "document_uri_in_row"
            : uri && uri.vault !== vault
              ? "cross_vault_reference"
              : uri
                ? "unresolved_document_uri"
                : "missing_target",
          ...(replacement ? { replacement_reef_id: replacement } : {}),
        });
      }
    }
  }
  if (problems.length)
    throw new IssueRelationBackfillError({
      phase: "preflight",
      code: "invalid_relations",
      vault,
      problems,
    });
  return targets;
}

export const RELATION_READ_POLICY = {
  timeoutMs: 20_000,
  maxJsonResponseBytes: 8 * 1024 * 1024,
} satisfies AkbRequestPolicy;
export interface RelationBackfillParams {
  baseUrl: string;
  credential: string;
  vault: string;
  fetch?: typeof fetch;
  requestPolicy?: AkbRequestPolicy;
}
export function createRepairAdapter({
  baseUrl,
  credential,
  fetch,
  requestPolicy = RELATION_READ_POLICY,
}: RelationBackfillParams) {
  return createAkbAdapter({ baseUrl, credential, fetch, requestPolicy });
}
