import { createHash } from "node:crypto";
import { createServer } from "node:http";
import reefTableManifest from "./reef-table-manifest.json" with {
  type: "json",
};

const PORT = Number(process.env.REEF_E2E_MOCK_PORT ?? 7354);
const HOST = process.env.REEF_E2E_MOCK_HOST ?? "127.0.0.1";
const NOW = "2026-06-15T00:00:00.000Z";
const REEF_VAULT = "reef-e2e";
const TOOL_LOOP_E2E_PROMPT = "tool transparency e2e";
const TOOL_LOOP_SEARCH_ISSUES_CALL_ID = "call_e2e_search_issues";
const TOOL_LOOP_SEARCH_DOCUMENTS_CALL_ID = "call_e2e_search_documents";
const ACCOUNT_DENIAL_CODES = new Set([
  "membership_required",
  "account_suspended",
  "identity_conflict",
]);

// A monotonically-advancing "edit clock". Each issue-row UPDATE stamps an
// `updated_at` strictly later than the seeded `NOW`, mirroring real akb, which
// stamps now() at edit time — always after the fixture's seed timestamp. A
// single static NOW instead ties every row's `updated_at`, collapsing the
// "recently updated" order so an edit never visibly re-sorts the list — hiding
// exactly the sort-staleness fix REEF-325 covers. Deterministic (a pure
// function of an incrementing counter), so runs stay reproducible.
const NOW_MS = Date.parse(NOW);
let editTick = 0;
function nextEditTimestamp() {
  editTick += 1;
  return new Date(NOW_MS + editTick * 1000).toISOString();
}

let state = makeState("configured");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    rememberCall(req.method ?? "GET", url.pathname);

    if (url.pathname === "/__e2e/health") {
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__e2e/reset" && req.method === "POST") {
      const body = await readJson(req);
      state = makeState(normalizeScenario(body?.scenario));
      return json(res, 200, { ok: true, scenario: state.scenario });
    }
    if (url.pathname === "/__e2e/issue-list-failure" && req.method === "POST") {
      const body = await readJson(req);
      state.issueListFailure = body?.enabled === true;
      return json(res, 200, {
        ok: true,
        issue_list_failure: state.issueListFailure,
      });
    }
    if (
      url.pathname === "/__e2e/issue-update-control" &&
      req.method === "POST"
    ) {
      const body = await readJson(req);
      const id = String(body?.id ?? "");
      const mode = body?.mode;
      if (mode === "once" || mode === "always")
        state.issueUpdateFailures.set(id, mode);
      else state.issueUpdateFailures.delete(id);
      return json(res, 200, {
        ok: true,
        id,
        mode: state.issueUpdateFailures.get(id) ?? "clear",
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
    // akb's Keycloak login start. reef-web calls this server-side to begin the
    // hand-off (REEF-312). It is mounted at the bare path, not under /akb,
    // because core resolves the akb-reported login_url ("/api/v1/auth/keycloak/
    // login") against the backend ORIGIN — an absolute path drops the /akb mount
    // prefix this fixture uses (a real akb backend has no path prefix). Mirrors
    // akb's contract: a 3xx with an absolute Location, which reef forwards to the
    // browser. Points back at this fixture's authorize page below.
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
    // Fixture stand-in for the external Keycloak authorize page, so the SSO-first
    // auto-redirect can be exercised end to end: the login start above bounces
    // the browser here.
    if (url.pathname === "/keycloak/authorize") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        '<!doctype html><html><body><main data-testid="fixture-keycloak-authorize"><h1>Keycloak Sign-In (fixture)</h1></main></body></html>',
      );
    }
    if (url.pathname === "/__e2e/state") {
      return json(res, 200, publicState());
    }
    if (url.pathname.startsWith("/akb")) {
      return handleAkb(req, res, url);
    }
    if (url.pathname.startsWith("/openrouter")) {
      return handleOpenRouter(req, res);
    }
    if (url.pathname.startsWith("/github")) {
      return handleGitHub(req, res, url);
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

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `reef e2e fixture server listening on ${HOST}:${PORT}\n`,
  );
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));

function normalizeScenario(value) {
  if (
    value === "empty" ||
    value === "demo_board" ||
    value === "raw_only" ||
    value === "activity_suggestions" ||
    value === "skill_outdated"
  ) {
    return value;
  }
  return "configured";
}

function makeState(scenario) {
  const alice = {
    id: "user-alice",
    username: "alice",
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
  const next = {
    scenario,
    calls: [],
    users: new Map([
      [alice.username, { ...alice, password: "password" }],
      [bob.username, bob],
    ]),
    sessions: new Map([[token, alice.username]]),
    loginToken: token,
    vaults: new Map(),
    issueListFailure: false,
    issueUpdateFailures: new Map(),
    keycloakEnabled: false,
    localAuthEnabled: true,
    ssoOnly: false,
    accountDenialCode: null,
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

  if (
    scenario === "configured" ||
    scenario === "activity_suggestions" ||
    scenario === "skill_outdated"
  ) {
    const vault = configuredVault(REEF_VAULT);
    if (scenario === "activity_suggestions") seedActivitySuggestions(vault);
    if (scenario === "skill_outdated") seedOutdatedVaultSkill(vault);
    next.vaults.set(REEF_VAULT, vault);
    next.vaults.set("raw-vault", rawVault("raw-vault"));
  } else if (scenario === "demo_board") {
    next.vaults.set(REEF_VAULT, demoBoardVault(REEF_VAULT));
    next.vaults.set("raw-vault", rawVault("raw-vault"));
  } else if (scenario === "raw_only") {
    next.vaults.set("raw-vault", rawVault("raw-vault"));
  }

  return next;
}

function configuredVault(name) {
  const sprintId = uuidFor(1);
  const milestoneId = uuidFor(2);
  const releaseId = uuidFor(3);
  const issues = [
    issueRow({
      id: "REEF-001",
      title: "Initial issue Alpha",
      status: "todo",
      priority: "high",
      assigned_to: "alice",
      start_date: "2026-06-10",
      due_date: "2026-06-24",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      labels: ["frontend", "e2e"],
    }),
    issueRow({
      id: "REEF-002",
      title: "Initial issue Beta",
      status: "in_progress",
      priority: "medium",
      assigned_to: null,
      start_date: "2026-06-12",
      due_date: "2026-06-28",
      labels: ["backend"],
    }),
    issueRow({
      id: "REEF-003",
      title: "Backlog issue Gamma",
      status: "backlog",
      priority: "low",
      assigned_to: null,
      rank: 1000,
      labels: ["triage"],
    }),
  ];
  const vault = {
    id: `vault-${name}`,
    name,
    description: "Hermetic reef E2E workspace",
    status: "active",
    role: "owner",
    created_at: NOW,
    tables: new Set([
      "reef_settings",
      "monitored_repos",
      "reef_issues",
      "reef_templates",
      "reef_activity_suggestions",
      "reef_comments",
      "reef_attachments",
      "reef_activity",
      "reef_sprints",
      "reef_milestones",
      "reef_releases",
    ]),
    // ai_scanning_enabled defaults off (REEF-313); the hermetic "configured"
    // workspace turns it on so the scan affordances (manual Refresh, auto-scan)
    // behave like a workspace that has opted into AI activity scanning.
    settings: new Map([
      ["project_prefix", "REEF"],
      ["ai_scanning_enabled", true],
      [
        "schema_version",
        { version: 1, applied_at: "2026-07-22T00:00:00.000Z" },
      ],
    ]),
    monitoredRepos: [],
    issues,
    documents: new Map(),
    members: [
      {
        username: "alice",
        display_name: "Alice Example",
        email: "alice@example.com",
        role: "owner",
        since: NOW,
      },
    ],
    sprints: [
      {
        id: sprintId,
        name: "Sprint Alpha",
        status: "active",
        start_date: "2026-06-01",
        end_date: "2026-06-30",
        goal: "Finish the hermetic E2E spine.",
        capacity_points: 8,
        meta: {},
      },
    ],
    milestones: [
      {
        id: milestoneId,
        name: "Coverage Complete",
        status: "open",
        target_date: "2026-06-30",
        description:
          "Every routed surface is covered or deliberately deferred.",
        meta: {},
      },
    ],
    releases: [
      {
        id: releaseId,
        name: "June E2E",
        status: "in_progress",
        target_date: "2026-06-30",
        released_at: null,
        notes: "Hermetic browser coverage release.",
        meta: {},
      },
    ],
    templates: [],
    activitySuggestions: [],
    attachments: [],
    files: new Map(),
    comments: [
      {
        id: uuidFor(40),
        reef_id: "REEF-001",
        body: "Kicking this off — the `reconcile()` gate needs a look before we wire the write path.",
        meta: {
          author: "bob",
          created_at: "2026-06-16T09:00:00.000Z",
          edited_at: null,
        },
        created_at: "2026-06-16T09:00:00.000Z",
        updated_at: "2026-06-16T09:00:00.000Z",
        created_by: "bob",
      },
      {
        id: uuidFor(41),
        reef_id: "REEF-001",
        body: "Agreed. Verified the workspace schema version before the write.",
        meta: {
          author: "alice",
          created_at: "2026-06-16T10:30:00.000Z",
          edited_at: "2026-06-16T10:45:00.000Z",
        },
        created_at: "2026-06-16T10:30:00.000Z",
        updated_at: "2026-06-16T10:45:00.000Z",
        created_by: "alice",
      },
    ],
    // REEF-277: seeded reef_activity field-change events so the issue timeline
    // renders the full Linear-parity set (title/labels/due/estimate/parent/
    // relation/archive) in the hermetic runtime. Real edits append more rows
    // through the insert handler below.
    activity: [
      activityRow("REEF-001", "title_change", "2026-06-17T08:00:00.000Z", {
        from: "Initial issue Alpha",
        to: "Initial issue Alpha (revised)",
      }),
      activityRow("REEF-001", "labels_change", "2026-06-17T08:05:00.000Z", {
        added: ["backend"],
        removed: ["frontend"],
      }),
      activityRow("REEF-001", "due_date_change", "2026-06-17T08:10:00.000Z", {
        from: null,
        to: "2026-07-15T00:00:00.000Z",
      }),
      activityRow("REEF-001", "estimate_change", "2026-06-17T08:15:00.000Z", {
        from: null,
        to: 5,
      }),
      activityRow("REEF-001", "parent_change", "2026-06-17T08:20:00.000Z", {
        from: null,
        to: "REEF-002",
      }),
      activityRow("REEF-001", "relation_change", "2026-06-17T08:25:00.000Z", {
        relation: "depends_on",
        added: ["REEF-003"],
        removed: [],
      }),
      activityRow("REEF-001", "archived_change", "2026-06-17T08:30:00.000Z", {
        from: false,
        to: true,
      }),
      activityRow("REEF-001", "issue_type_change", "2026-06-17T08:35:00.000Z", {
        from: "story",
        to: "bug",
      }),
      activityRow("REEF-001", "start_date_change", "2026-06-17T08:40:00.000Z", {
        from: null,
        to: "2026-07-21",
      }),
    ],
  };

  seedIssueDocument(vault, "REEF-001", "Alpha description from fixture.");
  seedIssueDocument(vault, "REEF-002", "Beta description from fixture.");
  seedIssueDocument(vault, "REEF-003", "Gamma backlog description.");
  seedReferenceDocument(vault, "docs/spec-overview.md", {
    title: "Spec overview",
    type: "reference",
    summary: "Fixture document cited by Ask AI tool-loop coverage.",
    content:
      "Spec overview for the hermetic Ask AI tool transparency workflow.",
    tags: ["docs", "ask-ai", "e2e"],
  });
  seedInitializationMarker(vault);
  return vault;
}

function seedInitializationMarker(vault) {
  const canonicalRequest = JSON.stringify({
    name: vault.name,
    config: {
      project_prefix: String(vault.settings.get("project_prefix") ?? "REEF"),
      monitored_repos: [...vault.monitoredRepos].sort(
        (left, right) =>
          left.github_id - right.github_id ||
          left.owner.localeCompare(right.owner) ||
          left.name.localeCompare(right.name),
      ),
      authoring_language: vault.settings.get("authoring_language") ?? null,
      stale_hide_completed_days:
        vault.settings.get("stale_hide_completed_days") ?? 28,
      stale_hide_canceled_days:
        vault.settings.get("stale_hide_canceled_days") ?? 7,
      ai_scanning_enabled: vault.settings.get("ai_scanning_enabled") === true,
    },
  });
  const requestFingerprint = createHash("sha256")
    .update(canonicalRequest)
    .digest("hex");
  const path = "overview/reef-initialization.md";
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title: "Reef workspace initialization",
    type: "reference",
    status: "active",
    summary: "Durable Reef workspace initialization state",
    content: `${JSON.stringify({
      schema_version: 1,
      state: "ready",
      request_fingerprint: requestFingerprint,
    })}\n`,
    tags: ["reef:initialization"],
    created_at: NOW,
    updated_at: NOW,
    current_commit: "e2e-seed-reef-initialization",
  });
}

function demoBoardVault(name) {
  const sprintId = uuidFor(101);
  const milestoneId = uuidFor(102);
  const releaseId = uuidFor(103);
  const vault = configuredVault(name);
  const issues = [
    issueRow({
      id: "REEF-101",
      title: "Triage GitHub activity into draft issues",
      status: "todo",
      issue_type: "story",
      priority: "critical",
      assigned_to: "alice",
      start_date: "2026-06-16",
      due_date: "2026-06-21",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 5,
      labels: ["activity", "ai", "github"],
    }),
    issueRow({
      id: "REEF-102",
      title: "Polish onboarding for existing AKB workspaces",
      status: "todo",
      issue_type: "task",
      priority: "high",
      assigned_to: "alice",
      start_date: "2026-06-17",
      due_date: "2026-06-24",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 3,
      // REEF-270: a parent chain REEF-101 → REEF-102 → REEF-103 gives the drill
      // navigation hermetic spec a sub-issue / breadcrumb path to walk.
      parent_id: "REEF-101",
      labels: ["onboarding", "workspace"],
    }),
    issueRow({
      id: "REEF-103",
      title: "Add saved filters for stakeholder reports",
      status: "todo",
      issue_type: "task",
      priority: "medium",
      assigned_to: null,
      due_date: "2026-06-27",
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      parent_id: "REEF-102",
      labels: ["reports"],
    }),
    issueRow({
      id: "REEF-104",
      title: "Wire board filters into shareable URL state",
      status: "in_progress",
      issue_type: "task",
      priority: "high",
      assigned_to: "alice",
      start_date: "2026-06-14",
      due_date: "2026-06-20",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 3,
      labels: ["board", "filters"],
    }),
    issueRow({
      id: "REEF-105",
      title: "Stream grounded Ask AI answers from core",
      status: "in_progress",
      issue_type: "story",
      priority: "critical",
      assigned_to: "alice",
      start_date: "2026-06-13",
      due_date: "2026-06-23",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 5,
      labels: ["ask-ai", "streaming"],
      depends_on: ["REEF-104"],
    }),
    issueRow({
      id: "REEF-106",
      title: "Review activity-scan status proposals",
      status: "in_review",
      issue_type: "task",
      priority: "high",
      assigned_to: "alice",
      start_date: "2026-06-12",
      due_date: "2026-06-18",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      labels: ["activity", "review"],
    }),
    issueRow({
      id: "REEF-107",
      title: "Validate planning context on issue cards",
      status: "in_review",
      issue_type: "task",
      priority: "medium",
      assigned_to: null,
      start_date: "2026-06-11",
      due_date: "2026-06-19",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      labels: ["planning", "kanban"],
    }),
    issueRow({
      id: "REEF-108",
      title: "Ship stateless BFF route handlers",
      status: "done",
      issue_type: "story",
      priority: "high",
      assigned_to: "alice",
      start_date: "2026-06-04",
      due_date: "2026-06-12",
      sprint_id: sprintId,
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 5,
      labels: ["bff", "api"],
    }),
    issueRow({
      id: "REEF-109",
      title: "Document the AKB issue storage contract",
      status: "done",
      issue_type: "task",
      priority: "medium",
      assigned_to: null,
      start_date: "2026-06-05",
      due_date: "2026-06-13",
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 2,
      labels: ["docs", "akb"],
    }),
    issueRow({
      id: "REEF-110",
      title: "Retire legacy local issue mocks",
      status: "closed",
      issue_type: "chore",
      priority: "low",
      assigned_to: "alice",
      start_date: "2026-06-01",
      due_date: "2026-06-08",
      release_id: releaseId,
      estimate_points: 1,
      closed_at: "2026-06-10T10:30:00.000Z",
      closed_reason: "completed",
      labels: ["cleanup"],
    }),
    issueRow({
      id: "REEF-111",
      title: "Archive the old OpenRouter settings spike",
      status: "closed",
      issue_type: "spike",
      priority: "medium",
      assigned_to: null,
      start_date: "2026-06-02",
      due_date: "2026-06-09",
      milestone_id: milestoneId,
      release_id: releaseId,
      estimate_points: 1,
      closed_at: "2026-06-11T15:45:00.000Z",
      closed_reason: "completed",
      labels: ["settings", "llm"],
    }),
    issueRow({
      id: "REEF-112",
      title: "Prioritize mobile board density",
      status: "backlog",
      issue_type: "task",
      priority: "low",
      assigned_to: null,
      rank: 1000,
      labels: ["mobile", "board"],
    }),
  ];

  vault.description = "Demo reef workspace";
  vault.issues = issues;
  vault.documents = new Map();
  vault.sprints = [
    {
      id: sprintId,
      name: "Launch Readiness Sprint",
      status: "active",
      start_date: "2026-06-15",
      end_date: "2026-06-28",
      goal: "Prepare the AKB-backed issue workflow for a public demo.",
      capacity_points: 28,
      meta: {},
    },
  ];
  vault.milestones = [
    {
      id: milestoneId,
      name: "Agentic PM Preview",
      status: "open",
      target_date: "2026-06-30",
      description: "Show reviewable AI workflows across issues and reports.",
      meta: {},
    },
  ];
  vault.releases = [
    {
      id: releaseId,
      name: "reef 0.5 Demo",
      status: "in_progress",
      target_date: "2026-06-30",
      released_at: null,
      notes: "Public demo build for the README preview.",
      meta: {},
    },
  ];

  for (const issue of issues) {
    seedIssueDocument(
      vault,
      issue.reef_id,
      `## Demo note\n\n${issue.title} is part of the English README demo board.`,
    );
  }
  seedDemoBoardActivitySuggestions(vault);
  seedInitializationMarker(vault);
  return vault;
}

function rawVault(name) {
  return {
    id: `vault-${name}`,
    name,
    description: "Raw akb vault",
    status: "active",
    role: "owner",
    created_at: NOW,
    tables: new Set(),
    settings: new Map(),
    monitoredRepos: [],
    issues: [],
    documents: new Map(),
    members: [],
    sprints: [],
    milestones: [],
    releases: [],
    templates: [],
    activitySuggestions: [],
    attachments: [],
    files: new Map(),
  };
}

// Append-only id sequence for reef_activity rows (seeded + runtime-inserted).
let activitySeq = 5000;

/** Build a seeded reef_activity row (REEF-277). `at` is unique per event so it
 * doubles as a stable id seed and a sufficient event_key for dedup. */
function activityRow(reefId, eventType, at, payload) {
  return {
    id: uuidFor(at.replace(/\D/g, "").slice(-12)),
    reef_id: reefId,
    event_type: eventType,
    event_key: `${eventType}@${at}`,
    payload,
    meta: { actor: "alice", at, source: null },
    created_at: at,
    updated_at: at,
    created_by: "alice",
  };
}

function issueRow(input) {
  return {
    document_uri: issueDocumentUri(REEF_VAULT, input.id),
    reef_id: input.id,
    title: input.title,
    status: input.status,
    issue_type: input.issue_type ?? "task",
    priority: input.priority ?? null,
    assigned_to: input.assigned_to ?? null,
    requester: input.requester ?? "alice",
    reporter: input.reporter ?? "alice",
    start_date: input.start_date ?? null,
    due_date: input.due_date ?? null,
    milestone_id: input.milestone_id ?? null,
    sprint_id: input.sprint_id ?? null,
    release_id: input.release_id ?? null,
    estimate_points: input.estimate_points ?? null,
    severity: input.severity ?? null,
    rank: input.rank ?? null,
    closed_at: input.closed_at ?? null,
    closed_reason: input.closed_reason ?? null,
    parent_id: input.parent_id ?? null,
    labels: input.labels ?? [],
    depends_on: input.depends_on ?? [],
    related_to: input.related_to ?? [],
    blocks: input.blocks ?? [],
    archived_at: input.archived_at ?? null,
    created_at: NOW,
    updated_at: NOW,
    meta: {
      author: input.author ?? "alice",
      last_editor: input.last_editor ?? "alice",
      source: input.source ?? "e2e:fixture",
      last_status_change: input.last_status_change ?? null,
      external_refs: input.external_refs ?? null,
      implementation_refs: input.implementation_refs ?? null,
      watchers: null,
      reviewers: null,
      qa_owner: null,
      custom_fields: null,
    },
  };
}

async function handleAkb(req, res, url) {
  const path = url.pathname.slice("/akb".length);

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

  const username = requireAkbAuth(req, res);
  if (!username) return;
  if (state.accountDenialCode) {
    return accountDenialResponse(res, state.accountDenialCode);
  }
  const user = state.users.get(username);

  if (path === "/api/v1/auth/me" && req.method === "GET") {
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
    return json(res, 200, {
      vaults: [...state.vaults.values()].map(vaultSummary),
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
    const vault = getVault(decodeURIComponent(membersMatch[1]), res);
    if (!vault) return;
    return json(res, 200, { members: vault.members });
  }

  const grantMatch = path.match(/^\/api\/v1\/vaults\/([^/]+)\/grant$/);
  if (grantMatch && req.method === "POST") {
    const vault = getVault(decodeURIComponent(grantMatch[1]), res);
    if (!vault) return;
    const body = await readJson(req);
    const user = String(body?.user ?? "");
    const role = String(body?.role ?? "");
    vault.members = vault.members.filter((member) => member.username !== user);
    vault.members.push({ username: user, role, since: NOW });
    return json(res, 200, { vault: vault.name, user, role, granted: true });
  }

  if (path === "/api/v1/files" && req.method === "POST") {
    const form = await readMultipartForm(req);
    const vault = getVault(String(form.fields.vault ?? ""), res);
    if (!vault) return;
    const file = form.files.file;
    if (!file) return json(res, 422, { error: "missing file" });
    if (!vault.files) vault.files = new Map();
    const fileId = `file-${vault.files.size + 1}`;
    const collection = String(form.fields.collection ?? "files")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const filename = file.filename || "attachment";
    const mimeType = file.contentType || "application/octet-stream";
    const uri = `akb://${vault.name}/${collection}/file/${fileId}`;
    vault.files.set(fileId, {
      id: fileId,
      uri,
      filename,
      mimeType,
      sizeBytes: file.body.length,
      body: file.body,
    });
    return json(res, 200, {
      uri,
      filename,
      mime_type: mimeType,
      size_bytes: file.body.length,
    });
  }

  const fileMatch = path.match(/^\/api\/v1\/files\/([^/]+)\/([^/]+)$/);
  if (fileMatch && req.method === "DELETE") {
    const vault = getVault(decodeURIComponent(fileMatch[1]), res);
    if (!vault) return;
    vault.files?.delete(decodeURIComponent(fileMatch[2]));
    return json(res, 200, { deleted: true });
  }
  if (fileMatch && req.method === "GET") {
    const vault = getVault(decodeURIComponent(fileMatch[1]), res);
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
    const vault = getVault(decodeURIComponent(tablesMatch[1]), res);
    if (!vault) return;
    return json(res, 200, {
      kind: "table",
      vault: vault.name,
      items: [...vault.tables].map((name) => ({
        name,
        columns: reefTableManifest[name],
      })),
    });
  }
  if (tablesMatch && req.method === "POST") {
    const vault = getVault(decodeURIComponent(tablesMatch[1]), res);
    if (!vault) return;
    const body = await readJson(req);
    if (typeof body?.name === "string") {
      vault.tables.add(body.name);
      if (Array.isArray(body.columns)) {
        reefTableManifest[body.name] = body.columns;
      }
    }
    return json(res, 200, { ok: true });
  }

  const tableDeleteMatch = path.match(/^\/api\/v1\/tables\/([^/]+)\/([^/]+)$/);
  if (tableDeleteMatch && req.method === "DELETE") {
    // Drop a single table (REEF-322 detach). The `/sql` sub-route is POST, so it
    // never collides with this DELETE. Idempotent on a missing table.
    const vault = getVault(decodeURIComponent(tableDeleteMatch[1]), res);
    if (!vault) return;
    vault.tables.delete(decodeURIComponent(tableDeleteMatch[2]));
    return json(res, 200, { deleted: true });
  }

  const sqlMatch = path.match(/^\/api\/v1\/tables\/([^/]+)\/sql$/);
  if (sqlMatch && req.method === "POST") {
    const vault = getVault(decodeURIComponent(sqlMatch[1]), res);
    if (!vault) return;
    const body = await readJson(req);
    return json(res, 200, handleSql(vault, String(body?.sql ?? "")));
  }

  if (path === "/api/v1/documents" && req.method === "POST") {
    const body = await readJson(req);
    const vault = getVault(String(body?.vault ?? ""), res);
    if (!vault) return;
    const stored = putDocument(vault, body);
    return json(res, 200, documentPutResponse(vault, stored));
  }

  const docMatch = path.match(/^\/api\/v1\/documents\/([^/]+)\/(.+)$/);
  if (docMatch) {
    const vault = getVault(decodeURIComponent(docMatch[1]), res);
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
        current_commit: nextCommit(),
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
    const vault = getVault(decodeURIComponent(collectionDeleteMatch[1]), res);
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
    const vault = getVault(url.searchParams.get("vault") ?? REEF_VAULT, res);
    if (!vault) return;
    if (isToolLoopSearch(url)) await sleep(350);
    return json(res, 200, { results: searchVaultDocuments(vault, url) });
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

function handleSql(vault, sql) {
  const normalized = sql.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  for (const table of tableNamesInSql(lower)) {
    if (!vault.tables.has(table)) {
      return { error: `relation "${table}" does not exist` };
    }
  }

  if (!vault.comments) vault.comments = [];
  if (!vault.attachments) vault.attachments = [];
  if (!vault.activity) vault.activity = [];

  if (lower.startsWith("select key, value from reef_settings")) {
    return tableQuery(["key", "value"], settingsRows(vault, normalized));
  }
  if (lower.startsWith("select value from reef_settings")) {
    return tableQuery(
      ["value"],
      settingsRows(vault, normalized).map(({ value }) => ({ value })),
    );
  }
  if (lower.startsWith("delete from reef_settings")) {
    const key = firstSqlString(normalized);
    if (key) vault.settings.delete(key);
    return tableSql();
  }
  if (lower.startsWith("insert into reef_settings")) {
    const insert = parseInsert(normalized);
    if (insert) {
      const row = objectFromColumns(insert.columns, insert.values);
      if (typeof row.key === "string") vault.settings.set(row.key, row.value);
    }
    return tableSql();
  }

  if (
    lower.startsWith(
      "select github_id, owner, name, description from monitored_repos",
    )
  ) {
    return tableQuery(
      ["github_id", "owner", "name", "description"],
      vault.monitoredRepos,
    );
  }
  if (lower.startsWith("delete from monitored_repos")) {
    vault.monitoredRepos = [];
    return tableSql();
  }
  if (lower.startsWith("insert into monitored_repos")) {
    const insert = parseInsert(normalized);
    if (insert) {
      for (const values of insert.valueRows) {
        const row = objectFromColumns(insert.columns, values);
        vault.monitoredRepos.push({
          github_id: Number(row.github_id),
          owner: String(row.owner),
          name: String(row.name),
          description:
            row.description == null ? undefined : String(row.description),
        });
      }
    }
    return tableSql();
  }

  if (
    lower.startsWith(
      'select "reef_id", "status", "depends_on" from reef_issues',
    )
  ) {
    return tableQuery(
      ["reef_id", "status", "depends_on"],
      vault.issues.map((row) => ({
        reef_id: row.reef_id,
        status: row.status,
        depends_on: row.depends_on,
      })),
    );
  }
  if (lower.startsWith("select * from reef_issues")) {
    if (state.issueListFailure) {
      return { error: "e2e forced issue list failure" };
    }
    const rows = applyLimit(
      sortIssueRows(filterIssueRows(vault.issues, normalized, vault), lower),
      normalized,
    );
    return tableQuery(Object.keys(vault.issues[0] ?? {}), rows);
  }
  if (lower.startsWith("select reef_id from reef_issues")) {
    return tableQuery(
      ["reef_id"],
      vault.issues.map((row) => ({ reef_id: row.reef_id })),
    );
  }
  if (lower.startsWith("insert into reef_issues")) {
    const insert = parseInsert(normalized);
    if (insert) {
      const row = objectFromColumns(insert.columns, insert.values);
      if (
        row.status === "backlog" &&
        (row.rank == null ||
          String(row.rank).toLowerCase().includes("select coalesce"))
      ) {
        row.rank = nextBacklogRank(vault);
      }
      row.created_at = row.created_at ?? NOW;
      row.updated_at = row.updated_at ?? NOW;
      vault.issues.push(row);
    }
    return tableSql();
  }
  if (lower.startsWith("update reef_issues")) {
    const update = parseUpdate(normalized);
    if (update) {
      const id = matchSqlString(
        normalized,
        /where "?reef_id"?\s*=\s*'([^']+)'/i,
      );
      const failureMode = state.issueUpdateFailures.get(id);
      if (failureMode) {
        if (failureMode === "once") state.issueUpdateFailures.delete(id);
        return { error: `e2e forced issue update failure for ${id}` };
      }
      const row = vault.issues.find((issue) => issue.reef_id === id);
      if (row) {
        Object.assign(row, update.values, { updated_at: nextEditTimestamp() });
        if (
          row.status === "backlog" &&
          (row.rank == null || String(row.rank).includes("select coalesce"))
        ) {
          row.rank = nextBacklogRank(vault);
        }
      }
    }
    return tableSql();
  }
  if (lower.startsWith("delete from reef_issues")) {
    const id = matchSqlString(normalized, /where "?reef_id"?\s*=\s*'([^']+)'/i);
    vault.issues = vault.issues.filter((issue) => issue.reef_id !== id);
    return tableSql();
  }

  if (lower.startsWith("select * from reef_templates")) {
    return tableQuery(
      templateColumns(),
      filterTemplates(vault.templates, normalized),
    );
  }
  if (lower.startsWith("insert into reef_templates")) {
    const insert = parseInsert(normalized);
    if (insert) {
      vault.templates.push(objectFromColumns(insert.columns, insert.values));
    }
    return tableSql();
  }
  if (lower.startsWith("update reef_templates")) {
    const update = parseUpdate(normalized);
    const name = matchSqlString(normalized, /where "?name"?\s*=\s*'([^']+)'/i);
    const row = vault.templates.find((template) => template.name === name);
    if (row && update) Object.assign(row, update.values);
    return tableSql();
  }
  if (lower.startsWith("delete from reef_templates")) {
    const name = matchSqlString(normalized, /where "?name"?\s*=\s*'([^']+)'/i);
    vault.templates = vault.templates.filter(
      (template) => template.name !== name,
    );
    return tableSql();
  }

  for (const table of ["reef_sprints", "reef_milestones", "reef_releases"]) {
    if (lower.startsWith(`select * from ${table}`)) {
      return tableQuery(
        planningColumns(table),
        selectPlanningRows(vault, table, normalized),
      );
    }
    if (lower.includes(`insert into ${table}`)) {
      const insert = parseInsert(normalized);
      if (!insert) return tableQuery([], []);
      const row = objectFromColumns(insert.columns, insert.values);
      row.id = uuidFor(++state.planningSeq);
      row.meta = row.meta ?? {};
      planningRows(vault, table).push(row);
      return tableQuery(planningColumns(table), [row]);
    }
    if (lower.startsWith(`update ${table}`)) {
      const update = parseUpdate(normalized);
      const id = matchSqlString(normalized, /where "?id"?\s*=\s*'([^']+)'/i);
      const row = planningRows(vault, table).find((item) => item.id === id);
      if (row && update) Object.assign(row, update.values);
      return tableSql();
    }
    if (lower.startsWith(`delete from ${table}`)) {
      const id = matchSqlString(normalized, /where "?id"?\s*=\s*'([^']+)'/i);
      const rows = planningRows(vault, table);
      const index = rows.findIndex((item) => item.id === id);
      if (index >= 0) rows.splice(index, 1);
      return tableSql();
    }
  }

  if (lower.startsWith("select * from reef_activity_suggestions")) {
    const rows = filterActivityRows(vault.activitySuggestions, normalized);
    return tableQuery(activityColumns(), rows);
  }
  if (lower.startsWith("insert into reef_activity_suggestions")) {
    const insert = parseInsert(normalized);
    if (insert) {
      vault.activitySuggestions.push(
        objectFromColumns(insert.columns, insert.values),
      );
    }
    return tableSql();
  }
  if (lower.startsWith("update reef_activity_suggestions")) {
    const update = parseUpdate(normalized);
    const id = matchSqlString(
      normalized,
      /where "?suggestion_id"?\s*=\s*'([^']+)'/i,
    );
    const row = vault.activitySuggestions.find(
      (item) => item.suggestion_id === id,
    );
    if (row && update) Object.assign(row, update.values);
    return tableSql();
  }

  if (lower.startsWith("select * from reef_comments")) {
    const reefId = matchSqlString(normalized, /reef_id\s*=\s*'([^']+)'/i);
    const rows = vault.comments.filter(
      (comment) => !reefId || comment.reef_id === reefId,
    );
    return tableQuery(commentColumns(), rows);
  }
  if (lower.includes("insert into reef_comments")) {
    if (lower.includes("target_issue as")) {
      const values = sqlValues(normalized);
      const reefId = values[0] ?? null;
      if (!reefId || !vault.issues.some((issue) => issue.reef_id === reefId)) {
        return tableQuery(commentColumns(), []);
      }
      const parentId = matchSqlString(
        normalized,
        /direct_parent\s+as\s*\(select \* from reef_comments where id\s*=\s*'((?:''|[^'])+)'/i,
      );
      let body;
      let meta;
      if (parentId) {
        const parent = vault.comments.find(
          (comment) => comment.id === parentId && comment.reef_id === reefId,
        );
        const rootId = parent?.meta?.thread_root_id ?? parent?.id ?? null;
        const root = vault.comments.find(
          (comment) =>
            comment.id === rootId &&
            comment.reef_id === reefId &&
            comment.meta?.parent_comment_id == null &&
            comment.meta?.thread_root_id == null,
        );
        let cursor = parent;
        let validParent = !!parent && !!root;
        const seen = new Set();
        while (validParent && cursor) {
          if (seen.has(cursor.id) || seen.size >= 100) {
            validParent = false;
            break;
          }
          seen.add(cursor.id);
          if (cursor.id === root.id) {
            validParent =
              cursor.meta?.parent_comment_id == null &&
              cursor.meta?.thread_root_id == null;
            break;
          }
          if (
            cursor.meta?.parent_comment_id == null ||
            cursor.meta?.thread_root_id !== root.id
          ) {
            validParent = false;
            break;
          }
          cursor = vault.comments.find(
            (comment) =>
              comment.id === cursor.meta.parent_comment_id &&
              comment.reef_id === reefId,
          );
          if (!cursor) validParent = false;
        }
        if (!validParent) return tableQuery(commentColumns(), []);
        body = matchSqlString(
          normalized,
          /select target_issue\.reef_id,\s*'((?:''|[^'])*)',\s*jsonb_build_object/i,
        );
        const author = matchSqlString(
          normalized,
          /'author',\s*'((?:''|[^'])*)'/i,
        );
        const createdAt = matchSqlString(
          normalized,
          /'created_at',\s*'((?:''|[^'])*)'/i,
        );
        meta = {
          author,
          created_at: createdAt,
          edited_at: null,
          parent_comment_id: parent.id,
          thread_root_id: root.id,
        };
      } else {
        body = values[2] ?? null;
        try {
          meta = JSON.parse(values[3] ?? "null");
        } catch {
          meta = null;
        }
      }
      if (typeof body !== "string" || !meta) {
        return tableQuery(commentColumns(), []);
      }
      const row = {
        id: uuidFor(2000 + (vault.comments?.length ?? 0)),
        reef_id: reefId,
        body,
        meta,
        created_at: NOW,
        updated_at: NOW,
        created_by: meta.author ?? "alice",
      };
      vault.comments.push(row);
      return tableQuery(commentColumns(), [row]);
    }
    const insert = parseInsert(normalized);
    if (!insert) return tableQuery([], []);
    const row = objectFromColumns(insert.columns, insert.values);
    row.id = uuidFor(2000 + (vault.comments?.length ?? 0));
    row.created_at = NOW;
    row.updated_at = NOW;
    row.created_by = row.meta?.author ?? "alice";
    vault.comments.push(row);
    return tableQuery(commentColumns(), [row]);
  }
  if (lower.includes("update reef_comments")) {
    const id = matchSqlString(normalized, /where\s+id\s*=\s*'([^']+)'/i);
    const reefId = matchSqlString(normalized, /reef_id\s*=\s*'([^']+)'/i);
    const author = matchSqlString(
      normalized,
      /meta->>'author'\s*=\s*'([^']+)'/i,
    );
    const update = parseUpdate(normalized);
    const row = vault.comments.find(
      (comment) =>
        comment.id === id &&
        (!reefId || comment.reef_id === reefId) &&
        (!author || comment.meta?.author === author),
    );
    if (!row) return tableQuery([], []);
    if (update && typeof update.values.body === "string") {
      row.body = update.values.body;
    }
    row.meta = { ...(row.meta ?? {}), edited_at: NOW };
    row.updated_at = NOW;
    return tableQuery(commentColumns(), [row]);
  }

  if (lower.startsWith("select distinct file_uri from reef_attachments")) {
    const rows = [
      ...new Set(
        filterAttachmentRows(vault.attachments, normalized)
          .map((row) => row.file_uri)
          .filter((uri) => typeof uri === "string" && uri.length > 0),
      ),
    ].map((file_uri) => ({ file_uri }));
    return tableQuery(["file_uri"], rows);
  }
  if (lower.startsWith("select * from reef_attachments")) {
    const rows = filterAttachmentRows(vault.attachments, normalized).sort(
      (a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
        String(a.id ?? "").localeCompare(String(b.id ?? "")),
    );
    return tableQuery(attachmentColumns(), applyLimit(rows, normalized));
  }
  if (lower.includes("insert into reef_attachments")) {
    const insert = parseInsert(normalized);
    if (!insert) return tableQuery([], []);
    const row = objectFromColumns(insert.columns, insert.values);
    row.id = row.id ?? uuidFor(9000 + (vault.attachments?.length ?? 0));
    row.created_at = row.created_at ?? NOW;
    row.inline =
      row.inline === true || String(row.inline).toLowerCase() === "true";
    row.meta = row.meta ?? null;
    row.original_jira_attachment_id = row.original_jira_attachment_id ?? null;
    vault.attachments.push(row);
    return tableQuery(attachmentColumns(), [row]);
  }

  // REEF-277: the issue activity timeline (reef_activity), distinct from the
  // activity-scan inbox (reef_activity_suggestions) handled above.
  if (lower.startsWith("select * from reef_activity where")) {
    const reefId = matchSqlString(normalized, /reef_id\s*=\s*'([^']+)'/i);
    const rows = vault.activity
      .filter((event) => !reefId || event.reef_id === reefId)
      .sort((a, b) =>
        String(a.meta?.at ?? "").localeCompare(String(b.meta?.at ?? "")),
      );
    return tableQuery(activityTimelineColumns(), rows);
  }
  // The producer's conditional append: INSERT INTO reef_activity (cols)
  // SELECT <values> WHERE NOT EXISTS (...) RETURNING id. Idempotent on
  // (reef_id, event_key), mirroring the real NOT EXISTS guard.
  if (lower.startsWith("insert into reef_activity ")) {
    const parsed = parseConditionalInsert(normalized);
    if (!parsed) return tableQuery(["id"], []);
    const row = objectFromColumns(parsed.columns, parsed.values);
    const duplicate = vault.activity.some(
      (event) =>
        event.reef_id === row.reef_id && event.event_key === row.event_key,
    );
    if (duplicate) return tableQuery(["id"], []);
    row.id = uuidFor(activitySeq++);
    row.created_at = NOW;
    row.updated_at = NOW;
    row.created_by = row.meta?.actor ?? "alice";
    vault.activity.push(row);
    return tableQuery(["id"], [{ id: row.id }]);
  }

  return tableQuery([], []);
}

/** Columns a reef_activity timeline row exposes (mirrors the akb row shape). */
function activityTimelineColumns() {
  return [
    "id",
    "reef_id",
    "event_type",
    "event_key",
    "payload",
    "meta",
    "created_at",
    "updated_at",
    "created_by",
  ];
}

/**
 * Parse the producer's conditional append (REEF-277):
 *   INSERT INTO reef_activity (cols) SELECT <values> WHERE NOT EXISTS (...)
 * Returns the column list and the SELECT-projected values, or null on a shape
 * this mock does not model.
 */
function parseConditionalInsert(sql) {
  const columnsStart = sql.indexOf("(");
  if (columnsStart < 0) return null;
  const columnsEnd = findMatchingParen(sql, columnsStart);
  const columns = splitSqlCsv(sql.slice(columnsStart + 1, columnsEnd)).map(
    normalizeColumn,
  );
  const selectMatch = sql.slice(columnsEnd).match(/\bselect\b/i);
  if (!selectMatch || selectMatch.index == null) return null;
  const selectStart = columnsEnd + selectMatch.index + selectMatch[0].length;
  const whereIdx = sql.toLowerCase().indexOf(" where not exists", selectStart);
  const valuesText = sql.slice(
    selectStart,
    whereIdx >= 0 ? whereIdx : undefined,
  );
  const values = splitSqlCsv(valuesText).map(parseSqlValue);
  if (values.length !== columns.length) return null;
  return { columns, values };
}

function commentColumns() {
  return [
    "id",
    "reef_id",
    "body",
    "meta",
    "created_at",
    "updated_at",
    "created_by",
  ];
}

function attachmentColumns() {
  return [
    "id",
    "reef_id",
    "file_uri",
    "filename",
    "mime_type",
    "size_bytes",
    "author",
    "created_at",
    "source",
    "inline",
    "original_jira_attachment_id",
    "meta",
  ];
}

function settingsRows(vault, sql) {
  const rows = [...vault.settings.entries()].map(([key, value]) => ({
    key,
    value: JSON.stringify(value),
  }));
  if (sql.includes(" key IN ")) {
    const wanted = sqlValues(sql);
    return rows.filter((row) => wanted.includes(row.key));
  }
  if (sql.includes(" WHERE key = ")) {
    const key = firstSqlString(sql);
    return rows.filter((row) => row.key === key);
  }
  return rows;
}

function sortIssueRows(rows, lowerSql) {
  const out = [...rows];
  if (lowerSql.includes("order by") && lowerSql.includes("rank")) {
    out.sort((a, b) => numericSort(a.rank, b.rank) || idDesc(a, b));
  } else if (lowerSql.includes("order by") && lowerSql.includes("priority")) {
    const weight = new Map([
      ["critical", 5],
      ["high", 4],
      ["medium", 3],
      ["low", 2],
    ]);
    out.sort(
      (a, b) =>
        (weight.get(b.priority) ?? 0) - (weight.get(a.priority) ?? 0) ||
        idDesc(a, b),
    );
  } else if (lowerSql.includes("order by") && lowerSql.includes("updated_at")) {
    out.sort((a, b) => stringDesc(a.updated_at, b.updated_at) || idDesc(a, b));
  } else if (lowerSql.includes("order by") && lowerSql.includes("created_at")) {
    out.sort((a, b) => stringDesc(a.created_at, b.created_at) || idDesc(a, b));
  }
  return out;
}

/**
 * Emulate akb's evaluation of the folded default-view landing query (REEF-324),
 * which packs the active-sprint pick and the My-Issues existence test into one
 * `SELECT * FROM reef_issues`. The naive per-column matchers in
 * `filterIssueRows` would otherwise be fooled by the `status = 'active'` inside
 * the active-sprint subquery (a sprint status, never an issue status) and treat
 * the actor in the EXISTS probe as a plain filter, so this branch resolves the
 * scope the way Postgres would: floor → My Issues iff the actor has any active
 * issue, else the active sprint, else the floor alone.
 */
function defaultViewRows(rows, sql, vault) {
  const inMatch = sql.match(/"?status"?\s+IN\s+\(([^)]*)\)/i);
  const floorStatuses = inMatch ? sqlValues(inMatch[1]) : [];
  const floorRows = rows.filter(
    (row) => row.archived_at == null && floorStatuses.includes(row.status),
  );
  // The actor appears (identically) in the EXISTS probe and the My-Issues arm;
  // the no-actor fold carries no `assigned_to` clause at all.
  const actor = matchSqlString(sql, /"assigned_to"\s*=\s*'([^']+)'/i);
  if (actor && floorRows.some((row) => row.assigned_to === actor)) {
    return floorRows.filter((row) => row.assigned_to === actor);
  }
  const sprintId = activeSprintId(vault);
  return sprintId
    ? floorRows.filter((row) => row.sprint_id === sprintId)
    : floorRows;
}

/** The active sprint's id, mirroring core's `activeSprintIdSubquery` tie-break. */
function activeSprintId(vault) {
  const active = (vault.sprints ?? []).filter((s) => s.status === "active");
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const sa = a.start_date ?? "";
    const sb = b.start_date ?? "";
    if (sa !== sb) return sa < sb ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  return active[0].id;
}

function filterIssueRows(rows, sql, vault) {
  // REEF-324: the default-view landing folds the active-sprint pick and the
  // My-Issues existence test into a single statement — recognized by the
  // embedded active-sprint subquery — so evaluate it directly rather than
  // letting the per-column matchers below mis-read its subqueries.
  if (/SELECT "id" FROM reef_sprints WHERE "status" = 'active'/i.test(sql)) {
    return defaultViewRows(rows, sql, vault);
  }
  let out = [...rows];
  const reefId = matchSqlString(sql, /"?reef_id"?\s*=\s*'([^']+)'/i);
  if (reefId) out = out.filter((row) => row.reef_id === reefId);

  const statusMatch = sql.match(/"?status"?\s+IN\s+\(([^)]*)\)/i);
  if (statusMatch) {
    const statuses = sqlValues(statusMatch[1]);
    out = out.filter((row) => statuses.includes(row.status));
  }
  const statusEq = matchSqlString(sql, /"?status"?\s*=\s*'([^']+)'/i);
  if (statusEq) out = out.filter((row) => row.status === statusEq);

  for (const column of [
    "assigned_to",
    "requester",
    "sprint_id",
    "milestone_id",
    "release_id",
  ]) {
    const value = matchSqlString(
      sql,
      new RegExp(`"?${column}"?\\s*=\\s*'([^']+)'`, "i"),
    );
    if (value) out = out.filter((row) => row[column] === value);
  }

  const qMatch = sql.match(/ILIKE\s+'%([^']+)%'/i);
  if (qMatch) {
    const needle = qMatch[1].toLowerCase();
    out = out.filter((row) =>
      [
        row.reef_id,
        row.title,
        row.assigned_to,
        row.requester,
        row.reporter,
        row.milestone_id,
        row.sprint_id,
        row.release_id,
        JSON.stringify(row.labels ?? []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }

  if (/"archived_at"\s+IS\s+NULL/i.test(sql)) {
    out = out.filter((row) => row.archived_at == null);
  }
  return out;
}

function selectPlanningRows(vault, table, sql) {
  let out = [...planningRows(vault, table)];
  const id = matchSqlString(sql, /"?id"?\s*=\s*'([^']+)'/i);
  if (id) out = out.filter((row) => row.id === id);
  const status = matchSqlString(sql, /"?status"?\s*=\s*'([^']+)'/i);
  if (status) out = out.filter((row) => row.status === status);
  const name = matchSqlString(sql, /lower\(name\)\s*=\s*lower\('([^']+)'\)/i);
  if (name) {
    out = out.filter((row) => row.name.toLowerCase() === name.toLowerCase());
  }
  const excludedId = matchSqlString(sql, /id\s+<>\s+'([^']+)'/i);
  if (excludedId) out = out.filter((row) => row.id !== excludedId);
  return out;
}

function filterTemplates(rows, sql) {
  let out = [...rows];
  const name = matchSqlString(sql, /"?name"?\s*=\s*'([^']+)'/i);
  if (name) out = out.filter((row) => row.name === name);
  return out;
}

function filterActivityRows(rows, sql) {
  let out = [...rows];
  const status = matchSqlString(sql, /"?status"?\s*=\s*'([^']+)'/i);
  if (status) out = out.filter((row) => row.status === status);
  const id = matchSqlString(sql, /"?suggestion_id"?\s*=\s*'([^']+)'/i);
  if (id) out = out.filter((row) => row.suggestion_id === id);
  return out;
}

function filterAttachmentRows(rows, sql) {
  let out = [...rows];
  const reefId = matchSqlString(sql, /reef_id\s*=\s*'([^']+)'/i);
  if (reefId) out = out.filter((row) => row.reef_id === reefId);
  const id = matchSqlString(sql, /\bid\s*=\s*'([^']+)'/i);
  if (id) out = out.filter((row) => row.id === id);
  const fileUri = matchSqlString(sql, /file_uri\s*=\s*'([^']+)'/i);
  if (fileUri) out = out.filter((row) => row.file_uri === fileUri);
  return out;
}

function tableNamesInSql(lowerSql) {
  return [
    "reef_settings",
    "monitored_repos",
    "reef_issues",
    "reef_templates",
    "reef_activity_suggestions",
    "reef_attachments",
    "reef_sprints",
    "reef_milestones",
    "reef_releases",
  ].filter((table) => lowerSql.includes(table));
}

function tableQuery(columns, items) {
  return {
    kind: "table_query",
    columns,
    items,
    total: items.length,
  };
}

function tableSql() {
  return { kind: "table_sql", result: "OK" };
}

async function handleOpenRouter(req, res) {
  if (req.method === "POST") {
    const body = await readJson(req);
    if (body?.stream === true) {
      const created = Math.floor(new Date(NOW).getTime() / 1000);
      if (isToolLoopResultTurn(body)) {
        await streamOpenRouterChunks(res, finalToolLoopChunks(created), {
          delayBeforeTextDeltaMs: 250,
        });
        return;
      }
      if (isToolLoopPromptTurn(body)) {
        await streamOpenRouterChunks(res, initialToolLoopChunks(created), {
          delayAfterFunctionCallMs: 180,
        });
        return;
      }
      await streamOpenRouterChunks(res, basicTextChunks(created));
      return;
    }
    return json(res, 200, {
      id: "chatcmpl-e2e",
      object: "chat.completion",
      created: Math.floor(new Date(NOW).getTime() / 1000),
      model: "e2e/mock-model",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "Mock OpenRouter response.",
          },
        },
      ],
    });
  }
  return json(res, 404, { error: "not_found" });
}

function basicTextChunks(created) {
  return [
    chatCompletionChunk("chatcmpl-e2e", created, { role: "assistant" }),
    chatCompletionChunk("chatcmpl-e2e", created, {
      content: "Mock OpenRouter response.",
    }),
    chatCompletionChunk("chatcmpl-e2e", created, {}, "stop"),
  ];
}

function initialToolLoopChunks(created) {
  return [
    chatCompletionChunk("chatcmpl-e2e-tools", created, {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: TOOL_LOOP_SEARCH_ISSUES_CALL_ID,
          type: "function",
          function: {
            name: "search_issues",
            arguments: JSON.stringify({
              query: "Initial issue Alpha",
              status: null,
              assigned_to: null,
              labels: null,
              limit: 3,
            }),
          },
        },
        {
          index: 1,
          id: TOOL_LOOP_SEARCH_DOCUMENTS_CALL_ID,
          type: "function",
          function: {
            name: "search_documents",
            arguments: JSON.stringify({
              query: "Spec overview",
              limit: 3,
            }),
          },
        },
      ],
    }),
    chatCompletionChunk("chatcmpl-e2e-tools", created, {}, "tool_calls"),
  ];
}

function finalToolLoopChunks(created) {
  const text =
    "I found REEF-001 from the issue search and the Spec overview document as supporting context.";
  return [
    chatCompletionChunk("chatcmpl-e2e-tools-final", created, {
      role: "assistant",
    }),
    chatCompletionChunk("chatcmpl-e2e-tools-final", created, {
      content: text,
    }),
    chatCompletionChunk("chatcmpl-e2e-tools-final", created, {}, "stop"),
  ];
}

function chatCompletionChunk(id, created, delta, finishReason = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model: "e2e/mock-model",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

async function streamOpenRouterChunks(
  res,
  chunks,
  { delayAfterFunctionCallMs = 0, delayBeforeTextDeltaMs = 0 } = {},
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  for (const chunk of chunks) {
    if (delayBeforeTextDeltaMs > 0 && chunk.choices?.[0]?.delta?.content) {
      await sleep(delayBeforeTextDeltaMs);
    }
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (
      delayAfterFunctionCallMs > 0 &&
      chunk.choices?.[0]?.finish_reason === "tool_calls"
    ) {
      await sleep(delayAfterFunctionCallMs);
    }
  }
  res.end("data: [DONE]\n\n");
}

function isToolLoopPromptTurn(body) {
  return collectStrings(body?.messages ?? body?.input).some((value) =>
    value.toLowerCase().includes(TOOL_LOOP_E2E_PROMPT),
  );
}

function isToolLoopResultTurn(body) {
  return (
    hasFunctionCallOutput(
      body?.messages ?? body?.input,
      TOOL_LOOP_SEARCH_ISSUES_CALL_ID,
    ) ||
    hasFunctionCallOutput(
      body?.messages ?? body?.input,
      TOOL_LOOP_SEARCH_DOCUMENTS_CALL_ID,
    )
  );
}

function hasFunctionCallOutput(value, callId) {
  if (Array.isArray(value)) {
    return value.some((item) => hasFunctionCallOutput(item, callId));
  }
  if (!value || typeof value !== "object") return false;
  if (value.type === "function_call_output" && value.call_id === callId) {
    return true;
  }
  if (value.role === "tool" && value.tool_call_id === callId) return true;
  return Object.values(value).some((item) =>
    hasFunctionCallOutput(item, callId),
  );
}

function collectStrings(value, strings = []) {
  if (typeof value === "string") {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
    return strings;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, strings);
  }
  return strings;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleGitHub(req, res, url) {
  const path = url.pathname.slice("/github".length);
  if (
    req.method === "POST" &&
    /^\/app\/installations\/[^/]+\/access_tokens$/.test(path)
  ) {
    return json(res, 201, {
      token: "ghs_e2e_installation_token",
      expires_at: "2026-06-15T01:00:00.000Z",
      permissions: { contents: "read", metadata: "read" },
      repository_selection: "selected",
    });
  }
  if (req.method === "POST" && path.endsWith("/graphql")) {
    return json(res, 200, {
      data: {
        repository: {
          defaultBranchRef: {
            target: {
              history: {
                nodes: [],
              },
            },
          },
          pullRequests: {
            nodes: [],
          },
        },
      },
    });
  }
  if (req.method === "GET" && path === "/user/repos") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: '"reef-e2e-repos"',
    });
    res.end(JSON.stringify(state.githubRepos));
    return;
  }
  if (req.method === "GET" && path === "/installation/repositories") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: '"reef-e2e-installation-repos"',
    });
    res.end(
      JSON.stringify({
        total_count: state.githubRepos.length,
        repositories: state.githubRepos,
      }),
    );
    return;
  }
  if (req.method === "GET") {
    return json(res, 200, {
      items: [],
      total_count: 0,
      incomplete_results: false,
    });
  }
  return json(res, 200, {});
}

function putDocument(vault, body) {
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
    current_commit: nextCommit(),
  };
  vault.documents.set(path, stored);
  return stored;
}

function seedIssueDocument(vault, id, content) {
  const path = issuePathFor(id);
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title: id,
    type: "task",
    status: "active",
    summary: vault.issues.find((issue) => issue.reef_id === id)?.title ?? id,
    content,
    tags: [],
    created_at: NOW,
    updated_at: NOW,
    current_commit: `e2e-seed-${slugify(id)}`,
  });
}

function seedReferenceDocument(
  vault,
  path,
  { title, type, summary, content, tags },
) {
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title,
    type,
    status: "active",
    summary,
    content,
    tags,
    created_at: NOW,
    updated_at: NOW,
    current_commit: `e2e-seed-${slugify(path)}`,
  });
}

function searchVaultDocuments(vault, url) {
  const collection = url.searchParams.get("collection");
  const type = url.searchParams.get("type");
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 10));

  return [...vault.documents.values()]
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
    .sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path))
    .slice(0, limit)
    .map(({ doc, score }) => ({
      uri: doc.uri,
      vault: vault.name,
      title: doc.title ?? null,
      summary: doc.summary ?? null,
      score,
      matched_section: doc.summary ?? doc.content?.slice(0, 160) ?? null,
      source_type: "document",
      collection: doc.path.split("/").at(0) ?? null,
      doc_type: doc.type ?? null,
      tags: doc.tags ?? [],
    }));
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

function seedActivitySuggestions(vault) {
  for (const [index, suggestion] of [
    draftSuggestion({
      id: "reef-draft-1111111111111111",
      title: "Draft API rate limit issue",
      content: "A public API endpoint was added without rate limiting.",
      ref: "abc111",
    }),
    draftSuggestion({
      id: "reef-draft-2222222222222222",
      title: "Dismiss stale draft",
      content: "This draft duplicates an existing investigation.",
      ref: "abc222",
    }),
    statusSuggestion({
      id: "reef-status-3333333333333333",
      issueId: "REEF-001",
      issueTitle: "Initial issue Alpha",
      fromStatus: "todo",
      toStatus: "in_progress",
      ref: "43",
    }),
    statusSuggestion({
      id: "reef-status-4444444444444444",
      issueId: "REEF-002",
      issueTitle: "Initial issue Beta",
      fromStatus: "in_progress",
      toStatus: "done",
      ref: "44",
    }),
  ].entries()) {
    seedActivitySuggestion(vault, suggestion, index + 1);
  }
}

function seedDemoBoardActivitySuggestions(vault) {
  for (const [index, suggestion] of [
    draftSuggestion({
      id: "reef-draft-aa11bb22cc33dd44",
      title: "Draft README screenshot follow-up",
      content:
        "The README preview should show the Activity inbox badge alongside the board.",
      ref: "demo111",
    }),
    statusSuggestion({
      id: "reef-status-bb22cc33dd44ee55",
      issueId: "REEF-106",
      issueTitle: "Review activity-scan status proposals",
      fromStatus: "in_review",
      toStatus: "done",
      ref: "106",
    }),
    draftSuggestion({
      id: "reef-draft-cc33dd44ee55ff66",
      title: "Draft board density polish task",
      content:
        "The demo board needs enough screen width to show workflow columns clearly.",
      ref: "demo222",
    }),
  ].entries()) {
    seedActivitySuggestion(vault, suggestion, index + 1);
  }
}

function seedOutdatedVaultSkill(vault) {
  vault.settings.set("vault_skill", {
    version: 9,
    synced_at: "2026-06-01T00:00:00.000Z",
  });
  const path = "overview/vault-skill.md";
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title: `${vault.name} Reef PM Workspace Skill`,
    type: "skill",
    status: "active",
    summary: "Outdated manually edited skill.",
    content: "OUTDATED MANUAL SKILL CONTENT",
    tags: ["akb:skill", "reef:pm-workspace"],
    created_at: NOW,
    updated_at: NOW,
    current_commit: "e2e-seed-outdated-vault-skill",
  });
}

function seedActivitySuggestion(vault, suggestion, id) {
  const path = activitySuggestionPathFor(suggestion.id);
  vault.documents.set(path, {
    uri: docUri(vault.name, path),
    vault: vault.name,
    path,
    title: suggestion.id,
    type: "reference",
    status: "active",
    summary: activitySuggestionSummary(suggestion),
    content: `${activitySuggestionBody(suggestion)}\n`,
    tags: [
      "reef-activity-suggestion",
      suggestion.kind === "draft" ? "reef-ai-draft" : "reef-ai-status-change",
    ],
    created_at: NOW,
    updated_at: NOW,
    current_commit: `e2e-seed-${slugify(suggestion.id)}`,
  });
  vault.activitySuggestions.push(activitySuggestionRow(vault, suggestion, id));
}

function draftSuggestion({ id, title, content, ref }) {
  return {
    id,
    kind: "draft",
    status: "pending",
    fingerprint: `octo/reef:commit:${ref}`,
    repo: "octo/reef",
    created_at: NOW,
    detected_at: NOW,
    proposal: {
      operation: "create",
      create: {
        fields: {
          title,
          issue_type: "task",
          status: "todo",
          priority: "high",
          assigned_to: "alice",
          labels: ["activity", "e2e"],
          implementation_refs: [
            {
              type: "commit",
              repo: "octo/reef",
              ref,
              actor: "dev",
              detected_at: NOW,
              url: `https://github.com/octo/reef/commit/${ref}`,
            },
          ],
        },
        content,
      },
    },
    provenance: {
      type: "commit",
      ref,
      repo: "octo/reef",
      actor: "dev",
      detectedAt: NOW,
    },
    confidence: 0.82,
    reasoning: "The activity suggests product follow-up.",
  };
}

function statusSuggestion({
  id,
  issueId,
  issueTitle,
  fromStatus,
  toStatus,
  ref,
}) {
  return {
    id,
    kind: "status_change",
    status: "pending",
    fingerprint: `${issueId}|${toStatus}|octo/reef:pr:${ref}`,
    repo: "octo/reef",
    created_at: NOW,
    detected_at: NOW,
    proposal: {
      operation: "update",
      update: {
        issue_id: issueId,
        patch: { status: toStatus },
      },
    },
    issue_title: issueTitle,
    from_status: fromStatus,
    rationale: `PR #${ref} indicates the work is ready to move.`,
    evidence: [{ type: "pr", ref, repo: "octo/reef", actor: "dev" }],
    confidence: 0.9,
  };
}

function activitySuggestionRow(vault, suggestion, id) {
  const source =
    suggestion.kind === "draft"
      ? suggestion.provenance
      : suggestion.evidence[0];
  return {
    id,
    document_uri: docUri(vault.name, activitySuggestionPathFor(suggestion.id)),
    suggestion_id: suggestion.id,
    kind: suggestion.kind,
    status: suggestion.status,
    fingerprint: suggestion.fingerprint,
    repo: suggestion.repo,
    issue_id:
      suggestion.kind === "status_change"
        ? suggestion.proposal.update.issue_id
        : null,
    title:
      suggestion.kind === "draft"
        ? suggestion.proposal.create.fields.title
        : suggestion.issue_title,
    summary: activitySuggestionSummary(suggestion),
    source_type: source?.type ?? "commit",
    source_ref: source?.ref ?? "",
    actor: source?.actor ?? "",
    detected_at: suggestion.detected_at,
    reviewed_at: suggestion.reviewed_at ?? null,
    reviewed_by: suggestion.reviewed_by ?? null,
    meta: suggestion,
    created_at: suggestion.created_at,
    updated_at: suggestion.created_at,
    created_by: "alice",
  };
}

function activitySuggestionSummary(suggestion) {
  return suggestion.kind === "draft"
    ? suggestion.proposal.create.content.slice(0, 500)
    : suggestion.rationale;
}

function activitySuggestionBody(suggestion) {
  return suggestion.kind === "draft"
    ? suggestion.proposal.create.content
    : suggestion.rationale;
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

function getVault(name, res) {
  const vault = state.vaults.get(name);
  if (!vault) {
    json(res, 404, { error: "vault not found" });
    return null;
  }
  return vault;
}

function requireAkbAuth(req, res) {
  const raw = req.headers.authorization ?? "";
  const token = String(raw).replace(/^Bearer\s+/i, "");
  const username = state.sessions.get(token);
  if (!username) {
    json(res, 401, { error: "invalid session" });
    return null;
  }
  return username;
}

function vaultSummary(vault) {
  return {
    id: vault.id,
    name: vault.name,
    description: vault.description,
    status: vault.status,
    role: vault.role,
    created_at: vault.created_at,
  };
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

function publicState() {
  return {
    scenario: state.scenario,
    calls: state.calls,
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
        parent_id: issue.parent_id,
        sprint_id: issue.sprint_id,
        milestone_id: issue.milestone_id,
        labels: issue.labels,
      })),
      sprints: vault.sprints,
      milestones: vault.milestones,
      releases: vault.releases,
      templates: vault.templates,
      activity_suggestions: vault.activitySuggestions.map((item) => ({
        id: item.suggestion_id,
        kind: item.kind,
        status: item.status,
        title: item.title,
        issue_id: item.issue_id,
        reviewed_at: item.reviewed_at,
        approved_issue_id:
          item.kind === "draft" && item.meta && typeof item.meta === "object"
            ? item.meta.approved_issue_id
            : undefined,
        proposal:
          item.meta && typeof item.meta === "object"
            ? item.meta.proposal
            : undefined,
      })),
      activity: (vault.activity ?? []).map((item) => ({
        reef_id: item.reef_id,
        event_type: item.event_type,
        payload: item.payload,
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

function rememberCall(method, path) {
  state.calls.push({ method, path });
  if (state.calls.length > 400) state.calls.shift();
}

async function readJson(req) {
  const body = await readRawBody(req);
  if (body.length === 0) return {};
  const raw = body.toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readMultipartForm(req) {
  const body = await readRawBody(req);
  const contentType = String(req.headers["content-type"] ?? "");
  const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1] ?? "";
  if (!boundary) return { fields: {}, files: {} };
  return parseMultipart(body, boundary);
}

function parseMultipart(body, boundary) {
  const fields = {};
  const files = {};
  const raw = body.toString("binary");
  const marker = `--${boundary}`;
  for (let part of raw.split(marker).slice(1)) {
    if (part.startsWith("--")) break;
    if (part.startsWith("\r\n")) part = part.slice(2);
    if (part.endsWith("\r\n")) part = part.slice(0, -2);
    const separator = part.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const headerText = part.slice(0, separator);
    let bodyText = part.slice(separator + 4);
    if (bodyText.endsWith("\r\n")) bodyText = bodyText.slice(0, -2);
    const headers = Object.fromEntries(
      headerText
        .split("\r\n")
        .map((line) => line.split(/:\s*/, 2))
        .filter(([key, value]) => key && value)
        .map(([key, value]) => [key.toLowerCase(), value]),
    );
    const disposition = headers["content-disposition"] ?? "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    if (!name) continue;
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    const buffer = Buffer.from(bodyText, "binary");
    if (filename != null) {
      files[name] = {
        filename,
        contentType: headers["content-type"] ?? "application/octet-stream",
        body: buffer,
      };
    } else {
      fields[name] = buffer.toString("utf8");
    }
  }
  return { fields, files };
}

function headerQuoted(value) {
  return String(value).replace(/["\\\r\n]/g, "_");
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function makeJwt(payload) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  return [
    base64url(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64url(JSON.stringify({ exp, ...payload })),
    "e2e",
  ].join(".");
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sqlValues(sql) {
  const values = [];
  const re = /'((?:''|[^'])*)'/g;
  let match = re.exec(sql);
  while (match != null) {
    values.push(match[1].replace(/''/g, "'"));
    match = re.exec(sql);
  }
  return values;
}

function firstSqlString(sql) {
  return sqlValues(sql)[0] ?? null;
}

function matchSqlString(sql, pattern) {
  const match = sql.match(pattern);
  return match ? match[1].replace(/''/g, "'") : null;
}

function parseInsert(sql) {
  const tableMatch = sql.match(/insert into\s+([a-z_]+)/i);
  if (!tableMatch || tableMatch.index == null) return null;
  const columnsStart = sql.indexOf("(", tableMatch.index);
  const columnsEnd = findMatchingParen(sql, columnsStart);
  const columns = splitSqlCsv(sql.slice(columnsStart + 1, columnsEnd)).map(
    normalizeColumn,
  );
  const valueRows = [];
  let searchFrom = sql.toLowerCase().indexOf(" values ", columnsEnd);
  if (searchFrom < 0) return null;
  searchFrom += " values ".length;
  while (searchFrom < sql.length) {
    const valuesStart = sql.indexOf("(", searchFrom);
    if (valuesStart < 0) break;
    const valuesEnd = findMatchingParen(sql, valuesStart);
    valueRows.push(
      splitSqlCsv(sql.slice(valuesStart + 1, valuesEnd)).map(parseSqlValue),
    );
    searchFrom = valuesEnd + 1;
    while (/\s/.test(sql[searchFrom] ?? "")) searchFrom += 1;
    if (sql[searchFrom] !== ",") break;
    searchFrom += 1;
  }
  return { columns, values: valueRows[0] ?? [], valueRows };
}

function parseUpdate(sql) {
  const match = sql.match(/update\s+([a-z_]+)\s+set\s+/i);
  if (!match || match.index == null) return null;
  const start = match.index + match[0].length;
  const where = sql.toLowerCase().indexOf(" where ", start);
  const assignmentText = sql.slice(start, where >= 0 ? where : undefined);
  const values = {};
  for (const assignment of splitSqlCsv(assignmentText)) {
    const eq = assignment.indexOf("=");
    if (eq < 0) continue;
    const column = normalizeColumn(assignment.slice(0, eq));
    values[column] = parseSqlValue(assignment.slice(eq + 1));
  }
  return { values };
}

function objectFromColumns(columns, values) {
  return Object.fromEntries(columns.map((column, i) => [column, values[i]]));
}

function parseSqlValue(value) {
  const trimmed = value.trim();
  if (/^null$/i.test(trimmed)) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^'.*'(?:\:\:json(?:b)?|\:\:text)?$/i.test(trimmed)) {
    const raw = trimmed.replace(/::jsonb?$/i, "").replace(/::text$/i, "");
    const unquoted = raw.slice(1, -1).replace(/''/g, "'");
    if (/::jsonb?$/i.test(trimmed)) {
      try {
        return JSON.parse(unquoted);
      } catch {
        return unquoted;
      }
    }
    return unquoted;
  }
  return trimmed;
}

function splitSqlCsv(input) {
  const parts = [];
  let current = "";
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'") {
      current += ch;
      if (inQuote && input[i + 1] === "'") {
        current += input[++i];
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function findMatchingParen(input, start) {
  let inQuote = false;
  let depth = 0;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'") {
      if (inQuote && input[i + 1] === "'") {
        i++;
        continue;
      }
      inQuote = !inQuote;
    }
    if (inQuote) continue;
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return input.length - 1;
}

function normalizeColumn(value) {
  return value.trim().replace(/^"|"$/g, "");
}

function planningRows(vault, table) {
  if (table === "reef_sprints") return vault.sprints;
  if (table === "reef_milestones") return vault.milestones;
  return vault.releases;
}

function planningColumns(table) {
  if (table === "reef_sprints") {
    return [
      "id",
      "name",
      "status",
      "start_date",
      "end_date",
      "goal",
      "capacity_points",
      "meta",
    ];
  }
  if (table === "reef_milestones") {
    return ["id", "name", "status", "target_date", "description", "meta"];
  }
  return [
    "id",
    "name",
    "status",
    "target_date",
    "released_at",
    "notes",
    "meta",
  ];
}

function templateColumns() {
  return [
    "name",
    "label",
    "description",
    "title_prefix",
    "priority",
    "default_labels",
    "body",
  ];
}

function activityColumns() {
  return [
    "document_uri",
    "suggestion_id",
    "kind",
    "status",
    "fingerprint",
    "repo",
    "issue_id",
    "title",
    "summary",
    "source_type",
    "source_ref",
    "actor",
    "detected_at",
    "reviewed_at",
    "reviewed_by",
    "meta",
  ];
}

function applyLimit(rows, sql) {
  const match = sql.match(/\sLIMIT\s+(\d+)/i);
  return match ? rows.slice(0, Number(match[1])) : rows;
}

function numericSort(a, b) {
  const left = a == null ? Number.MAX_SAFE_INTEGER : Number(a);
  const right = b == null ? Number.MAX_SAFE_INTEGER : Number(b);
  return left - right;
}

function stringDesc(a, b) {
  return String(b ?? "").localeCompare(String(a ?? ""));
}

function idDesc(a, b) {
  return String(b.reef_id ?? "").localeCompare(String(a.reef_id ?? ""));
}

function nextBacklogRank(vault) {
  const max = vault.issues
    .filter((issue) => issue.status === "backlog" && issue.archived_at == null)
    .reduce((acc, issue) => Math.max(acc, Number(issue.rank ?? 0)), 0);
  return max + 1000;
}

function nextCommit() {
  state.commitSeq += 1;
  return `e2e-${String(state.commitSeq).padStart(4, "0")}`;
}

function uuidFor(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function issuePathFor(id) {
  return `issues/${slugify(id)}.md`;
}

function activitySuggestionPathFor(id) {
  return `_reef/activity-inbox/${id}.md`;
}

function issueDocumentUri(vault, id) {
  return docUri(vault, issuePathFor(id));
}

function docUri(vault, path) {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return `akb://${vault}/doc/${path}`;
  return `akb://${vault}/coll/${path.slice(0, lastSlash)}/doc/${path.slice(
    lastSlash + 1,
  )}`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/[-\s]+/g, "-")
    .slice(0, 80);
}

function stringOr(current, next) {
  return typeof next === "string" ? next : current;
}
