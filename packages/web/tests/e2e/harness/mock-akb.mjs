import {
  AUTH_PROBE_HANG_MAX_MS,
  fixtureLogin,
  NOW,
  rawVault,
  REEF_VAULT,
} from "./mock-fixtures.mjs";
import {
  headerQuoted,
  json,
  readJson,
  readRawBody,
  sleep,
} from "./mock-http.mjs";
import { handleSql, matchSqlString, resolveSqlParams } from "./mock-sql.mjs";
import { issueUpdateKey, nextCommit, vaultSummary } from "./mock-state.mjs";
import { docUri, slugify } from "./mock-utils.mjs";

export async function handleAkb(req, res, url, state) {
  const path = url.pathname.slice("/akb".length);
  const vaultFor = (name) => getVault(name, res, state);

  if (path === "/api/v1/auth/config" && req.method === "GET") {
    return json(res, 200, {
      local_auth: { enabled: state.localAuthEnabled },
      keycloak: state.keycloakEnabled
        ? {
            enabled: true,
            login_url: "/api/v1/auth/keycloak/login",
            sso_only: state.ssoOnly,
          }
        : { enabled: false, login_url: null, sso_only: false },
    });
  }

  if (path === "/api/v1/auth/login" && req.method === "POST") {
    if (state.accountDenialCode) {
      return accountDenialResponse(res, state.accountDenialCode);
    }
    const body = await readJson(req);
    const user = state.users.get(String(body?.username ?? ""));
    if (!user || user.password !== body?.password) {
      return json(res, 401, { error: "invalid_credentials" });
    }
    return json(res, 200, {
      token: state.loginToken,
      user: publicUser(user),
    });
  }

  const username = requireAkbAuth(req, res, state);
  if (!username) return;
  if (state.accountDenialCode) {
    return accountDenialResponse(res, state.accountDenialCode);
  }
  const user = state.users.get(username);

  if (path === "/api/v1/auth/me" && req.method === "GET") {
    if (!(await waitForAuthProbe(req, state))) return;
    return json(res, 200, {
      id: user.id,
      user_id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      is_admin: user.is_admin,
    });
  }

  if (path === "/api/v1/users/search" && req.method === "GET") {
    if (state.protectedResponse === "unauthorized") {
      return json(res, 401, { error: "e2e forced protected 401" });
    }
    if (state.protectedResponse === "forbidden") {
      return json(res, 403, { error: "e2e forced resource 403" });
    }
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const parsedLimit = Number.parseInt(
      url.searchParams.get("limit") ?? "20",
      10,
    );
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;
    const users = [...state.users.values()]
      .filter((candidate) => {
        if (!query) return true;
        return [
          candidate.username,
          candidate.display_name,
          candidate.email,
        ].some((value) => value?.toLowerCase().includes(query));
      })
      .toSorted((left, right) => left.username.localeCompare(right.username))
      .slice(0, limit)
      .map(publicUser);
    return json(res, 200, { users });
  }

  if (path === "/api/v1/my/vaults" && req.method === "GET") {
    if (state.vaultListDelayMs > 0) await sleep(state.vaultListDelayMs);
    if (state.vaultListFailures > 0) {
      state.vaultListFailures -= 1;
      return json(res, 500, { error: "e2e forced vault list failure" });
    }
    return json(res, 200, {
      vaults: [...state.vaults.values()].map((vault) =>
        vaultSummary(vault, state),
      ),
    });
  }

  if (path === "/api/v1/vaults" && req.method === "POST") {
    const name = url.searchParams.get("name");
    if (!name) return json(res, 422, { error: "missing vault name" });
    if (!state.vaults.has(name)) {
      state.vaults.set(name, rawVault(name));
    }
    return json(res, 200, {
      vault_id: `vault-${name}`,
      name,
      template: null,
      public_access: "none",
    });
  }

  const vaultDeleteMatch = path.match(/^\/api\/v1\/vaults\/([^/]+)$/);
  if (vaultDeleteMatch && req.method === "DELETE") {
    // Full vault delete (REEF-322): drop the whole entry, as akb cascades
    // documents, tables, files, and git. Idempotent — a missing vault is a no-op
    // 200, mirroring a teardown re-run.
    state.vaults.delete(decodeURIComponent(vaultDeleteMatch[1]));
    return json(res, 200, { deleted: true });
  }

  const membersMatch = path.match(/^\/api\/v1\/vaults\/([^/]+)\/members$/);
  if (membersMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(membersMatch[1]));
    if (!vault) return;
    return json(res, 200, { members: vault.members });
  }

  const fileUploadMatch = path.match(/^\/api\/v1\/files\/([^/]+)\/upload$/);
  if (fileUploadMatch && req.method === "POST") {
    const vault = vaultFor(decodeURIComponent(fileUploadMatch[1]));
    if (!vault) return;
    if (!vault.files) vault.files = new Map();
    const fileId = `file-${vault.files.size + 1}`;
    const collection = String(url.searchParams.get("collection") ?? "files")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const filename = url.searchParams.get("filename") || "attachment";
    const mimeType =
      url.searchParams.get("mime_type") || "application/octet-stream";
    const contentHash = url.searchParams.get("content_hash");
    if (!contentHash) {
      return json(res, 422, { error: "missing content hash" });
    }
    const uri = `akb://${vault.name}/${collection}/file/${fileId}`;
    vault.files.set(fileId, {
      id: fileId,
      uri,
      filename,
      mimeType,
      sizeBytes: 0,
      body: null,
      contentHash,
      confirmed: false,
    });
    return json(res, 200, {
      uri,
      upload_url: `http://${req.headers.host}/__e2e/files/${encodeURIComponent(
        vault.name,
      )}/${encodeURIComponent(fileId)}/upload`,
    });
  }

  const fileConfirmMatch = path.match(
    /^\/api\/v1\/files\/([^/]+)\/([^/]+)\/confirm$/,
  );
  if (fileConfirmMatch && req.method === "POST") {
    const vault = vaultFor(decodeURIComponent(fileConfirmMatch[1]));
    if (!vault) return;
    const file = vault.files?.get(decodeURIComponent(fileConfirmMatch[2]));
    if (!file) return json(res, 404, { error: "file not found" });
    if (!file.body) return json(res, 409, { error: "file not uploaded" });
    if (url.searchParams.get("content_hash") !== file.contentHash) {
      return json(res, 422, { error: "content hash mismatch" });
    }
    file.confirmed = true;
    return json(res, 200, {
      uri: file.uri,
      name: file.filename,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
    });
  }

  const fileDownloadMatch = path.match(
    /^\/api\/v1\/files\/([^/]+)\/([^/]+)\/download$/,
  );
  if (fileDownloadMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(fileDownloadMatch[1]));
    if (!vault) return;
    const file = vault.files?.get(decodeURIComponent(fileDownloadMatch[2]));
    if (!file) return json(res, 404, { error: "file not found" });
    if (!file.confirmed || !file.body) {
      return json(res, 409, { error: "file not confirmed" });
    }
    return json(res, 200, {
      name: file.filename,
      download_url: `http://${req.headers.host}/__e2e/files/${encodeURIComponent(
        vault.name,
      )}/${encodeURIComponent(file.id)}/download`,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
    });
  }

  const fileMatch = path.match(/^\/api\/v1\/files\/([^/]+)\/([^/]+)$/);
  if (fileMatch && req.method === "DELETE") {
    const vault = vaultFor(decodeURIComponent(fileMatch[1]));
    if (!vault) return;
    vault.files?.delete(decodeURIComponent(fileMatch[2]));
    return json(res, 200, { deleted: true });
  }
  if (fileMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(fileMatch[1]));
    if (!vault) return;
    const file = vault.files?.get(decodeURIComponent(fileMatch[2]));
    if (!file) return json(res, 404, { error: "file not found" });
    res.writeHead(200, {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.body.length),
      "Content-Disposition": `inline; filename="${headerQuoted(file.filename)}"`,
      "Cache-Control": "no-store",
    });
    return res.end(file.body);
  }

  const tablesMatch = path.match(/^\/api\/v1\/tables\/([^/]+)$/);
  if (tablesMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(tablesMatch[1]));
    if (!vault) return;
    return json(res, 200, {
      kind: "table",
      vault: vault.name,
      items: [...vault.tables].map((name) => ({ name })),
    });
  }
  if (tablesMatch && req.method === "POST") {
    const vault = vaultFor(decodeURIComponent(tablesMatch[1]));
    if (!vault) return;
    const body = await readJson(req);
    if (typeof body?.name === "string") vault.tables.add(body.name);
    return json(res, 200, { ok: true });
  }

  const tableDeleteMatch = path.match(/^\/api\/v1\/tables\/([^/]+)\/([^/]+)$/);
  if (tableDeleteMatch && req.method === "DELETE") {
    // Drop a single table (REEF-322 detach). The `/sql` sub-route is POST, so it
    // never collides with this DELETE. Idempotent on a missing table.
    const vault = vaultFor(decodeURIComponent(tableDeleteMatch[1]));
    if (!vault) return;
    vault.tables.delete(decodeURIComponent(tableDeleteMatch[2]));
    return json(res, 200, { deleted: true });
  }

  const sqlMatch = path.match(/^\/api\/v1\/tables\/([^/]+)\/sql$/);
  if (sqlMatch && req.method === "POST") {
    const vault = vaultFor(decodeURIComponent(sqlMatch[1]));
    if (!vault) return;
    const body = await readJson(req);
    const sql = resolveSqlParams(
      String(body?.sql ?? ""),
      Array.isArray(body?.params) ? body.params : undefined,
    );
    const issueId =
      /^\s*update\s+reef_issues\b/i.test(sql) &&
      matchSqlString(sql, /where "?reef_id"?\s*=\s*'([^']+)'/i);
    const isReorder = /^\s*with updated as \(update reef_issues\b/i.test(sql);
    const delayMs = issueId
      ? (state.issueUpdateDelays.get(issueUpdateKey(vault.name, issueId)) ?? 0)
      : isReorder
        ? state.issueReorderDelayMs
        : 0;
    if (delayMs > 0) await sleep(delayMs);
    if (isReorder && state.issueReorderFailures > 0) {
      state.issueReorderFailures -= 1;
      return json(res, 200, { error: "e2e forced issue reorder failure" });
    }
    const result = handleSql(state, vault, sql);
    if (result.kind === "sql_error") {
      return json(res, result.status, result.body);
    }
    return json(res, 200, result);
  }

  if (path === "/api/v1/documents" && req.method === "POST") {
    const body = await readJson(req);
    const vault = vaultFor(String(body?.vault ?? ""));
    if (!vault) return;
    const stored = putDocument(state, vault, body);
    return json(res, 200, documentPutResponse(vault, stored));
  }

  const historyMatch = path.match(/^\/api\/v1\/history\/([^/]+)\/(.+)$/);
  if (historyMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(historyMatch[1]));
    if (!vault) return;
    const docPath = decodeURIComponent(historyMatch[2]);
    const parsedLimit = Number.parseInt(
      url.searchParams.get("limit") ?? "100",
      10,
    );
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 100;
    return json(res, 200, {
      kind: "document_history",
      uri: docUri(vault.name, docPath),
      history: (vault.documentHistory?.get(docPath) ?? []).slice(0, limit),
    });
  }

  const docMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/(.+)$/);
  if (docMatch) {
    const vault = vaultFor(decodeURIComponent(docMatch[1]));
    if (!vault) return;
    const docPath = decodeURIComponent(docMatch[2]);
    const existing = vault.documents.get(docPath);
    if (req.method === "GET") {
      if (!existing) return json(res, 404, { error: "document not found" });
      return json(res, 200, documentResponse(vault, existing));
    }
    if (req.method === "PATCH") {
      if (!existing) return json(res, 404, { error: "document not found" });
      const body = await readJson(req);
      Object.assign(existing, {
        title: stringOr(existing.title, body.title),
        type: stringOr(existing.type, body.type),
        content: stringOr(existing.content, body.content),
        summary: body.summary ?? existing.summary,
        tags: Array.isArray(body.tags) ? body.tags : existing.tags,
        updated_at: NOW,
        current_commit: nextCommit(state),
      });
      return json(res, 200, documentPutResponse(vault, existing));
    }
    if (req.method === "DELETE") {
      vault.documents.delete(docPath);
      return json(res, 200, { ok: true });
    }
  }

  const collectionDeleteMatch = path.match(
    /^\/api\/v1\/collections\/([^/]+)\/(.+)$/,
  );
  if (collectionDeleteMatch && req.method === "DELETE") {
    // Recursive collection delete (REEF-322 detach): remove every document under
    // the collection path. reef always passes recursive=true, so the fixture
    // always cascades. Idempotent — deleting an empty prefix is a no-op 200.
    const vault = vaultFor(decodeURIComponent(collectionDeleteMatch[1]));
    if (!vault) return;
    const prefix = `${decodeURIComponent(collectionDeleteMatch[2])}/`;
    for (const docPath of [...vault.documents.keys()]) {
      if (docPath.startsWith(prefix)) vault.documents.delete(docPath);
    }
    return json(res, 200, { deleted: true });
  }

  if (path === "/api/v1/relations" && req.method === "GET") {
    const relUri = url.searchParams.get("uri") ?? "";
    // REEF-368: give REEF-001 one outgoing `references` edge to an akb document
    // so the linked-document backlink spec has a DocumentRefCard to render and
    // can assert the open-link href built from the server-read AKB_WEB_URL.
    const relations =
      url.searchParams.get("type") === "references" &&
      relUri.endsWith("/doc/reef-001.md")
        ? [
            {
              relation: "references",
              direction: "outgoing",
              uri: "akb://reef-e2e/coll/docs/doc/spec-overview.md",
              resource_type: "doc",
              name: "Spec overview",
            },
          ]
        : [];
    return json(res, 200, { uri: relUri, relations });
  }

  if (path === "/api/v1/search" && req.method === "GET") {
    const vault = vaultFor(url.searchParams.get("vault") ?? REEF_VAULT);
    if (!vault) return;
    const isIssueContentSearch =
      url.searchParams.get("collection") === "issues" &&
      url.searchParams.get("type") === "task";
    if (isIssueContentSearch && state.contentSearchDelayMs > 0) {
      await sleep(state.contentSearchDelayMs);
    } else if (isToolLoopSearch(url)) {
      await sleep(350);
    }
    if (isIssueContentSearch && state.contentSearchMode === "error") {
      return json(res, 503, { detail: "e2e forced hybrid search failure" });
    }
    const search = searchVaultDocuments(vault, url);
    return json(res, 200, {
      kind: "search",
      returned: search.results.length,
      total_matches: search.totalMatches,
      truncated: search.totalMatches > search.results.length,
      degraded: isIssueContentSearch && state.contentSearchMode === "degraded",
      degradation_reason:
        isIssueContentSearch && state.contentSearchMode === "degraded"
          ? "e2e_forced"
          : null,
      results: search.results,
    });
  }

  return json(res, 404, { error: `unhandled akb mock route: ${path}` });
}

function accountDenialResponse(res, code) {
  const status = code === "identity_conflict" ? 409 : 403;
  const message =
    code === "membership_required"
      ? "Workspace membership is required."
      : code === "account_suspended"
        ? "The account is suspended."
        : "The identity conflicts with this workspace account.";
  return json(res, status, { detail: { code, message } });
}

async function waitForAuthProbe(req, state) {
  const delayMs = state.authProbeDelayMs;
  if (state.authProbeDelayOnce) {
    state.authProbeDelayMs = 0;
    state.authProbeDelayOnce = false;
  }
  if (delayMs > 0) {
    await sleep(delayMs);
    if (req.aborted || req.destroyed) return false;
  }
  if (!state.authProbeHang) return true;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, AUTH_PROBE_HANG_MAX_MS);
    req.once("aborted", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return !req.aborted && !req.destroyed;
}

function putDocument(state, vault, body) {
  const collection = String(body.collection ?? "documents");
  const slug = String(body.slug ?? slugify(String(body.title ?? "document")));
  const path = `${collection}/${slug}.md`;
  const stored = {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title: String(body.title ?? slug),
    type: String(body.type ?? "document"),
    status: String(body.status ?? "active"),
    summary: body.summary ?? null,
    content: String(body.content ?? ""),
    tags: Array.isArray(body.tags) ? body.tags : [],
    created_at: NOW,
    updated_at: NOW,
    current_commit: nextCommit(state),
  };
  vault.documents.set(path, stored);
  return stored;
}

function searchVaultDocuments(vault, url) {
  const collection = url.searchParams.get("collection");
  const type = url.searchParams.get("type");
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 10));

  const matches = [...vault.documents.values()]
    .filter((doc) => {
      if (collection && !doc.path.startsWith(`${collection}/`)) return false;
      if (type && doc.type !== type) return false;
      return true;
    })
    .map((doc) => ({
      doc,
      score: searchScore(doc, query),
    }))
    .filter(({ score }) => query.length === 0 || score > 0)
    .sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path));
  return {
    totalMatches: matches.length,
    results: matches.slice(0, limit).map(({ doc, score }) => ({
      uri: doc.uri,
      vault: vault.name,
      title: doc.title ?? null,
      summary: doc.summary ?? null,
      score,
      matched_section: doc.content?.slice(0, 320) ?? doc.summary ?? null,
      source_type: "document",
      collection: doc.path.split("/").at(0) ?? null,
      doc_type: doc.type ?? null,
      tags: doc.tags ?? [],
    })),
  };
}

function isToolLoopSearch(url) {
  const query = (url.searchParams.get("q") ?? "").toLowerCase();
  return (
    query.includes("initial issue alpha") || query.includes("spec overview")
  );
}

function searchScore(doc, query) {
  if (!query) return 1;
  const haystack = [
    doc.path,
    doc.title,
    doc.summary,
    doc.content,
    ...(doc.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(query)) return 1;
  const terms = query.split(/\s+/).filter(Boolean);
  return terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 / terms.length : 0),
    0,
  );
}

function documentPutResponse(vault, doc) {
  return {
    uri: doc.uri,
    vault: vault.name,
    path: doc.path,
    commit_hash: doc.current_commit,
    chunks_indexed: 0,
    entities_found: 0,
  };
}

function documentResponse(vault, doc) {
  return {
    uri: doc.uri,
    vault: vault.name,
    path: doc.path,
    title: doc.title,
    type: doc.type,
    status: doc.status,
    summary: doc.summary,
    created_by: "alice",
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    current_commit: doc.current_commit,
    tags: doc.tags,
    content: doc.content,
    is_public: false,
    public_slug: null,
  };
}

export function getVault(name, res, state) {
  const vault = state.vaults.get(name);
  if (!vault) {
    json(res, 404, { error: "vault not found" });
    return null;
  }
  return vault;
}

function requireAkbAuth(req, res, state) {
  const raw = req.headers.authorization ?? "";
  const token = String(raw).replace(/^Bearer\s+/i, "");
  const username = state.sessions.get(token);
  if (!username) {
    json(res, 401, { error: "invalid session" });
    return null;
  }
  return username;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    display_name: user.display_name,
    is_admin: user.is_admin,
  };
}

function stringOr(current, next) {
  return typeof next === "string" ? next : current;
}
