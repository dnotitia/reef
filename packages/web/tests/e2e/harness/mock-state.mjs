import {
  createScenarioVaults,
  fixtureLogin,
  NOW,
  REEF_VAULT,
  SUPPORTED_SCENARIO_SET,
} from "./mock-fixtures.mjs";
import { makeJwt } from "./mock-utils.mjs";

const NOW_MS = Date.parse(NOW);
let lastEditTimestampMs = NOW_MS;

export function nextEditTimestamp() {
  lastEditTimestampMs = Math.max(Date.now(), lastEditTimestampMs + 1_000);
  return new Date(lastEditTimestampMs).toISOString();
}

export function normalizeScenario(value) {
  return SUPPORTED_SCENARIO_SET.has(value) ? value : "configured";
}

export function issueUpdateKey(vault, issueId) {
  return `${vault}:${issueId}`;
}

export function attachmentReadKey(vault, issueId) {
  return `${vault}:${issueId.toUpperCase()}`;
}

export function markdownLinkSearchKey(vault, query) {
  return `${vault}:${String(query).trim().toLowerCase()}`;
}

// Named external-response gates share the same reset/release lifecycle.
export function setResponseHold(state, operation, held) {
  state.responseHolds.get(operation)?.resolve();
  if (held) state.responseHolds.set(operation, Promise.withResolvers());
  else state.responseHolds.delete(operation);
}

export async function waitForResponseHold(state, operation) {
  const gate = state.responseHolds.get(operation);
  if (!gate) return;
  state.responseHoldPending.set(
    operation,
    (state.responseHoldPending.get(operation) ?? 0) + 1,
  );
  try {
    await gate.promise;
  } finally {
    const pending = (state.responseHoldPending.get(operation) ?? 1) - 1;
    if (pending) state.responseHoldPending.set(operation, pending);
    else state.responseHoldPending.delete(operation);
  }
}

export function setIssueUpdateHold(state, key, held) {
  if (held) state.issueUpdateHolds.set(key, 1);
  else state.issueUpdateHolds.delete(key);
}

export function consumeIssueUpdateHold(state, key) {
  const holds = state.issueUpdateHolds.get(key) ?? 0;
  if (holds <= 0) return false;
  if (holds === 1) state.issueUpdateHolds.delete(key);
  else state.issueUpdateHolds.set(key, holds - 1);
  return true;
}

export function beginIssueUpdateRequest(state, key) {
  state.issueUpdatePending.set(
    key,
    (state.issueUpdatePending.get(key) ?? 0) + 1,
  );
}

export function endIssueUpdateRequest(state, key) {
  const pending = state.issueUpdatePending.get(key) ?? 0;
  if (pending <= 1) state.issueUpdatePending.delete(key);
  else state.issueUpdatePending.set(key, pending - 1);
}

export function beginIssueListRequest(state, key) {
  state.issueListPending.set(key, (state.issueListPending.get(key) ?? 0) + 1);
}

export function endIssueListRequest(state, key) {
  const pending = state.issueListPending.get(key) ?? 0;
  if (pending <= 1) state.issueListPending.delete(key);
  else state.issueListPending.set(key, pending - 1);
}

export function beginIssueReadRequest(state, key) {
  state.issueReadPending.set(key, (state.issueReadPending.get(key) ?? 0) + 1);
}

export function endIssueReadRequest(state, key) {
  const pending = state.issueReadPending.get(key) ?? 0;
  if (pending <= 1) state.issueReadPending.delete(key);
  else state.issueReadPending.set(key, pending - 1);
}

export function beginAttachmentReadRequest(state, key) {
  state.attachmentReadPending.set(
    key,
    (state.attachmentReadPending.get(key) ?? 0) + 1,
  );
}

export function endAttachmentReadRequest(state, key) {
  const pending = state.attachmentReadPending.get(key) ?? 0;
  if (pending <= 1) state.attachmentReadPending.delete(key);
  else state.attachmentReadPending.set(key, pending - 1);
}

export function beginMarkdownLinkSearchRequest(state, key) {
  state.markdownLinkSearchPending.set(
    key,
    (state.markdownLinkSearchPending.get(key) ?? 0) + 1,
  );
}

export function endMarkdownLinkSearchRequest(state, key) {
  const pending = state.markdownLinkSearchPending.get(key) ?? 0;
  if (pending <= 1) state.markdownLinkSearchPending.delete(key);
  else state.markdownLinkSearchPending.set(key, pending - 1);
}

export function waitForIssueUpdateRelease(state, key) {
  return new Promise((resolve) => {
    const waiters = state.issueUpdateReleaseWaiters.get(key) ?? [];
    waiters.push(resolve);
    state.issueUpdateReleaseWaiters.set(key, waiters);
  });
}

export function releaseIssueUpdate(state, key) {
  const waiters = state.issueUpdateReleaseWaiters.get(key);
  const resolve = waiters?.shift();
  if (!resolve) return false;
  if (waiters.length === 0) state.issueUpdateReleaseWaiters.delete(key);
  resolve();
  return true;
}

export function releaseAllIssueUpdateHolds(state) {
  for (const waiters of state.issueUpdateReleaseWaiters.values()) {
    for (const resolve of waiters) resolve();
  }
  state.issueUpdateHolds.clear();
  state.issueUpdateReleaseWaiters.clear();
}

export function waitForAuthProbeRelease(state) {
  return new Promise((resolve) => {
    state.authProbeReleaseWaiters.add(resolve);
  });
}

export function beginAuthProbeHold(state) {
  state.authProbeHoldCount += 1;
}

export function endAuthProbeHold(state) {
  state.authProbeHoldCount = Math.max(0, state.authProbeHoldCount - 1);
}

export async function waitForAuthProbeHold(state) {
  const deadline = Date.now() + 5_000;
  while (state.authProbeHold && state.authProbeHoldCount === 0) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return state.authProbeHoldCount > 0;
}

export function releaseAllAuthProbeHolds(state) {
  const waiters = [...state.authProbeReleaseWaiters];
  state.authProbeReleaseWaiters.clear();
  for (const resolve of waiters) resolve();
  state.authProbeHold = false;
  state.authProbeHoldCount = 0;
  return waiters.length;
}

export function createState(scenario) {
  const alice = {
    id: "user-alice",
    username: fixtureLogin.username,
    email: "alice@example.com",
    display_name: "Alice Example",
    // Multi-vault manager fixtures exercise owner-authorized detail reads.
    is_admin: scenario !== "configured_multi",
  };
  const bob = {
    id: "user-bob",
    username: "bob",
    email: "bob@example.com",
    display_name: "Bob Example",
    is_admin: false,
  };
  const writer = {
    id: "user-writer",
    username: "writer",
    email: "writer@example.com",
    display_name: "Writer Example",
    is_admin: false,
  };
  const token = makeJwt({ sub: alice.id, username: alice.username });
  const state = {
    scenario,
    calls: [],
    users: new Map([
      [alice.username, { ...alice, password: fixtureLogin.password }],
      [bob.username, { ...bob, password: fixtureLogin.password }],
      [writer.username, { ...writer, password: fixtureLogin.password }],
    ]),
    sessions: new Map([[token, alice.username]]),
    loginToken: token,
    vaults: createScenarioVaults(scenario),
    issueListFailure: false,
    issueListFailureStatus: null,
    issueListNextPageFailures: 0,
    responseHolds: new Map(),
    responseHoldPending: new Map(),
    issueReadControls: new Map(),
    issueReadPending: new Map(),
    attachmentReadControls: new Map(),
    attachmentReadPending: new Map(),
    markdownLinkSearchControls: new Map(),
    markdownLinkSearchPending: new Map(),
    assetUploadFailOnce: new Set(),
    assetUploadAttempts: [],
    planningCatalogFailure: false,
    contentSearchMode: "healthy",
    vaultListGate: null,
    releaseVaultList: null,
    vaultListFailures: 0,
    workspaceInitFailureOperation: null,
    workspaceInitFailureRemaining: 0,
    workspaceInitFailureSuccessesBefore: null,
    installationExecutionFailures: new Set(),
    issueUpdateFailures: new Map(),
    issueUpdateHolds: new Map(),
    issueUpdateReleaseWaiters: new Map(),
    issueUpdatePending: new Map(),
    issueListPending: new Map(),
    issueReorderFailures: 0,
    issueUpdateCalls: new Map(),
    sqlCalls: [],
    notificationRoles: new Map(
      scenario === "notifications_personal"
        ? [
            [alice.username, "owner"],
            [bob.username, "reader"],
            [writer.username, "writer"],
          ]
        : [],
    ),
    notificationWorkspaceRoles: new Map(),
    notificationSchemaModes: new Map(),
    notificationDataModes: new Map(),
    installationRoles: new Map(
      scenario === "installation_drift"
        ? [
            [alice.username, "owner"],
            [bob.username, "reader"],
            [writer.username, "writer"],
          ]
        : [],
    ),
    installationLookupModes: new Map(),
    notificationSchemaMode: "healthy",
    notificationDataMode: "healthy",
    notificationStream: {
      clients: new Map(),
      connections: 0,
      active: 0,
      disconnects: 0,
      events: 0,
      checkpoints: 0,
      heartbeats: 0,
      nextCursor: 0,
      failNextConnections: 0,
      eventGapNextConnections: 0,
      eventGapFailures: 0,
      disconnectAfterNextEvent: false,
      lastEventByVault: {},
    },
    accountDenialCode: null,
    authProbeHold: false,
    authProbeHoldCount: 0,
    authProbeReleaseWaiters: new Set(),
    authProbeFailureStatus: null,
    protectedResponse: "healthy",
    commitSeq: 0,
    planningSeq: 10,
    githubRepos: [
      {
        id: 1001,
        full_name: "octo/reef",
        name: "reef",
        owner: { login: "octo" },
        description: "Fixture reef repository",
        updated_at: NOW,
      },
      {
        id: 1002,
        full_name: "octo/reef-mobile",
        name: "reef-mobile",
        owner: { login: "octo" },
        description: "Fixture mobile repository",
        updated_at: NOW,
      },
    ],
  };

  if (scenario === "backlog_bulk_partial_failure") {
    const vault = state.vaults.get(REEF_VAULT);
    const successfulIssue = vault?.issues.find(
      (issue) => issue.reef_id === "REEF-002",
    );
    const failedIssue = vault?.issues.find(
      (issue) => issue.reef_id === "REEF-003",
    );
    if (!successfulIssue || !failedIssue) {
      throw new Error("partial-failure fixture requires two configured issues");
    }
    successfulIssue.status = "backlog";
    successfulIssue.rank = 2000;
    failedIssue.status = "backlog";
    failedIssue.rank = 1000;
    state.issueUpdateFailures.set(
      issueUpdateKey(REEF_VAULT, failedIssue.reef_id),
      "once",
    );
  }
  if (scenario === "assignee_picker") {
    state.issueUpdateFailures.set(
      issueUpdateKey(REEF_VAULT, "REEF-002"),
      "once",
    );
  }

  return state;
}

export function nextCommit(state) {
  state.commitSeq += 1;
  return `e2e-${String(state.commitSeq).padStart(4, "0")}`;
}

export function markdownFixtureStartPath(state) {
  const issue = state.vaults.get(REEF_VAULT)?.issues[0];
  return issue
    ? `/workspace/${REEF_VAULT}/issues/${issue.reef_id}`
    : `/workspace/${REEF_VAULT}/issues`;
}

export function rememberCall(state, method, path) {
  state.calls.push({ method, path });
  if (state.calls.length > 400) state.calls.shift();
}

export function rememberSqlCall(state, vault, username, sql) {
  state.sqlCalls.push({ vault, username, sql });
  if (state.sqlCalls.length > 400) state.sqlCalls.shift();
}

export function roleForVault(vault, state, username) {
  if (state.protectedResponse === "forbidden" && vault.name === REEF_VAULT) {
    return "reader";
  }
  if (state.scenario === "notifications_personal") {
    const scopedRole = state.notificationWorkspaceRoles.get(
      `${vault.name}:${username}`,
    );
    if (scopedRole === "none") return null;
    if (scopedRole) return scopedRole;
    return state.notificationRoles.get(username) ?? vault.role;
  }
  if (state.scenario === "installation_drift") {
    return state.installationRoles.get(username) ?? null;
  }
  return vault.role;
}

export function vaultSummary(vault, state, username) {
  return {
    id: vault.id,
    name: vault.name,
    description: vault.description,
    status: vault.status,
    role: roleForVault(vault, state, username),
    created_at: vault.created_at,
  };
}

export function installationLookupModes(state, vaultName) {
  const modes = state.installationLookupModes.get(vaultName);
  return {
    member_lookup: modes?.member_lookup ?? "healthy",
    detail_lookup: modes?.detail_lookup ?? "healthy",
  };
}

export function installationLookupMode(state, vaultName, lookup) {
  return installationLookupModes(state, vaultName)[lookup];
}

export function publicState(state) {
  return {
    scenario: state.scenario,
    calls: state.calls,
    auth_probe_pending: state.authProbeHoldCount,
    response_hold_pending: Object.fromEntries(state.responseHoldPending),
    sql_calls: state.sqlCalls,
    notification: {
      roles: Object.fromEntries(state.notificationRoles),
      workspace_roles: Object.fromEntries(state.notificationWorkspaceRoles),
      schema_mode: state.notificationSchemaMode,
      data_mode: state.notificationDataMode,
      schema_modes: Object.fromEntries(state.notificationSchemaModes),
      data_modes: Object.fromEntries(state.notificationDataModes),
    },
    notification_stream: {
      connections: state.notificationStream.connections,
      active: state.notificationStream.active,
      disconnects: state.notificationStream.disconnects,
      events: state.notificationStream.events,
      checkpoints: state.notificationStream.checkpoints,
      heartbeats: state.notificationStream.heartbeats,
      fail_next_connections: state.notificationStream.failNextConnections,
      event_gap_next_connections:
        state.notificationStream.eventGapNextConnections,
      event_gap_failures: state.notificationStream.eventGapFailures,
      last_event_by_vault: state.notificationStream.lastEventByVault,
    },
    installation_drift: {
      lookup_modes: Object.fromEntries(
        [...state.vaults.values()]
          .filter((vault) => vault.installation)
          .map((vault) => [
            vault.name,
            installationLookupModes(state, vault.name),
          ]),
      ),
      roles: Object.fromEntries(state.installationRoles),
    },
    issue_update_calls: Object.fromEntries(state.issueUpdateCalls),
    issue_update_pending: Object.fromEntries(state.issueUpdatePending),
    issue_list_pending: Object.fromEntries(state.issueListPending),
    issue_read_pending: Object.fromEntries(state.issueReadPending),
    attachment_read_pending: Object.fromEntries(state.attachmentReadPending),
    markdown_link_search_pending: Object.fromEntries(
      state.markdownLinkSearchPending,
    ),
    asset_upload_attempts: state.assetUploadAttempts,
    workspace_initialization: {
      failure_operation: state.workspaceInitFailureOperation,
      failures_remaining: state.workspaceInitFailureRemaining,
      successes_before_failure: state.workspaceInitFailureSuccessesBefore,
    },
    github_repos: state.githubRepos.map((repo) => ({
      id: repo.id,
      full_name: repo.full_name,
    })),
    vaults: [...state.vaults.values()].map((vault) => ({
      name: vault.name,
      id: vault.id,
      installation: vault.installation
        ? {
            id: vault.installation.id,
            app_id: vault.installation.appId,
            lifecycle: vault.installation.lifecycle,
          }
        : null,
      tables: [...vault.tables],
      settings: Object.fromEntries(vault.settings.entries()),
      monitored_repos: vault.monitoredRepos,
      issue_ids: vault.issues.map((issue) => issue.reef_id),
      issues: vault.issues.map((issue) => ({
        id: issue.reef_id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        assigned_to: issue.assigned_to,
        rank: issue.rank,
        parent_id: issue.parent_id,
        sprint_id: issue.sprint_id,
        milestone_id: issue.milestone_id,
        labels: issue.labels,
      })),
      sprints: vault.sprints,
      milestones: vault.milestones,
      releases: vault.releases,
      templates: vault.templates,
      activity: (vault.activity ?? []).map((item) => ({
        reef_id: item.reef_id,
        event_type: item.event_type,
        payload: item.payload,
      })),
      subscriptions: (vault.subscriptions ?? []).map((item) => ({
        reef_id: item.reef_id,
        subscriber: item.subscriber,
        source: item.source,
        status: item.status,
      })),
      notifications: (vault.notifications ?? []).map((item) => ({
        id: item.id,
        notification_key: item.notification_key,
        recipient: item.recipient,
        reef_id: item.reef_id,
        source_type: item.source_type,
        source_ref: item.source_ref,
        event_type: item.event_type,
        actor: item.actor,
        occurred_at: item.occurred_at,
        state: item.state,
        read_at: item.read_at,
        archived_at: item.archived_at,
      })),
      comments: (vault.comments ?? []).map((comment) => ({
        id: comment.id,
        reef_id: comment.reef_id,
        body: comment.body,
        author: comment.meta?.author ?? null,
        created_at: comment.meta?.created_at ?? null,
        edited_at: comment.meta?.edited_at ?? null,
        mention_recipients: comment.meta?.mention_recipients ?? [],
      })),
      documents: [...vault.documents.values()].map((doc) => ({
        path: doc.path,
        title: doc.title,
        type: doc.type,
        summary: doc.summary,
        content: doc.content,
        tags: doc.tags,
        current_commit: doc.current_commit,
      })),
      files: [...(vault.files ?? new Map()).values()].map((file) => ({
        uri: file.uri,
        filename: file.filename,
        mime_type: file.mimeType,
        confirmed: file.confirmed,
      })),
      assets: [...(vault.assets ?? new Map()).values()].map((asset) => ({
        id: asset.id,
        name: asset.name,
        mime_type: asset.mimeType,
        size_bytes: asset.sizeBytes,
        claimed: asset.claimed,
      })),
    })),
  };
}

export function registerNotificationStreamClient(state, vault, response) {
  const clients = state.notificationStream.clients.get(vault) ?? new Set();
  const client = { response, closed: false, heartbeatTimer: null };
  clients.add(client);
  state.notificationStream.clients.set(vault, clients);
  state.notificationStream.connections += 1;
  state.notificationStream.active += 1;
  const cursor = `notification-${state.notificationStream.nextCursor}`;
  response.write(
    `id: ${cursor}\nevent: checkpoint\ndata: ${JSON.stringify({ version: 1, cursor })}\n\n`,
  );
  state.notificationStream.checkpoints += 1;
  const sendHeartbeat = () => {
    if (client.closed) return;
    response.write(": heartbeat\n\n");
    state.notificationStream.heartbeats += 1;
  };
  sendHeartbeat();
  client.heartbeatTimer = setInterval(sendHeartbeat, 250);

  const cleanup = () => {
    if (client.closed) return;
    client.closed = true;
    if (client.heartbeatTimer) clearInterval(client.heartbeatTimer);
    clients.delete(client);
    if (clients.size === 0) state.notificationStream.clients.delete(vault);
    state.notificationStream.active = Math.max(
      0,
      state.notificationStream.active - 1,
    );
    state.notificationStream.disconnects += 1;
  };
  response.on("close", cleanup);
  return cleanup;
}

export function publishNotificationChange(state, vault, table, operation) {
  if (!["insert", "update", "delete"].includes(operation)) return;
  const clients = state.notificationStream.clients.get(vault);
  if (!clients?.size) return;
  state.notificationStream.nextCursor += 1;
  const cursor = `notification-${state.notificationStream.nextCursor}`;
  const event = {
    version: 1,
    cursor,
    occurred_at: NOW,
    vault,
    kind: "table.rows_changed",
    resource_uri: `akb://${vault}/table/${table}`,
    payload: { operation },
  };
  const wire = `id: ${cursor}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.response.write(wire);
  }
  state.notificationStream.events += 1;
  state.notificationStream.lastEventByVault[vault] = {
    table,
    operation,
    cursor,
  };
  if (state.notificationStream.disconnectAfterNextEvent) {
    state.notificationStream.disconnectAfterNextEvent = false;
    closeNotificationStreams(state);
  }
}

export function closeNotificationStreams(state) {
  for (const clients of state.notificationStream.clients.values()) {
    for (const client of clients) client.response.end();
  }
}
