import { z } from "zod";
import { ConflictError, SchemaValidationError } from "../../../errors";
import { getAkbDocument } from "../core/documents";
import { parseAkbDocumentUri } from "../core/documentUri";
import { createAkbAdapter, type AkbAdapter } from "../core/http";
import { getResourceRelations } from "../core/relations";
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

async function readRows(adapter: AkbAdapter, vault: string): Promise<Row[]> {
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

async function sourceAndTargetsUnchanged(
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

function relations(
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

async function inspectRows(adapter: AkbAdapter, vault: string): Promise<Row[]> {
  const rows = await readRows(adapter, vault);
  const targets = new Map<string, string>();
  const uris = new Set<string>();
  for (const row of rows) {
    if (
      parseAkbDocumentUri(row.document_uri)?.vault !== vault ||
      uris.has(row.document_uri)
    ) {
      throw new SchemaValidationError({
        issues: ["Invalid or duplicate issue document URI"],
      });
    }
    uris.add(row.document_uri);
    targets.set(row.reef_id, row.document_uri);
  }
  for (const row of rows) relations(vault, row, targets);
  for (const row of rows) {
    const document = await getAkbDocument({
      adapter,
      vault,
      uri: row.document_uri,
    });
    if (!document.current_commit || document.uri !== row.document_uri) {
      throw new SchemaValidationError({
        issues: [
          "Issue document has no current commit or does not match its URI",
        ],
      });
    }
  }
  return rows;
}

async function checkVaultWriteAccess(
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
      matching[0].key_class !== actor.key_class ||
      !matching[0].scopes.some(
        (scope) => scope === "write" || scope === "admin",
      )
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

interface RelationBackfillParams {
  baseUrl: string;
  credential: string;
  vault: string;
  fetch?: typeof fetch;
}

export async function preflightIssueRelationUris({
  baseUrl,
  credential,
  vault,
  fetch,
}: RelationBackfillParams): Promise<{ count: number }> {
  const adapter = createAkbAdapter({ baseUrl, credential, fetch });
  await checkVaultWriteAccess(adapter, vault, credential);
  const rows = await inspectRows(adapter, vault);
  return { count: rows.length };
}

export async function backfillIssueRelationUris({
  baseUrl,
  credential,
  vault,
  fetch,
}: RelationBackfillParams): Promise<{ count: number }> {
  const adapter = createAkbAdapter({ baseUrl, credential, fetch });
  await checkVaultWriteAccess(adapter, vault, credential);
  let rows: Row[] = [];
  let completed = false;
  for (let attempt = 0; attempt < 3 && !completed; attempt++) {
    const inspected = await inspectRows(adapter, vault);
    rows = await readRows(adapter, vault);
    if (JSON.stringify(inspected) !== JSON.stringify(rows)) continue;
    const snapshot = JSON.stringify(rows);
    const targets = new Map(
      rows.map((item) => [item.reef_id, item.document_uri]),
    );
    let changed = false;
    for (const row of rows) {
      if (!(await sourceAndTargetsUnchanged(adapter, vault, row, targets))) {
        changed = true;
        break;
      }
      const document = await getAkbDocument({
        adapter,
        vault,
        uri: row.document_uri,
      });
      if (!document.current_commit)
        throw new SchemaValidationError({
          issues: ["Issue document has no current commit"],
        });
      const parsed = parseAkbDocumentUri(row.document_uri);
      if (!parsed || parsed.vault !== vault)
        throw new SchemaValidationError({
          issues: ["Invalid issue document URI"],
        });
      try {
        await adapter.request(
          `/api/v1/documents/${encodeURIComponent(vault)}/${parsed.path}`,
          {
            method: "PATCH",
            body: {
              ...relations(vault, row, targets),
              expected_commit: document.current_commit,
              message: "Backfill issue relation URIs",
            },
            resource: "issue document",
          },
        );
      } catch (error) {
        if (error instanceof ConflictError) {
          changed = true;
          break;
        }
        throw error;
      }
      if (!(await sourceAndTargetsUnchanged(adapter, vault, row, targets))) {
        changed = true;
        break;
      }
    }
    if (changed) continue;
    const issueUris = new Set(targets.values());
    const deadline = Date.now() + 10_000;
    for (;;) {
      let matches = true;
      for (const row of rows) {
        const expected = relations(vault, row, targets);
        for (const type of ["depends_on", "related_to"] as const) {
          const edges = await getResourceRelations(adapter, {
            uri: row.document_uri,
            relation: type,
            direction: "outgoing",
          });
          const actual = new Set(
            edges
              .filter(
                (edge) => edge.kind !== "explicit" || issueUris.has(edge.uri),
              )
              .map((edge) => edge.uri),
          );
          const wanted = new Set(expected[type]);
          if (
            actual.size !== wanted.size ||
            [...wanted].some((uri) => !actual.has(uri))
          )
            matches = false;
        }
      }
      if (JSON.stringify(await readRows(adapter, vault)) !== snapshot) break;
      if (matches) {
        completed = true;
        break;
      }
      if (Date.now() >= deadline)
        throw new SchemaValidationError({
          issues: ["Issue relation graph verification timed out"],
        });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!completed) throw new ConflictError({ path: "issue relation backfill" });
  return { count: rows.length };
}
