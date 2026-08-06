import { z } from "zod";
import { type AkbAdapter, withSpan } from "./shared";

/**
 * REST surface for akb knowledge-graph relation edges (REEF-088 exposed the
 * write half over HTTP). All three calls hit `/api/v1/relations`:
 *   - GET    read 1-hop edges (reader)        → `{ uri, relations: [...] }`
 *   - POST   create an edge (writer)          → body `{ source, target, relation }`
 *   - DELETE remove an edge (writer)          → query `source` / `target` / `relation?`
 *
 * These are generic over any resource pair; the issue-centric wrappers live in
 * `adapters/akb/issues/references.ts`. `adapter.request` already translates
 * akb HTTP errors (404 → NotFoundError, 403 → AuthError, 422 →
 * SchemaValidationError, …), so callers get reef errors without extra plumbing.
 */
const RELATIONS_PATH = "/api/v1/relations";

/**
 * One edge as serialized by akb's `get_resource_relations`. `name` is the
 * same-vault resolved title (omitted for cross-vault endpoints). `.passthrough()`
 * keeps any future akb field rather than stripping it at the boundary.
 */
export const AkbRelationEdgeSchema = z
  .object({
    direction: z.string().optional(),
    relation: z.string(),
    uri: z.string().min(1),
    resource_type: z.string().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough();

export type AkbRelationEdge = z.infer<typeof AkbRelationEdgeSchema>;

const RelationsResponseSchema = z.object({
  uri: z.string(),
  relations: z.array(AkbRelationEdgeSchema).default([]),
});

export type RelationDirection = "incoming" | "outgoing" | "both";

export async function getResourceRelations(
  adapter: AkbAdapter,
  params: { uri: string; relation?: string; direction?: RelationDirection },
): Promise<AkbRelationEdge[]> {
  return withSpan("akb.kg.get_relations", {}, async (span) => {
    const payload = await adapter.request(RELATIONS_PATH, {
      query: {
        uri: params.uri,
        type: params.relation,
        direction: params.direction,
      },
      resource: "relations",
    });
    const relations = RelationsResponseSchema.parse(payload).relations;
    span.setAttribute("relation_count", relations.length);
    return relations;
  });
}

export async function linkResources(
  adapter: AkbAdapter,
  params: { source: string; target: string; relation: string },
): Promise<void> {
  await withSpan("akb.kg.link", {}, async () => {
    await adapter.request(RELATIONS_PATH, {
      method: "POST",
      body: {
        source: params.source,
        target: params.target,
        relation: params.relation,
      },
      resource: "relation",
    });
  });
}

export async function unlinkResources(
  adapter: AkbAdapter,
  params: { source: string; target: string; relation?: string },
): Promise<void> {
  await withSpan("akb.kg.unlink", {}, async () => {
    // unlink takes its endpoints as query params, NOT a JSON body. Omitting
    // `relation` removes every edge between the two resources; reef consistently
    // pins it so a sibling edge type is does not collaterally deleted.
    await adapter.request(RELATIONS_PATH, {
      method: "DELETE",
      query: {
        source: params.source,
        target: params.target,
        relation: params.relation,
      },
      resource: "relation",
    });
  });
}
