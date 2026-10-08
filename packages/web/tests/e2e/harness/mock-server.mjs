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
  INSTALLATION_BLOCKED_REASONS,
  INSTALLATION_DRIFT_STATUSES,
  INSTALLATION_LIFECYCLES,
  INSTALLATION_LOOKUP_MODES,
  INSTALLATION_OBSERVATION_MODES,
  INSTALLATION_ROLES,
  MARKDOWN_MEDIA_ASSETS,
  NOTIFICATION_DATA_MODES,
  NOTIFICATION_SCHEMA_MODES,
  REEF_VAULT,
} from "./mock-fixtures.mjs";
import { handleAkb, getVault } from "./mock-akb.mjs";
import { handleGitHub } from "./mock-github.mjs";
import { headerQuoted, json, readJson, readRawBody } from "./mock-http.mjs";
import { handleOpenRouter } from "./mock-openrouter.mjs";
import { runtimeDiscovery } from "./mock-runtime.mjs";
import {
  createState,
  attachmentReadKey,
  installationLookupModes,
  issueUpdateKey,
  markdownLinkSearchKey,
  normalizeScenario,
  publicState,
  releaseAllAuthProbeHolds,
  releaseAllIssueUpdateHolds,
  releaseIssueUpdate,
  rememberCall,
  setIssueUpdateHold,
  waitForAuthProbeHold,
} from "./mock-state.mjs";
import { sha256 } from "./mock-utils.mjs";
import {
  E2E_REEF_OLD_SCHEMA_FINGERPRINT,
  E2E_REEF_SCHEMA_FINGERPRINT,
} from "./mock-installation.mjs";

const PORT = Number(process.env.REEF_E2E_MOCK_PORT ?? 7354);
const HOST = process.env.REEF_E2E_MOCK_HOST ?? "127.0.0.1";
const AUTH_PROBE_FAILURE_STATUSES = new Set([500, 503]);

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
      releaseAllAuthProbeHolds(state);
      releaseAllIssueUpdateHolds(state);
      state = createState(normalizeScenario(body?.scenario));
      return json(res, 200, { ok: true, scenario: state.scenario });
    }
    if (
      url.pathname === "/__e2e/activity-identity-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      if (state.scenario !== "activity_display_names") {
        return json(res, 409, { error: "unsupported fixture scenario" });
      }
      const vault = getVault(String(body?.vault ?? REEF_VAULT), res, state);
      const username = String(body?.username ?? "");
      const displayName = body?.display_name;
      if (!vault || !username || typeof displayName !== "string") {
        return json(res, 400, { error: "invalid identity control" });
      }
      if (displayName.length > 120) {
        return json(res, 400, { error: "display name is too long" });
      }
      const member = vault.members.find(
        (candidate) => candidate.username === username,
      );
      if (!member) return json(res, 404, { error: "member not found" });
      member.display_name = displayName;
      return json(res, 200, {
        ok: true,
        username,
        display_name: displayName,
      });
    }
    if (url.pathname === "/__e2e/issue-list-failure" && req.method === "POST") {
      const body = await readJson(req);
      state.issueListFailure = body?.enabled === true;
      const failureStatus = body?.failure_status;
      state.issueListFailureStatus =
        failureStatus === "network" || [409, 500, 503].includes(failureStatus)
          ? failureStatus
          : null;
      state.issueListNextPageFailures = Math.max(
        0,
        Number(body?.next_page_failures ?? 0),
      );
      state.issueListDelayMs = Math.max(
        0,
        Math.min(Number(body?.delay_ms ?? 0), 5_000),
      );
      return json(res, 200, {
        ok: true,
        issue_list_failure: state.issueListFailure,
        issue_list_failure_status: state.issueListFailureStatus,
        issue_list_next_page_failures: state.issueListNextPageFailures,
        issue_list_delay_ms: state.issueListDelayMs,
      });
    }
    if (
      url.pathname === "/__e2e/planning-catalog-failure" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      state.planningCatalogFailure = body?.enabled === true;
      state.planningCatalogDelayMs = Math.max(
        0,
        Math.min(Number(body?.delay_ms ?? 0), 5_000),
      );
      return json(res, 200, {
        ok: true,
        planning_catalog_failure: state.planningCatalogFailure,
        planning_catalog_delay_ms: state.planningCatalogDelayMs,
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
      url.pathname === "/__e2e/workspace-initialization-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      const operation = ["document", "document_get", "tables"].includes(
        body?.operation,
      )
        ? body.operation
        : null;
      const parsedSuccessesBeforeFailure = Number(
        body?.successes_before_failure,
      );
      state.workspaceInitFailureOperation = operation;
      state.workspaceInitFailureRemaining = Math.max(
        0,
        Number(body?.failures ?? 0),
      );
      state.workspaceInitFailureSuccessesBefore =
        Number.isFinite(parsedSuccessesBeforeFailure) &&
        parsedSuccessesBeforeFailure >= 0
          ? Math.floor(parsedSuccessesBeforeFailure)
          : null;
      return json(res, 200, {
        ok: true,
        operation,
        failures: state.workspaceInitFailureRemaining,
        successes_before_failure: state.workspaceInitFailureSuccessesBefore,
      });
    }
    if (
      url.pathname === "/__e2e/installation-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      if (
        state.scenario !== "installation_drift" &&
        state.scenario !== "configured_multi" &&
        state.scenario !== "notifications_personal"
      ) {
        return json(res, 409, { error: "unsupported fixture scenario" });
      }
      if (
        state.scenario === "configured_multi" &&
        [
          "drift",
          "observation",
          "blocked_reason",
          "detail_lookup",
          "roles",
        ].some((field) => body?.[field] !== undefined)
      ) {
        return json(res, 400, {
          error: "unsupported configured_multi installation control",
        });
      }
      const vaultName = String(body?.vault ?? REEF_VAULT);
      const vault = state.vaults.get(vaultName);
      if (!vault?.installation) {
        return json(res, 404, { error: "installation fixture not found" });
      }
      const installation = vault.installation;
      const currentLookupModes = installationLookupModes(state, vaultName);
      const memberLookup = INSTALLATION_LOOKUP_MODES.includes(
        body?.member_lookup,
      )
        ? body.member_lookup
        : currentLookupModes.member_lookup;
      const detailLookup = INSTALLATION_LOOKUP_MODES.includes(
        body?.detail_lookup,
      )
        ? body.detail_lookup
        : currentLookupModes.detail_lookup;
      state.installationLookupModes.set(vaultName, {
        member_lookup: memberLookup,
        detail_lookup: detailLookup,
      });

      if (INSTALLATION_LIFECYCLES.includes(body?.lifecycle)) {
        installation.lifecycle = body.lifecycle;
      }
      if (INSTALLATION_OBSERVATION_MODES.includes(body?.observation)) {
        installation.observationMode = body.observation;
        if (body.observation === "missing") {
          installation.observed = null;
          for (const dimension of ["release", "schema", "grant"]) {
            installation.drift[dimension].status = "unknown";
          }
          installation.drift.release.observed = null;
          installation.drift.schema.observed = null;
          installation.drift.grant.observed_generation = null;
          installation.drift.overall = "unknown";
          installation.drift.reasons = [];
          installation.drift.unknown_dimensions = [
            "release",
            "schema",
            "grant",
          ];
          installation.driftClassification = structuredClone(
            installation.drift,
          );
        } else if (installation.observed) {
          installation.observed.observedAt =
            body.observation === "stale" ? "2020-01-01T00:00:00.000Z" : NOW;
        }
      }
      if (INSTALLATION_BLOCKED_REASONS.includes(body?.blocked_reason)) {
        const reason = body.blocked_reason;
        installation.blockedReason =
          reason === "null"
            ? null
            : reason === "unknown"
              ? "unrecognized_fixture_reason"
              : reason === "malformed"
                ? { diagnostic: "private fixture detail" }
                : reason;
      }
      if (body?.drift && typeof body.drift === "object") {
        const nextStatuses = {
          release:
            installation.observationMode === "missing"
              ? "unknown"
              : INSTALLATION_DRIFT_STATUSES.includes(body.drift.release)
                ? body.drift.release
                : installation.drift.release.status,
          schema:
            installation.observationMode === "missing"
              ? "unknown"
              : INSTALLATION_DRIFT_STATUSES.includes(body.drift.schema)
                ? body.drift.schema
                : installation.drift.schema.status,
          grant:
            installation.observationMode === "missing"
              ? "unknown"
              : INSTALLATION_DRIFT_STATUSES.includes(body.drift.grant)
                ? body.drift.grant
                : installation.drift.grant.status,
        };
        const reasonFor = (dimension) => `${dimension}_mismatch`;
        installation.drift.release = {
          status: nextStatuses.release,
          desired: {
            id: installation.desiredReleaseId,
            version: installation.desiredReleaseVersion,
          },
          observed:
            nextStatuses.release === "unknown"
              ? null
              : {
                  id: installation.currentReleaseId,
                  version:
                    nextStatuses.release === "mismatch"
                      ? "0.15.0"
                      : installation.currentReleaseVersion,
                },
        };
        installation.drift.schema = {
          status: nextStatuses.schema,
          expected: E2E_REEF_SCHEMA_FINGERPRINT,
          observed:
            nextStatuses.schema === "unknown"
              ? null
              : nextStatuses.schema === "mismatch"
                ? E2E_REEF_OLD_SCHEMA_FINGERPRINT
                : E2E_REEF_SCHEMA_FINGERPRINT,
        };
        installation.drift.grant = {
          status: nextStatuses.grant,
          desired_generation: installation.desiredGrantGeneration,
          observed_generation:
            nextStatuses.grant === "unknown"
              ? null
              : nextStatuses.grant === "mismatch"
                ? Math.max(0, installation.desiredGrantGeneration - 1)
                : installation.desiredGrantGeneration,
        };
        installation.drift.overall = Object.values(nextStatuses).includes(
          "mismatch",
        )
          ? "drifted"
          : Object.values(nextStatuses).includes("unknown")
            ? "unknown"
            : "in_sync";
        installation.drift.reasons = Object.entries(nextStatuses)
          .filter(([, status]) => status === "mismatch")
          .map(([dimension]) => reasonFor(dimension));
        installation.drift.unknown_dimensions = Object.entries(nextStatuses)
          .filter(([, status]) => status === "unknown")
          .map(([dimension]) => dimension);
        installation.driftClassification = structuredClone(installation.drift);
      }
      if (body?.roles && typeof body.roles === "object") {
        for (const [username, role] of Object.entries(body.roles)) {
          if (state.users.has(username) && INSTALLATION_ROLES.includes(role)) {
            state.installationRoles.set(username, role);
          }
        }
      }
      return json(res, 200, {
        ok: true,
        vault: vaultName,
        lifecycle: installation.lifecycle,
        member_lookup: memberLookup,
        detail_lookup: detailLookup,
        observation: installation.observationMode,
        ...(installation.drift
          ? {
              drift: {
                release: installation.drift.release.status,
                schema: installation.drift.schema.status,
                grant: installation.drift.grant.status,
              },
            }
          : {}),
        roles: Object.fromEntries(state.installationRoles),
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
    if (url.pathname === "/__e2e/issue-read-control" && req.method === "POST") {
      const body = await readJson(req);
      const vault = String(body?.vault ?? REEF_VAULT);
      const issueId = String(body?.issue_id ?? "").toUpperCase();
      if (!/^REEF-\d+$/.test(issueId)) {
        return json(res, 400, { ok: false, error: "invalid issue_id" });
      }
      const delayMs = Math.max(0, Math.min(Number(body?.delay_ms ?? 0), 5_000));
      const requestedStatus = Number(body?.failure_status);
      const failureStatus = [404, 500, 503].includes(requestedStatus)
        ? requestedStatus
        : null;
      const key = `${vault}:${issueId}`;
      if (delayMs === 0 && failureStatus === null) {
        state.issueReadControls.delete(key);
      } else {
        state.issueReadControls.set(key, { delayMs, failureStatus });
      }
      return json(res, 200, {
        ok: true,
        vault,
        issue_id: issueId,
        delay_ms: delayMs,
        failure_status: failureStatus,
      });
    }
    if (
      url.pathname === "/__e2e/attachment-read-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      const vault = String(body?.vault ?? REEF_VAULT);
      const issueId = String(body?.issue_id ?? "").toUpperCase();
      if (!/^REEF-\d+$/.test(issueId)) {
        return json(res, 400, { ok: false, error: "invalid issue_id" });
      }
      const delayMs = Math.max(0, Math.min(Number(body?.delay_ms ?? 0), 5_000));
      const key = attachmentReadKey(vault, issueId);
      if (delayMs === 0) state.attachmentReadControls.delete(key);
      else state.attachmentReadControls.set(key, { delayMs });
      return json(res, 200, {
        ok: true,
        vault,
        issue_id: issueId,
        delay_ms: delayMs,
      });
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
      return json(res, 200, {
        ok: true,
        mode,
        delay_ms: state.contentSearchDelayMs,
      });
    }
    if (
      url.pathname === "/__e2e/markdown-link-search-control" &&
      req.method === "POST"
    ) {
      if (state.scenario !== "markdown_fixture") {
        return json(res, 409, { error: "unsupported fixture scenario" });
      }
      const body = await readJson(req);
      const vault = String(body?.vault ?? REEF_VAULT);
      if (!getVault(vault, res, state)) return;
      const query = String(body?.query ?? "").trim();
      if (!query || query.length > 120) {
        return json(res, 400, { error: "invalid query" });
      }
      const delayMs = Math.max(0, Math.min(Number(body?.delay_ms ?? 0), 5_000));
      const requestedStatus = Number(body?.failure_status);
      const failureStatus = [500, 503].includes(requestedStatus)
        ? requestedStatus
        : null;
      const key = markdownLinkSearchKey(vault, query);
      if (delayMs === 0 && failureStatus === null) {
        state.markdownLinkSearchControls.delete(key);
      } else {
        state.markdownLinkSearchControls.set(key, { delayMs, failureStatus });
      }
      return json(res, 200, {
        ok: true,
        vault,
        query: query.toLowerCase(),
        delay_ms: delayMs,
        failure_status: failureStatus,
      });
    }
    if (
      url.pathname === "/__e2e/notification-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      const schemaMode = NOTIFICATION_SCHEMA_MODES.includes(body?.schema_mode)
        ? body.schema_mode
        : "healthy";
      const dataMode = NOTIFICATION_DATA_MODES.includes(body?.data_mode)
        ? body.data_mode
        : "healthy";
      const vaultName =
        typeof body?.vault === "string" ? body.vault : undefined;
      const role = ["owner", "admin", "writer", "reader", "none"].includes(
        body?.role,
      )
        ? body.role
        : undefined;
      if (vaultName) {
        const vault = state.vaults.get(vaultName);
        if (!vault) return json(res, 404, { error: "vault not found" });
        state.notificationSchemaModes.set(vaultName, schemaMode);
        state.notificationDataModes.set(vaultName, dataMode);
        if (role) {
          state.notificationWorkspaceRoles.set(
            `${vaultName}:${fixtureLogin.username}`,
            role,
          );
        }
        if (schemaMode === "missing") {
          vault.tables.delete("reef_notifications");
        } else {
          vault.tables.add("reef_notifications");
        }
        return json(res, 200, {
          ok: true,
          vault: vaultName,
          schema_mode: schemaMode,
          data_mode: dataMode,
          role: role ?? null,
        });
      }

      state.notificationSchemaMode = schemaMode;
      state.notificationDataMode = dataMode;
      state.notificationSchemaModes.clear();
      state.notificationDataModes.clear();
      state.notificationWorkspaceRoles.clear();
      const vaults = [...state.vaults.values()];
      for (const vault of vaults) {
        if (schemaMode === "missing") {
          vault.tables.delete("reef_notifications");
        } else {
          vault.tables.add("reef_notifications");
        }
      }
      return json(res, 200, {
        ok: true,
        schema_mode: schemaMode,
        data_mode: dataMode,
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
      state.authProbeHold = body?.probe_hold === true;
      state.authProbeHang = body?.probe_hang === true;
      const probeFailureStatus = Number(body?.probe_failure_status);
      state.authProbeFailureStatus = AUTH_PROBE_FAILURE_STATUSES.has(
        probeFailureStatus,
      )
        ? probeFailureStatus
        : null;
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
        probe_hold: state.authProbeHold,
        probe_hang: state.authProbeHang,
        probe_failure_status: state.authProbeFailureStatus,
        session: body?.session === "revoked" ? "revoked" : "active",
        protected_response: state.protectedResponse,
      });
    }
    if (url.pathname === "/__e2e/auth-probe-release" && req.method === "POST") {
      const pending = await waitForAuthProbeHold(state);
      return json(res, 200, {
        ok: true,
        released: pending ? releaseAllAuthProbeHolds(state) : 0,
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
