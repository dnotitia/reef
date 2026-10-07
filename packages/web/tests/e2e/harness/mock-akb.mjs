import {
  AUTH_PROBE_HANG_MAX_MS,
  fixtureLogin,
  NOW,
  rawVault,
  REEF_VAULT,
} from "./mock-fixtures.mjs";
import {
  E2E_REEF_APP_ID,
  E2E_REEF_RELEASE_VERSION,
} from "./mock-installation.mjs";
import {
  headerQuoted,
  json,
  readJson,
  readRawBody,
  sleep,
} from "./mock-http.mjs";
import {
  handleMyWorkSql,
  handleSql,
  isIssueListQuery,
  matchSqlString,
  resolveSqlParams,
} from "./mock-sql.mjs";
import {
  attachmentReadKey,
  beginMarkdownLinkSearchRequest,
  beginAttachmentReadRequest,
  beginAuthProbeHold,
  endAuthProbeHold,
  endAttachmentReadRequest,
  endMarkdownLinkSearchRequest,
  beginIssueReadRequest,
  endIssueReadRequest,
  beginIssueUpdateRequest,
  beginIssueListRequest,
  consumeIssueUpdateHold,
  endIssueListRequest,
  endIssueUpdateRequest,
  issueUpdateKey,
  installationLookupMode,
  markdownLinkSearchKey,
  nextCommit,
  rememberSqlCall,
  roleForVault,
  vaultSummary,
  waitForAuthProbeRelease,
  waitForIssueUpdateRelease,
} from "./mock-state.mjs";
import { docUri, makeJwt, slugify, uuidFor } from "./mock-utils.mjs";
import { REEF_DESIRED_TABLES } from "@reef/core";

const REEF_INSTALLATION_TABLES = REEF_DESIRED_TABLES.map(({ name }) => name);
const REEF_INSTALLATION_TABLE_METADATA = REEF_DESIRED_TABLES.map((table) => ({
  name: table.name,
  columns: table.columns.map(({ name, type, required }) => ({
    name,
    type,
    required: required === true,
  })),
  unique_keys: (table.unique_keys ?? []).map(({ columns }) => ({ columns })),
  indexes: (table.indexes ?? []).map(({ columns }) => ({
    columns: columns.map((column) =>
      typeof column === "string"
        ? column
        : { name: column.name, order: column.order ?? "asc" },
    ),
  })),
}));

function installationWire(vault) {
  const installation = vault.installation;
  if (!installation) return null;
  return {
    installation_id: installation.id,
    app_id: installation.appId,
    vault_id: vault.id,
    lifecycle: installation.lifecycle,
    current_release: installation.currentReleaseId
      ? {
          id: installation.currentReleaseId,
          version: installation.currentReleaseVersion,
        }
      : null,
    blocked_reason: installation.blockedReason ?? null,
    desired_release: installation.desiredReleaseId
      ? {
          id: installation.desiredReleaseId,
          version: installation.desiredReleaseVersion,
        }
      : undefined,
    desired_grant_generation: installation.desiredGrantGeneration,
    latest_grant: installation.latestGrant,
    active_grant: installation.activeGrant,
    observed: installation.observed
      ? {
          generation: installation.observed.generation,
          observed_at: installation.observed.observedAt,
          release: {
            id: installation.observed.releaseId,
            version: installation.observed.releaseVersion,
          },
          schema_fingerprint: installation.observed.schemaFingerprint,
          grant_generation: installation.observed.grantGeneration,
        }
      : null,
    drift: installation.drift,
    drift_classification: installation.driftClassification,
  };
}

function hasRetainedResources(vault) {
  return (
    vault.tables.size > 0 ||
    vault.settings.size > 0 ||
    vault.documents.size > 0 ||
    (vault.files?.size ?? 0) > 0 ||
    (vault.assets?.size ?? 0) > 0
  );
}

export async function handleAkb(req, res, url, state) {
  const path = url.pathname.slice("/akb".length);
  const vaultFor = (name) => getVault(name, res, state);

  if (path === "/api/v1/auth/config" && req.method === "GET") {
    return json(res, 200, {
      schema_version: 2,
      auth_mode: "local",
      local_auth: { enabled: true },
      keycloak: { enabled: false, browser_session_ready: false },
      providers: [],
      mcp_oauth: { enabled: false },
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
    const token =
      user.username === fixtureLogin.username
        ? state.loginToken
        : makeJwt({ sub: user.id, username: user.username });
    state.sessions.set(token, user.username);
    return json(res, 200, {
      token,
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
    if (state.authProbeFailureStatus !== null) {
      return json(res, state.authProbeFailureStatus, {
        error: "e2e temporary auth probe failure",
      });
    }
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
        vaultSummary(vault, state, username),
      ),
    });
  }

  const installationMatch = path.match(
    /^\/api\/v1\/apps\/([^/]+)\/installations\/([^/]+)(\/active)?$/,
  );
  if (installationMatch) {
    const appId = decodeURIComponent(installationMatch[1]);
    const vaultId = decodeURIComponent(installationMatch[2]);
    const vault = [...state.vaults.values()].find(
      (candidate) => candidate.id === vaultId,
    );

    if (installationMatch[3] === "/active" && req.method === "GET") {
      const memberRole = vault ? roleForVault(vault, state, username) : null;
      if (!["owner", "admin", "writer", "reader"].includes(memberRole)) {
        return json(res, 403, { error: "vault membership required" });
      }
      if (state.scenario === "installation_drift") {
        const lookupMode = installationLookupMode(
          state,
          vault.name,
          "member_lookup",
        );
        if (lookupMode === "forbidden") {
          return json(res, 403, { error: "installation availability denied" });
        }
        if (lookupMode === "unavailable") {
          return json(res, 503, {
            error: "installation availability unavailable",
          });
        }
        if (lookupMode === "invalid") {
          return json(res, 200, { active: "unknown" });
        }
      }
      const active =
        appId === E2E_REEF_APP_ID &&
        vault.installation?.appId === appId &&
        vault.installation.lifecycle === "active";
      return json(res, 200, { active });
    }

    if (!vault) return json(res, 404, { error: "vault not found" });

    if (
      appId !== E2E_REEF_APP_ID ||
      (vault.installation && vault.installation.appId !== appId)
    ) {
      return json(res, 404, { error: "installation not found" });
    }
    if (
      roleForVault(vault, state, username) !== "owner" &&
      roleForVault(vault, state, username) !== "admin"
    ) {
      return json(res, 403, { error: "installation management required" });
    }
    if (state.scenario === "installation_drift") {
      const lookupMode = installationLookupMode(
        state,
        vault.name,
        "detail_lookup",
      );
      if (lookupMode === "forbidden") {
        return json(res, 403, { error: "installation detail denied" });
      }
      if (lookupMode === "unavailable") {
        return json(res, 503, { error: "installation detail unavailable" });
      }
      if (lookupMode === "invalid") {
        return json(res, 200, {
          ...installationWire(vault),
          lifecycle: "pending",
        });
      }
    }
    if (installationMatch[3] || req.method === "GET") {
      if (req.method !== "GET")
        return json(res, 405, { error: "method not allowed" });
      if (!vault.installation)
        return json(res, 404, { error: "installation not found" });
      return json(res, 200, installationWire(vault));
    }
    if (req.method === "PUT") {
      const body = await readJson(req);
      const mode = body?.mode;
      const releaseId = String(body?.release_id ?? "");
      if (
        !["install", "restore", "fresh"].includes(mode) ||
        !Array.isArray(body?.capabilities) ||
        body.capabilities.length !== 1 ||
        body.capabilities[0] !== "installation:read"
      ) {
        return json(res, 422, { error: "invalid installation command" });
      }
      if (mode === "restore") {
        if (vault.installation?.lifecycle !== "uninstalled") {
          return json(res, 409, { error: "installation cannot be restored" });
        }
        if (!vault.installation.currentReleaseId) {
          return json(res, 409, { error: "retained release unavailable" });
        }
      }
      if (
        mode === "fresh" &&
        vault.installation?.lifecycle === "uninstalled" &&
        hasRetainedResources(vault)
      ) {
        return json(res, 409, { error: "vault contains retained resources" });
      }
      const replayed =
        (mode === "install" || mode === "fresh") &&
        vault.installation?.lifecycle === "active" &&
        vault.installation.currentReleaseId === releaseId;
      const currentReleaseId =
        mode === "restore" ? vault.installation.currentReleaseId : releaseId;
      if (!vault.installation) {
        vault.installation = {
          id: uuidFor(20000 + state.commitSeq),
          appId,
          currentReleaseId,
          currentReleaseVersion: E2E_REEF_RELEASE_VERSION,
          lifecycle: "active",
        };
      } else {
        vault.installation = {
          ...vault.installation,
          appId,
          lifecycle: "active",
          currentReleaseId,
          currentReleaseVersion: E2E_REEF_RELEASE_VERSION,
        };
      }
      for (const table of REEF_INSTALLATION_TABLES) vault.tables.add(table);
      return json(res, 200, {
        ...installationWire(vault),
        command_status: replayed ? "already_applied" : "accepted",
        replayed,
      });
    }
    if (req.method === "DELETE") {
      if (!vault.installation) {
        return json(res, 404, { error: "installation not found" });
      }
      const replayed = vault.installation.lifecycle === "uninstalled";
      vault.installation = { ...vault.installation, lifecycle: "uninstalled" };
      return json(res, 200, {
        ...installationWire(vault),
        command_status: replayed ? "already_applied" : "accepted",
        replayed,
      });
    }
  }

  if (path === "/api/v1/vaults" && req.method === "POST") {
    const name = url.searchParams.get("name");
    if (!name) return json(res, 422, { error: "missing vault name" });
    if (!state.vaults.has(name)) state.vaults.set(name, rawVault(name));
    const vault = state.vaults.get(name);
    return json(res, 200, {
      vault_id: vault.id,
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

  const assetUploadMatch = path.match(/^\/api\/v1\/assets\/([^/]+)$/);
  if (assetUploadMatch && req.method === "POST") {
    const vault = vaultFor(decodeURIComponent(assetUploadMatch[1]));
    if (!vault) return;
    if (!vault.assets) vault.assets = new Map();
    const body = await readRawBody(req);
    if (body.length === 0) return json(res, 400, { error: "empty asset" });
    const id = uuidFor(1000 + vault.assets.size);
    const name = url.searchParams.get("filename") || "attachment";
    const mimeType = String(req.headers["content-type"] ?? "");
    const asset = {
      id,
      name,
      mimeType,
      sizeBytes: body.length,
      body,
      claimed: false,
      createdAt: NOW,
    };
    vault.assets.set(id, asset);
    return json(res, 201, {
      kind: "attachment",
      id,
      target: `/api/assets/${id}`,
      url: `/api/assets/${id}`,
      name,
      mime_type: mimeType,
      size_bytes: body.length,
      unclaimed_expires_at: "2026-06-16T00:00:00.000Z",
    });
  }

  const assetPolicyMatch = path.match(/^\/api\/v1\/assets\/([^/]+)\/policy$/);
  if (assetPolicyMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(assetPolicyMatch[1]));
    if (!vault) return;
    return json(res, 200, {
      kind: "attachment_policy",
      vault: vault.name,
      server_time: NOW,
      unclaimed_ttl_hours: 24,
      revision_retention_days: 30,
    });
  }

  const assetCopyMatch = path.match(
    /^\/api\/v1\/assets\/([^/]+)\/from-file\/([^/]+)$/,
  );
  if (assetCopyMatch && req.method === "POST") {
    const vault = vaultFor(decodeURIComponent(assetCopyMatch[1]));
    if (!vault) return;
    const file = vault.files?.get(decodeURIComponent(assetCopyMatch[2]));
    if (!file?.confirmed || !file.body) {
      return json(res, 404, { error: "file not found" });
    }
    if (!vault.assets) vault.assets = new Map();
    const id = uuidFor(1000 + vault.assets.size);
    const asset = {
      id,
      name: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      body: file.body,
      claimed: false,
      createdAt: NOW,
      sourceFileUri: file.uri,
    };
    vault.assets.set(id, asset);
    return json(res, 201, {
      kind: "attachment",
      id,
      target: `/api/assets/${id}`,
      url: `/api/assets/${id}`,
      name: asset.name,
      mime_type: asset.mimeType,
      size_bytes: asset.sizeBytes,
      source_file_uri: asset.sourceFileUri,
      unclaimed_expires_at: "2026-06-16T00:00:00.000Z",
    });
  }

  const assetMetadataMatch = path.match(
    /^\/api\/v1\/assets\/([^/]+)\/([^/]+)\/metadata$/,
  );
  if (assetMetadataMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(assetMetadataMatch[1]));
    if (!vault) return;
    const asset = vault.assets?.get(decodeURIComponent(assetMetadataMatch[2]));
    if (!asset) return json(res, 404, { error: "asset not found" });
    return json(res, 200, {
      kind: "attachment",
      target: `/api/assets/${asset.id}`,
      status: asset.claimed ? "claimed" : "unclaimed",
      unclaimed_expires_at: asset.claimed ? null : "2026-06-16T00:00:00.000Z",
    });
  }

  const assetDiscardMatch = path.match(/^\/api\/v1\/assets\/([^/]+)\/([^/]+)$/);
  if (assetDiscardMatch && req.method === "DELETE") {
    const vault = vaultFor(decodeURIComponent(assetDiscardMatch[1]));
    if (!vault) return;
    const id = decodeURIComponent(assetDiscardMatch[2]);
    const asset = vault.assets?.get(id);
    if (!asset) return json(res, 200, { discarded: false });
    if (asset.claimed) return json(res, 409, { error: "asset claimed" });
    vault.assets.delete(id);
    return json(res, 200, { discarded: true });
  }

  const stableAssetMatch = path.match(/^\/api\/assets\/([^/]+)$/);
  if (stableAssetMatch && req.method === "GET") {
    const vault = vaultFor(url.searchParams.get("vault") ?? "");
    if (!vault) return;
    const asset = vault.assets?.get(decodeURIComponent(stableAssetMatch[1]));
    if (!asset?.body) return json(res, 404, { error: "asset not found" });
    res.writeHead(200, {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.body.length),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    });
    return res.end(asset.body);
  }

  const tablesMatch = path.match(/^\/api\/v1\/tables\/([^/]+)$/);
  if (tablesMatch && req.method === "GET") {
    const vault = vaultFor(decodeURIComponent(tablesMatch[1]));
    if (!vault) return;
    return json(res, 200, {
      kind: "table",
      vault: vault.name,
      items: [...vault.tables].map((name) => {
        const table = REEF_INSTALLATION_TABLE_METADATA.find(
          (item) => item.name === name,
        ) ?? {
          name,
          columns: [],
          unique_keys: [],
          indexes: [],
        };
        if (
          state.scenario === "notifications" &&
          vault.name === REEF_VAULT &&
          state.notificationSchemaMode === "incompatible" &&
          name === "reef_notifications"
        ) {
          return {
            ...table,
            columns: table.columns.filter(
              ({ name: columnName }) => columnName !== "archived_at",
            ),
          };
        }
        return table;
      }),
    });
  }
  if (tablesMatch && req.method === "POST") {
    const vault = vaultFor(decodeURIComponent(tablesMatch[1]));
    if (!vault) return;
    if (consumeWorkspaceInitializationFailure(state, "tables")) {
      return json(res, 503, {
        detail: {
          message: "fixture workspace table initialization failed",
          code: "e2e_workspace_table_initialization_failed",
        },
      });
    }
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
    if (body?.vaults !== undefined && !Array.isArray(body.vaults)) {
      return json(res, 400, { error: "invalid_vault_scope" });
    }
    const scopedVaults = Array.isArray(body?.vaults) ? body.vaults : null;
    if (scopedVaults) {
      if (
        !scopedVaults.every((name) => typeof name === "string") ||
        new Set(scopedVaults).size !== scopedVaults.length ||
        !scopedVaults.includes(vault.name)
      ) {
        return json(res, 400, { error: "invalid_vault_scope" });
      }
      for (const name of scopedVaults) {
        const scopedVault = state.vaults.get(name);
        if (!scopedVault) {
          return json(res, 404, { error: "vault not found" });
        }
        if (
          !["owner", "admin", "writer", "reader"].includes(
            roleForVault(scopedVault, state, username),
          )
        ) {
          return json(res, 403, { error: "permission_denied" });
        }
        if (!scopedVault.tables.has("reef_issues")) {
          return json(res, 400, {
            error: 'relation "reef_issues" does not exist',
          });
        }
      }
    }
    const sql = resolveSqlParams(
      String(body?.sql ?? ""),
      Array.isArray(body?.params) ? body.params : undefined,
    );
    const issueId =
      /^\s*update\s+reef_issues\b/i.test(sql) &&
      matchSqlString(sql, /where "?reef_id"?\s*=\s*'([^']+)'/i);
    const updateKey = issueId ? issueUpdateKey(vault.name, issueId) : null;
    const issueListKey = isIssueListQuery(sql) ? vault.name : null;
    const attachmentIssueId =
      /^\s*select \* from reef_attachments\b/i.test(sql) &&
      matchSqlString(sql, /where\s+reef_id\s*=\s*'([^']+)'/i);
    const attachmentKey = attachmentIssueId
      ? attachmentReadKey(vault.name, attachmentIssueId)
      : null;
    const isPlanningCatalogRead =
      /^\s*select \* from reef_(?:sprints|milestones|releases)\b/i.test(sql);
    const isReorder = /^\s*with updated as \(update reef_issues\b/i.test(sql);
    if (updateKey) beginIssueUpdateRequest(state, updateKey);
    if (issueListKey) beginIssueListRequest(state, issueListKey);
    if (attachmentKey) beginAttachmentReadRequest(state, attachmentKey);
    try {
      if (updateKey && consumeIssueUpdateHold(state, updateKey)) {
        await waitForIssueUpdateRelease(state, updateKey);
      }
      if (issueListKey && state.issueListDelayMs > 0) {
        await sleep(state.issueListDelayMs);
      }
      if (isPlanningCatalogRead && state.planningCatalogDelayMs > 0) {
        await sleep(state.planningCatalogDelayMs);
      }
      const attachmentDelayMs = attachmentKey
        ? (state.attachmentReadControls.get(attachmentKey)?.delayMs ?? 0)
        : 0;
      if (attachmentDelayMs > 0) await sleep(attachmentDelayMs);
      const delayMs = updateKey
        ? (state.issueUpdateDelays.get(updateKey) ?? 0)
        : isReorder
          ? state.issueReorderDelayMs
          : 0;
      if (delayMs > 0) await sleep(delayMs);
      if (isReorder && state.issueReorderFailures > 0) {
        state.issueReorderFailures -= 1;
        return json(res, 200, { error: "e2e forced issue reorder failure" });
      }
      rememberSqlCall(state, vault.name, username, sql);
      if (
        state.contentSearchMode === "missing-comments" &&
        /^\s*select id, reef_id, body, created_at from \(/i.test(sql) &&
        /\bfrom reef_comments\b/i.test(sql)
      ) {
        return json(res, 200, {
          error: 'relation "reef_comments" does not exist',
        });
      }
      const myWorkResult = scopedVaults
        ? handleMyWorkSql(state, sql, username, scopedVaults)
        : null;
      const result = myWorkResult ?? handleSql(state, vault, sql, username);
      if (result.kind === "sql_error") {
        return json(res, result.status, result.body);
      }
      return json(res, 200, result);
    } finally {
      if (updateKey) endIssueUpdateRequest(state, updateKey);
      if (issueListKey) endIssueListRequest(state, issueListKey);
      if (attachmentKey) endAttachmentReadRequest(state, attachmentKey);
    }
  }

  if (path === "/api/v1/documents" && req.method === "POST") {
    const body = await readJson(req);
    const vault = vaultFor(String(body?.vault ?? ""));
    if (!vault) return;
    if (consumeWorkspaceInitializationFailure(state, "document")) {
      return json(res, 503, {
        detail: {
          message: "fixture workspace document initialization failed",
          code: "e2e_workspace_document_initialization_failed",
        },
      });
    }
    const collection = String(body?.collection ?? "documents")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const slug = String(
      body?.slug ?? slugify(String(body?.title ?? "document")),
    );
    const type = String(body?.type ?? "document");
    const canonicalSkill =
      collection === "overview" && slug === "vault-skill" && type === "skill";
    if (
      (collection === "overview" ||
        collection.startsWith("overview/") ||
        type === "skill") &&
      !canonicalSkill
    ) {
      const message =
        "The requested document targets AKB's reserved system path.";
      return json(res, 403, {
        message,
        error: message,
        code: "reserved_system_path",
        detail: { message, code: "reserved_system_path" },
      });
    }
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
      const issueDocument = docPath.match(/^issues\/(reef-\d+)\.md$/i);
      const readControl = issueDocument
        ? state.issueReadControls.get(
            `${vault.name}:${issueDocument[1].toUpperCase()}`,
          )
        : null;
      const issueReadKey = issueDocument
        ? `${vault.name}:${issueDocument[1].toUpperCase()}`
        : null;
      if (readControl && issueReadKey) {
        beginIssueReadRequest(state, issueReadKey);
      }
      try {
        if (readControl?.delayMs) await sleep(readControl.delayMs);
        if (readControl?.failureStatus) {
          return json(res, readControl.failureStatus, {
            error: "e2e issue read failure",
          });
        }
        if (consumeWorkspaceInitializationFailure(state, "document_get")) {
          return json(res, 503, {
            detail: {
              message: "fixture workspace document read failed",
              code: "e2e_workspace_document_read_failed",
            },
          });
        }
        if (!existing) return json(res, 404, { error: "document not found" });
        return json(res, 200, documentResponse(vault, existing));
      } finally {
        if (readControl && issueReadKey) {
          endIssueReadRequest(state, issueReadKey);
        }
      }
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
      claimDocumentAssets(vault, existing.content);
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
    const query = (url.searchParams.get("q") ?? "").trim();
    const linkSearchKey = markdownLinkSearchKey(vault.name, query);
    const linkSearchControl =
      state.scenario === "markdown_fixture"
        ? state.markdownLinkSearchControls.get(linkSearchKey)
        : undefined;
    if (state.scenario === "markdown_fixture") {
      beginMarkdownLinkSearchRequest(state, linkSearchKey);
    }
    try {
      if (linkSearchControl?.delayMs) await sleep(linkSearchControl.delayMs);
      if (linkSearchControl?.failureStatus) {
        return json(res, linkSearchControl.failureStatus, {
          detail: "e2e forced Markdown link search failure",
        });
      }
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
      const search = searchVaultResources(vault, url);
      return json(res, 200, {
        kind: "search",
        returned: search.results.length,
        total_matches: search.totalMatches,
        truncated: search.totalMatches > search.results.length,
        degraded:
          isIssueContentSearch && state.contentSearchMode === "degraded",
        degradation_reason:
          isIssueContentSearch && state.contentSearchMode === "degraded"
            ? "e2e_forced"
            : null,
        results: search.results,
      });
    } finally {
      if (state.scenario === "markdown_fixture") {
        endMarkdownLinkSearchRequest(state, linkSearchKey);
      }
    }
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
  if (state.authProbeHold) {
    beginAuthProbeHold(state);
    try {
      await waitForAuthProbeRelease(state);
      if (req.aborted || req.destroyed) return false;
    } finally {
      endAuthProbeHold(state);
    }
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

function consumeWorkspaceInitializationFailure(state, operation) {
  if (
    state.workspaceInitFailureOperation !== operation ||
    state.workspaceInitFailureRemaining <= 0
  ) {
    return false;
  }
  if (state.workspaceInitFailureSuccessesBefore !== null) {
    if (state.workspaceInitFailureSuccessesBefore > 0) {
      state.workspaceInitFailureSuccessesBefore -= 1;
      return false;
    }
  }
  state.workspaceInitFailureRemaining -= 1;
  return true;
}

function searchVaultResources(vault, url) {
  const collection = url.searchParams.get("collection");
  const type = url.searchParams.get("type");
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 10));

  const documents = [...vault.documents.values()]
    .filter((doc) => {
      if (collection && !doc.path.startsWith(`${collection}/`)) return false;
      if (type && doc.type !== type) return false;
      return true;
    })
    .map((doc) => ({
      hit: {
        uri: doc.uri,
        vault: vault.name,
        title: doc.title ?? null,
        summary: doc.summary ?? null,
        matched_section: doc.content?.slice(0, 320) ?? doc.summary ?? null,
        source_type: "document",
        collection: doc.path.split("/").at(0) ?? null,
        doc_type: doc.type ?? null,
        tags: doc.tags ?? [],
      },
      score: searchScore(doc, query),
    }));
  const files = type
    ? []
    : [...(vault.files?.values() ?? [])]
        .filter((file) => file.confirmed)
        .filter((file) => {
          if (!collection) return true;
          const fileCollection = file.uri.match(
            /^akb:\/\/[^/]+\/(?:coll\/)?(.+)\/file\/[^/]+$/u,
          )?.[1];
          return fileCollection === collection;
        })
        .map((file) => ({
          hit: {
            uri: file.uri,
            vault: vault.name,
            title: file.filename,
            summary: file.mimeType,
            matched_section: null,
            source_type: "file",
            collection:
              file.uri.match(
                /^akb:\/\/[^/]+\/(?:coll\/)?(.+)\/file\/[^/]+$/u,
              )?.[1] ?? null,
            doc_type: null,
            tags: [],
          },
          score: searchScore(
            {
              path: file.uri,
              title: file.filename,
              summary: file.mimeType,
              content: "",
              tags: [],
            },
            query,
          ),
        }));
  const matches = [...documents, ...files]
    .filter(({ score }) => query.length === 0 || score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.hit.source_type.localeCompare(b.hit.source_type) ||
        a.hit.uri.localeCompare(b.hit.uri),
    );
  return {
    totalMatches: matches.length,
    results: matches
      .slice(0, limit)
      .map(({ hit, score }) => ({ ...hit, score })),
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

function claimDocumentAssets(vault, content) {
  if (!vault.assets || typeof content !== "string") return;
  const pattern =
    /\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/giu;
  for (const match of content.matchAll(pattern)) {
    const asset = vault.assets.get(match[1]);
    if (asset) asset.claimed = true;
  }
}
