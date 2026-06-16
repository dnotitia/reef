import { z } from "zod";
import {
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
} from "./constants";
import type { AkbAdapter } from "./http";
import { withSpan } from "./tracing";

// ─── Tables: HTTP primitives ──────────────────────────────────────────────────
//
// akb exposes typed columns (text|number|boolean|date|json + required) via
// `POST /api/v1/tables/{vault}`. SQL escaping for the DML endpoint lives in
// `sql.ts`.

const AkbTableColumnTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "json",
]);

interface AkbTableColumn {
  name: string;
  type: z.infer<typeof AkbTableColumnTypeSchema>;
  required?: boolean;
}

interface AkbCreateTableRequest {
  name: string;
  description?: string;
  columns: AkbTableColumn[];
  collection?: string | null;
}

export interface EnsureReefTablesParams {
  adapter: AkbAdapter;
  vault: string;
}

async function listAkbTables(
  adapter: AkbAdapter,
  vault: string,
): Promise<string[]> {
  const payload = await adapter.request(
    `/api/v1/tables/${encodeURIComponent(vault)}`,
    { resource: `tables in vault ${vault}` },
  );
  // Defensive parser — akb returns `{ kind: "table", vault, items: [{name}, ...] }`
  // today, but we also accept `{ tables: [...] }` and a bare array so we don't
  // break if the wire shape evolves.
  const items = (() => {
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      if (Array.isArray(obj.items)) return obj.items;
      if (Array.isArray(obj.tables)) return obj.tables;
    }
    if (Array.isArray(payload)) return payload;
    return [];
  })();
  return items.flatMap((item) =>
    item && typeof item === "object" && "name" in item
      ? [String((item as { name: unknown }).name)]
      : [],
  );
}

async function createAkbTable(
  adapter: AkbAdapter,
  vault: string,
  body: AkbCreateTableRequest,
): Promise<void> {
  await adapter.request(`/api/v1/tables/${encodeURIComponent(vault)}`, {
    method: "POST",
    body,
    resource: `table ${body.name}`,
  });
}

/**
 * Create any reef tables that do not already exist. Idempotent (listTables
 * first) — safe to call repeatedly. Called eagerly from the `POST /api/vaults`
 * route handler at vault creation, and lazily from the write paths whose first
 * statement would otherwise hit a missing table (`writeConfig`,
 * `writeTemplate`).
 */
export async function ensureReefTables(
  params: EnsureReefTablesParams,
): Promise<void> {
  const { adapter, vault } = params;
  return withSpan("akb.tables.ensure", { vault }, async (span) => {
    const existing = new Set(await listAkbTables(adapter, vault));
    span.setAttribute("existing_table_count", existing.size);
    const creates: Promise<void>[] = [];
    if (!existing.has(REEF_SETTINGS_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: REEF_SETTINGS_TABLE,
          description: "reef key-value team-shared workspace settings",
          // akb auto-injects id/created_at/updated_at/created_by on every
          // dynamic table; declaring our own `updated_at` here would collide
          // with the reserved name and fail table creation.
          columns: [
            { name: "key", type: "text", required: true },
            { name: "value", type: "json", required: true },
          ],
        }),
      );
    }
    if (!existing.has(MONITORED_REPOS_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: MONITORED_REPOS_TABLE,
          description: "GitHub repos monitored by this reef workspace",
          columns: [
            { name: "github_id", type: "number", required: true },
            { name: "owner", type: "text", required: true },
            { name: "name", type: "text", required: true },
            { name: "description", type: "text" },
          ],
        }),
      );
    }
    if (!existing.has(REEF_ISSUES_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: REEF_ISSUES_TABLE,
          description: "Queryable read projection of reef issue documents",
          // akb auto-injects id/created_at/updated_at/created_by; we read the
          // auto created_at/updated_at as the issue's timestamps (row INSERT
          // happens at issue creation) and should not declare them here.
          // `meta` json carries the reef "semantic actor" fields (author/
          // last_editor) and `source` — distinct from akb's auth-principal
          // created_by — plus future extension fields, sidestepping the
          // no-ALTER-TABLE-over-HTTP limitation.
          columns: [
            { name: "document_uri", type: "text", required: true },
            { name: "reef_id", type: "text", required: true },
            { name: "title", type: "text", required: true },
            { name: "status", type: "text", required: true },
            { name: "issue_type", type: "text", required: true },
            { name: "priority", type: "text" },
            { name: "assigned_to", type: "text" },
            { name: "requester", type: "text" },
            { name: "reporter", type: "text" },
            { name: "start_date", type: "text" },
            { name: "due_date", type: "text" },
            { name: "milestone_id", type: "text" },
            { name: "sprint_id", type: "text" },
            { name: "release_id", type: "text" },
            { name: "estimate_points", type: "number" },
            { name: "severity", type: "text" },
            { name: "rank", type: "number" },
            { name: "closed_at", type: "text" },
            { name: "closed_reason", type: "text" },
            { name: "parent_id", type: "text" },
            { name: "labels", type: "json" },
            { name: "depends_on", type: "json" },
            { name: "related_to", type: "json" },
            { name: "blocks", type: "json" },
            { name: "archived_at", type: "text" },
            { name: "meta", type: "json" },
          ],
        }),
      );
    }
    if (!existing.has(REEF_SPRINTS_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: REEF_SPRINTS_TABLE,
          description: "Managed sprint metadata for reef issue planning",
          // akb auto-injects the uuid `id` primary key (and created_at/
          // created_by/updated_at); declaring our own `id` is rejected as a
          // reserved column. The row is addressed by that akb uuid.
          columns: [
            { name: "name", type: "text", required: true },
            { name: "status", type: "text", required: true },
            { name: "start_date", type: "text" },
            { name: "end_date", type: "text" },
            { name: "goal", type: "text" },
            { name: "capacity_points", type: "number" },
            { name: "meta", type: "json" },
          ],
        }),
      );
    }
    if (!existing.has(REEF_MILESTONES_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: REEF_MILESTONES_TABLE,
          description: "Managed milestone metadata for reef issue planning",
          // akb auto-injects the uuid `id` primary key; reef does not declares it.
          columns: [
            { name: "name", type: "text", required: true },
            { name: "status", type: "text", required: true },
            { name: "target_date", type: "text" },
            { name: "description", type: "text" },
            { name: "meta", type: "json" },
          ],
        }),
      );
    }
    if (!existing.has(REEF_RELEASES_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: REEF_RELEASES_TABLE,
          description: "Managed release metadata for reef issue planning",
          // akb auto-injects the uuid `id` primary key; reef does not declares it.
          columns: [
            { name: "name", type: "text", required: true },
            { name: "status", type: "text", required: true },
            { name: "target_date", type: "text" },
            { name: "released_at", type: "text" },
            { name: "notes", type: "text" },
            { name: "meta", type: "json" },
          ],
        }),
      );
    }
    if (!existing.has(REEF_TEMPLATES_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: REEF_TEMPLATES_TABLE,
          description: "Issue templates for this reef workspace",
          // akb auto-injects id/created_at/updated_at/created_by. `name` is the
          // logical key (the filename-stem id surfaced in the UI). `body` is a
          // plain text column — the template is self-contained, no backing
          // document. `meta` json holds future non-filtered extension fields,
          // sidestepping the no-ALTER-TABLE-over-HTTP limitation.
          columns: [
            { name: "name", type: "text", required: true },
            { name: "label", type: "text", required: true },
            { name: "description", type: "text" },
            { name: "title_prefix", type: "text" },
            { name: "priority", type: "text" },
            { name: "default_labels", type: "json" },
            { name: "body", type: "text" },
            { name: "meta", type: "json" },
          ],
        }),
      );
    }
    if (!existing.has(REEF_ACTIVITY_SUGGESTIONS_TABLE)) {
      creates.push(
        createAkbTable(adapter, vault, {
          name: REEF_ACTIVITY_SUGGESTIONS_TABLE,
          description:
            "Queryable read projection of reef AI activity inbox documents",
          columns: [
            { name: "document_uri", type: "text", required: true },
            { name: "suggestion_id", type: "text", required: true },
            { name: "kind", type: "text", required: true },
            { name: "status", type: "text", required: true },
            { name: "fingerprint", type: "text", required: true },
            { name: "repo", type: "text", required: true },
            { name: "issue_id", type: "text" },
            { name: "title", type: "text" },
            { name: "summary", type: "text" },
            { name: "source_type", type: "text" },
            { name: "source_ref", type: "text" },
            { name: "actor", type: "text" },
            { name: "detected_at", type: "text", required: true },
            { name: "reviewed_at", type: "text" },
            { name: "reviewed_by", type: "text" },
            { name: "meta", type: "json" },
          ],
        }),
      );
    }
    await Promise.all(creates);
    span.setAttribute("created_table_count", creates.length);
  });
}
