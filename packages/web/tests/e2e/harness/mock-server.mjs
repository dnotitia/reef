import { createServer } from "node:http";

import {
  ACCOUNT_DENIAL_CODES,
  AUTH_PROTECTED_RESPONSES,
  AUTH_SESSIONS,
  fixtureLogin,
  IMAGE_UPLOAD_FIXTURE_BYTES,
  IMAGE_UPLOAD_FIXTURE_CONTENT_TYPE,
  IMAGE_UPLOAD_FIXTURE_FILE_NAME,
  IMAGE_UPLOAD_FIXTURE_PATH,
  MARKDOWN_MEDIA_ASSETS,
  REEF_VAULT,
} from "./mock-fixtures.mjs";
import { handleAkb, getVault } from "./mock-akb.mjs";
import { handleGitHub } from "./mock-github.mjs";
import { headerQuoted, json, readJson, readRawBody } from "./mock-http.mjs";
import { handleOpenRouter } from "./mock-openrouter.mjs";
import { runtimeDiscovery } from "./mock-runtime.mjs";
import {
  createState,
  issueUpdateKey,
  normalizeScenario,
  publicState,
  releaseAllIssueUpdateHolds,
  releaseIssueUpdate,
  rememberCall,
  setIssueUpdateHold,
} from "./mock-state.mjs";
import { sha256 } from "./mock-utils.mjs";

const PORT = Number(process.env.REEF_E2E_MOCK_PORT ?? 7354);
const HOST = process.env.REEF_E2E_MOCK_HOST ?? "127.0.0.1";

let state = createState("configured");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    rememberCall(state, req.method ?? "GET", url.pathname);

    if (url.pathname === "/__e2e/health") {
      return json(res, 200, { ok: true });
    }
    if (url.pathname === IMAGE_UPLOAD_FIXTURE_PATH && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": IMAGE_UPLOAD_FIXTURE_CONTENT_TYPE,
        "Content-Length": String(IMAGE_UPLOAD_FIXTURE_BYTES.length),
        "Content-Disposition": `attachment; filename="${IMAGE_UPLOAD_FIXTURE_FILE_NAME}"`,
        "Cache-Control": "no-store",
      });
      return res.end(IMAGE_UPLOAD_FIXTURE_BYTES);
    }
    const markdownMediaAsset = MARKDOWN_MEDIA_ASSETS.get(url.pathname);
    if (markdownMediaAsset && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": markdownMediaAsset.contentType,
        "Content-Length": String(markdownMediaAsset.body.length),
        "Cache-Control": "no-store",
      });
      return res.end(markdownMediaAsset.body);
    }
    if (url.pathname === "/__e2e/runtime" && req.method === "GET") {
      return json(res, 200, runtimeDiscovery(state));
    }
    if (url.pathname === "/__e2e/reset" && req.method === "POST") {
      const body = await readJson(req);
      releaseAllIssueUpdateHolds(state);
      state = createState(normalizeScenario(body?.scenario));
      return json(res, 200, { ok: true, scenario: state.scenario });
    }
    if (url.pathname === "/__e2e/issue-list-failure" && req.method === "POST") {
      const body = await readJson(req);
      state.issueListFailure = body?.enabled === true;
      state.issueListNextPageFailures = Math.max(
        0,
        Number(body?.next_page_failures ?? 0),
      );
      return json(res, 200, {
        ok: true,
        issue_list_failure: state.issueListFailure,
        issue_list_next_page_failures: state.issueListNextPageFailures,
      });
    }
    if (
      url.pathname === "/__e2e/planning-catalog-failure" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      state.planningCatalogFailure = body?.enabled === true;
      return json(res, 200, {
        ok: true,
        planning_catalog_failure: state.planningCatalogFailure,
      });
    }
    if (url.pathname === "/__e2e/vault-list-control" && req.method === "POST") {
      const body = await readJson(req);
      state.vaultListDelayMs = Math.max(0, Number(body?.delay_ms ?? 0));
      state.vaultListFailures = Math.max(0, Number(body?.failures ?? 0));
      return json(res, 200, {
        ok: true,
        delay_ms: state.vaultListDelayMs,
        failures: state.vaultListFailures,
      });
    }
    if (
      url.pathname === "/__e2e/issue-update-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      const vault = String(body?.vault ?? REEF_VAULT);
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      const controls = [];
      for (const update of updates) {
        const issueId = String(update?.issue_id ?? "");
        if (!issueId) continue;
        const key = issueUpdateKey(vault, issueId);
        const delayMs = Math.max(0, Number(update?.delay_ms ?? 0));
        const failures = Math.max(0, Number(update?.failures ?? 0));
        state.issueUpdateDelays.set(key, delayMs);
        setIssueUpdateHold(state, key, update?.hold === true);
        if (failures > 0) state.issueUpdateFailures.set(key, "once");
        else state.issueUpdateFailures.delete(key);
        controls.push({
          issue_id: issueId,
          delay_ms: delayMs,
          failures,
          hold: update?.hold === true,
        });
      }
      return json(res, 200, { ok: true, vault, updates: controls });
    }
    if (
      url.pathname === "/__e2e/issue-update-release" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      const vault = String(body?.vault ?? REEF_VAULT);
      const issueId = String(body?.issue_id ?? "");
      const released = issueId
        ? releaseIssueUpdate(state, issueUpdateKey(vault, issueId))
        : false;
      return json(res, 200, { ok: true, released });
    }
    if (
      url.pathname === "/__e2e/issue-reorder-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      state.issueReorderDelayMs = Math.max(
        0,
        Math.min(Number(body?.delay_ms ?? 0), 2_000),
      );
      state.issueReorderFailures = Math.max(0, Number(body?.failures ?? 0));
      return json(res, 200, {
        ok: true,
        delay_ms: state.issueReorderDelayMs,
        failures: state.issueReorderFailures,
      });
    }
    if (
      url.pathname === "/__e2e/content-search-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      const mode = [
        "healthy",
        "degraded",
        "error",
        "missing-comments",
      ].includes(body?.mode)
        ? body.mode
        : "healthy";
      state.contentSearchMode = mode;
      state.contentSearchDelayMs = Math.max(
        0,
        Math.min(Number(body?.delay_ms ?? 0), 2_000),
      );
      const vault = state.vaults.get(REEF_VAULT);
      if (vault) {
        if (mode === "missing-comments") vault.tables.delete("reef_comments");
        else vault.tables.add("reef_comments");
      }
      return json(res, 200, {
        ok: true,
        mode,
        delay_ms: state.contentSearchDelayMs,
      });
    }
    if (url.pathname === "/__e2e/remove-issue" && req.method === "POST") {
      const body = await readJson(req);
      const vault = state.vaults.get(String(body?.vault ?? REEF_VAULT));
      const id = String(body?.id ?? "");
      if (vault)
        vault.issues = vault.issues.filter((issue) => issue.reef_id !== id);
      return json(res, 200, { ok: true, id });
    }
    if (url.pathname === "/__e2e/keycloak" && req.method === "POST") {
      const body = await readJson(req);
      state.keycloakEnabled = body?.enabled === true;
      state.localAuthEnabled = body?.local_auth_enabled !== false;
      state.ssoOnly = body?.sso_only === true;
      return json(res, 200, {
        ok: true,
        keycloak_enabled: state.keycloakEnabled,
        local_auth_enabled: state.localAuthEnabled,
        sso_only: state.ssoOnly,
      });
    }
    if (url.pathname === "/__e2e/account-denial" && req.method === "POST") {
      const body = await readJson(req);
      const requested = body?.code;
      state.accountDenialCode = ACCOUNT_DENIAL_CODES.has(requested)
        ? requested
        : null;
      return json(res, 200, {
        ok: true,
        code: state.accountDenialCode,
      });
    }
    if (url.pathname === "/__e2e/auth-control" && req.method === "POST") {
      const body = await readJson(req);
      state.authProbeDelayMs = Math.max(
        0,
        Math.min(Number(body?.probe_delay_ms ?? 0), 8_000),
      );
      state.authProbeDelayOnce = body?.probe_delay_once === true;
      state.authProbeHang = body?.probe_hang === true;
      state.protectedResponse = AUTH_PROTECTED_RESPONSES.has(
        body?.protected_response,
      )
        ? body.protected_response
        : "healthy";
      if (AUTH_SESSIONS.has(body?.session)) {
        if (body.session === "revoked") state.sessions.clear();
        else state.sessions.set(state.loginToken, fixtureLogin.username);
      }
      return json(res, 200, {
        ok: true,
        probe_delay_ms: state.authProbeDelayMs,
        probe_hang: state.authProbeHang,
        session: body?.session === "revoked" ? "revoked" : "active",
        protected_response: state.protectedResponse,
      });
    }
    if (
      url.pathname === "/api/v1/auth/keycloak/login" &&
      req.method === "GET"
    ) {
      if (!state.keycloakEnabled) {
        return json(res, 404, { error: "keycloak_disabled" });
      }
      res.writeHead(302, {
        Location: `http://${req.headers.host}/keycloak/authorize`,
        "Cache-Control": "no-store",
      });
      return res.end();
    }
    if (url.pathname === "/keycloak/authorize") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        '<!doctype html><html><body><main data-testid="fixture-keycloak-authorize"><h1>Keycloak Sign-In (fixture)</h1></main></body></html>',
      );
    }
    if (url.pathname === "/__e2e/state") {
      return json(res, 200, publicState(state));
    }

    const presignedFileMatch = url.pathname.match(
      /^\/__e2e\/files\/([^/]+)\/([^/]+)\/(upload|download)$/,
    );
    if (presignedFileMatch) {
      const [, encodedVault, encodedFileId, operation] = presignedFileMatch;
      const vault = getVault(decodeURIComponent(encodedVault), res, state);
      if (!vault) return;
      const file = vault.files?.get(decodeURIComponent(encodedFileId));
      if (!file) return json(res, 404, { error: "file not found" });

      if (operation === "upload" && req.method === "PUT") {
        const body = await readRawBody(req);
        if (sha256(body) !== file.contentHash) {
          return json(res, 422, { error: "content hash mismatch" });
        }
        file.body = body;
        file.mimeType =
          String(req.headers["content-type"] ?? "") ||
          "application/octet-stream";
        file.sizeBytes = body.length;
        return json(res, 200, { uploaded: true });
      }

      if (operation === "download" && req.method === "GET") {
        if (!file.confirmed || !file.body) {
          return json(res, 409, { error: "file not confirmed" });
        }
        res.writeHead(200, {
          "Content-Type": file.mimeType,
          "Content-Length": String(file.body.length),
          "Content-Disposition": `inline; filename="${headerQuoted(file.filename)}"`,
          "Cache-Control": "no-store",
        });
        return res.end(file.body);
      }
    }

    if (url.pathname.startsWith("/akb")) {
      return handleAkb(req, res, url, state);
    }
    if (url.pathname.startsWith("/openrouter")) {
      return handleOpenRouter(req, res);
    }
    if (url.pathname.startsWith("/github")) {
      return handleGitHub(req, res, url, state);
    }
    return json(res, 404, { error: "not_found" });
  } catch (err) {
    const detail =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    process.stderr.write(
      `[reef-e2e-mock] unhandled request error: ${detail}\n`,
    );
    return json(res, 500, { error: "mock_server_error" });
  }
});

// Playwright's APIRequestContext keeps fixture-control connections pooled.
// Node's 5s default can close an otherwise healthy pooled socket while a UI
// interaction is still running, racing the next /__e2e/state read with an
// ECONNRESET. Keep the socket alive for one full hermetic test timeout; dead
// fixture servers still fail through the normal request and health checks.
server.keepAliveTimeout = 30_000;
server.headersTimeout = 31_000;

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `reef e2e fixture server listening on ${HOST}:${PORT}\n`,
  );
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
