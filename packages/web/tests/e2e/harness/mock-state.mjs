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
    is_admin: true,
  };
  const bob = {
    id: "user-bob",
    username: "bob",
    email: "bob@example.com",
    display_name: "Bob Example",
    is_admin: false,
  };
  const token = makeJwt({ sub: alice.id, username: alice.username });
  const state = {
    scenario,
    calls: [],
    users: new Map([
      [alice.username, { ...alice, password: fixtureLogin.password }],
      [bob.username, bob],
    ]),
    sessions: new Map([[token, alice.username]]),
    loginToken: token,
    vaults: createScenarioVaults(scenario),
    issueListFailure: false,
    issueListNextPageFailures: 0,
    planningCatalogFailure: false,
    contentSearchMode: "healthy",
    contentSearchDelayMs: 0,
    vaultListDelayMs: 0,
    vaultListFailures: 0,
    issueUpdateFailures: new Map(),
    issueUpdateDelays: new Map(),
    issueUpdateHolds: new Map(),
    issueUpdateReleaseWaiters: new Map(),
    issueUpdatePending: new Map(),
    issueListPending: new Map(),
    issueReorderFailures: 0,
    issueReorderDelayMs: 0,
    issueUpdateCalls: new Map(),
    keycloakEnabled: false,
    localAuthEnabled: true,
    ssoOnly: false,
    accountDenialCode: null,
    authProbeDelayMs: 0,
    authProbeDelayOnce: false,
    authProbeHold: false,
    authProbeHoldCount: 0,
    authProbeReleaseWaiters: new Set(),
    authProbeHang: false,
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

export function vaultSummary(vault, state) {
  return {
    id: vault.id,
    name: vault.name,
    description: vault.description,
    status: vault.status,
    role:
      state.protectedResponse === "forbidden" && vault.name === REEF_VAULT
        ? "reader"
        : vault.role,
    created_at: vault.created_at,
  };
}

export function publicState(state) {
  return {
    scenario: state.scenario,
    calls: state.calls,
    issue_update_calls: Object.fromEntries(state.issueUpdateCalls),
    issue_update_pending: Object.fromEntries(state.issueUpdatePending),
    issue_list_pending: Object.fromEntries(state.issueListPending),
    github_repos: state.githubRepos.map((repo) => ({
      id: repo.id,
      full_name: repo.full_name,
    })),
    vaults: [...state.vaults.values()].map((vault) => ({
      name: vault.name,
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
    })),
  };
}
