import { vi } from "vitest";
import { z } from "zod";
import {
  makeDocumentResponse,
  makeSqlQueryResponse,
} from "../core/akb.testSupport";
import type { AkbRelationEdge } from "../core/relations";
import { parseAkbDocumentUri } from "../core/documentUri";
import type { readRows } from "./relationBackfillInventory";

type Row = Awaited<ReturnType<typeof readRows>>[number];
type Fields = { depends_on: string[]; related_to: string[] };
export function relationRow(
  reefId = "REEF-001",
  changes: Partial<Row> = {},
): Row {
  return {
    reef_id: reefId,
    document_uri: `akb://reef-sample/coll/issues/doc/${reefId.toLowerCase()}.md`,
    depends_on: [],
    blocks: [],
    related_to: [],
    updated_at: "2026-01-01T00:00:00Z",
    ...changes,
  };
}
export function relationServer(initial: Row[]) {
  const rows = new Map<string, Row>();
  const documents = new Map<
    string,
    { commit: string; fields: Fields; body: string }
  >();
  const graph = new Map<string, AkbRelationEdge[]>();
  const patches: {
    uri: string;
    expected_commit: string;
    depends_on: string[];
    related_to: string[];
  }[] = [];
  const requests: {
    method: string;
    path: string;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const failures = new Set<string>();
  const archived = new Set<string>();
  const controls: {
    autoProject: boolean;
    projectionDelay: number;
    onPatch?: () => void;
    beforePatch?: () => void;
    onRowsRead?: () => void;
    onGraphRead?: () => void;
  } = { autoProject: true, projectionDelay: 0 };
  function add(row: Row) {
    rows.set(row.reef_id, row);
    documents.set(row.document_uri, {
      commit: "initial",
      fields: { depends_on: [], related_to: [] },
      body: "untouched body",
    });
  }
  function project(uri: string) {
    const doc = documents.get(uri);
    if (!doc) return;
    const explicit = (graph.get(uri) ?? []).filter(
      (e) => e.kind === "explicit",
    );
    const edges: AkbRelationEdge[] = [...explicit];
    for (const relation of ["depends_on", "related_to"] as const)
      for (const target of doc.fields[relation]) {
        if (!explicit.some((e) => e.relation === relation && e.uri === target))
          edges.push({
            relation,
            uri: target,
            kind: "implicit",
            direction: "outgoing",
          });
      }
    graph.set(uri, edges);
  }
  for (const row of initial) add(row);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input)),
      method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname, signal: init?.signal });
    if (url.pathname.includes("/vaults/"))
      return Response.json({
        status: "active",
        is_archived: false,
        is_external_git: false,
        managed_by: null,
        role: "admin",
      });
    if (url.pathname.endsWith("/auth/me"))
      return Response.json({ auth_method: "jwt", is_admin: true });
    if (url.pathname.includes("/tables/")) {
      const query = z
        .object({ sql: z.string(), params: z.array(z.unknown()) })
        .parse(JSON.parse(String(init?.body)));
      controls.onRowsRead?.();
      let selected = [...rows.values()].sort((a, b) =>
        a.reef_id.localeCompare(b.reef_id),
      );
      if (query.sql.includes("archived_at IS NULL"))
        selected = selected.filter((row) => !archived.has(row.reef_id));
      if (query.sql.includes(" IN "))
        selected = selected.filter((row) => query.params.includes(row.reef_id));
      else {
        const cursor = query.params[0],
          limit = query.params[1];
        if (typeof cursor !== "string" || typeof limit !== "number")
          throw Error("Invalid inventory query");
        selected = selected
          .filter((row) => row.reef_id > cursor)
          .slice(0, limit);
      }
      return Response.json(
        makeSqlQueryResponse(selected, [
          "reef_id",
          "document_uri",
          "depends_on",
          "related_to",
          "blocks",
          "updated_at",
        ]),
      );
    }
    if (url.pathname.endsWith("/relations")) {
      controls.onGraphRead?.();
      const uri = url.searchParams.get("uri") ?? "",
        type = url.searchParams.get("type");
      return Response.json({
        uri,
        relations: (graph.get(uri) ?? []).filter(
          (e) => !type || e.relation === type,
        ),
      });
    }
    const row = [...rows.values()].find((r) => {
      const doc = parseAkbDocumentUri(r.document_uri);
      return (
        doc && url.pathname === `/api/v1/documents/${doc.vault}/${doc.path}`
      );
    });
    const uri = row?.document_uri,
      doc = uri ? documents.get(uri) : undefined;
    if (!uri || !doc)
      return Response.json({ detail: "missing" }, { status: 404 });
    if (method === "PATCH") {
      controls.beforePatch?.();
      if (failures.has(uri))
        return Response.json({ detail: "unavailable" }, { status: 503 });
      const fields = z
        .object({
          expected_commit: z.string(),
          depends_on: z.array(z.string()),
          related_to: z.array(z.string()),
          content: z.string().optional(),
        })
        .parse(JSON.parse(String(init?.body)));
      if (fields.expected_commit !== doc.commit)
        return Response.json({ detail: "moved" }, { status: 409 });
      patches.push({
        uri,
        expected_commit: fields.expected_commit,
        depends_on: fields.depends_on,
        related_to: fields.related_to,
      });
      if (fields.content !== undefined) doc.body = fields.content;
      doc.commit = `written-${patches.length}`;
      doc.fields = {
        depends_on: fields.depends_on,
        related_to: fields.related_to,
      };
      controls.onPatch?.();
      if (controls.autoProject) {
        if (controls.projectionDelay)
          setTimeout(() => project(uri), controls.projectionDelay);
        else project(uri);
      }
      return Response.json({
        uri,
        vault: "reef-sample",
        path: `issues/${row.reef_id.toLowerCase()}.md`,
        commit_hash: doc.commit,
      });
    }
    return Response.json({
      ...makeDocumentResponse(),
      uri,
      current_commit: doc.commit,
      content: doc.body,
    });
  });
  return {
    fetch,
    rows,
    documents,
    graph,
    patches,
    requests,
    failures,
    archived,
    controls,
    add,
    project,
  };
}
