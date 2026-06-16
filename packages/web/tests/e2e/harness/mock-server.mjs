import { createServer } from "node:http";

const PORT = Number(process.env.REEF_E2E_MOCK_PORT ?? 7354);
const HOST = process.env.REEF_E2E_MOCK_HOST ?? "127.0.0.1";
const NOW = "2026-06-15T00:00:00.000Z";
const REEF_VAULT = "reef-e2e";

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
    const message = err instanceof Error ? err.message : String(err);
    return json(res, 500, { error: message });
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
  const token = makeJwt({ sub: alice.id, username: alice.username });
  const next = {
    scenario,
    calls: [],
    users: new Map([[alice.username, { ...alice, password: "password" }]]),
    sessions: new Map([[token, alice.username]]),
    loginToken: token,
    vaults: new Map(),
    issueListFailure: false,
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
      "reef_sprints",
      "reef_milestones",
      "reef_releases",
    ]),
    settings: new Map([["project_prefix", "REEF"]]),
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
  };

  seedIssueDocument(vault, "REEF-001", "Alpha description from fixture.");
  seedIssueDocument(vault, "REEF-002", "Beta description from fixture.");
  seedIssueDocument(vault, "REEF-003", "Gamma backlog description.");
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
      keycloak: { enabled: false, login_url: null },
    });
  }

  if (path === "/api/v1/auth/login" && req.method === "POST") {
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

  const membersMatch = path.match(/^\/api\/v1\/vaults\/([^/]+)\/members$/);
  if (membersMatch && req.method === "GET") {
    const vault = getVault(decodeURIComponent(membersMatch[1]), res);
    if (!vault) return;
    return json(res, 200, { members: vault.members });
  }

  const tablesMatch = path.match(/^\/api\/v1\/tables\/([^/]+)$/);
  if (tablesMatch && req.method === "GET") {
    const vault = getVault(decodeURIComponent(tablesMatch[1]), res);
    if (!vault) return;
    return json(res, 200, {
      kind: "table",
      vault: vault.name,
      items: [...vault.tables].map((name) => ({ name })),
    });
  }
  if (tablesMatch && req.method === "POST") {
    const vault = getVault(decodeURIComponent(tablesMatch[1]), res);
    if (!vault) return;
    const body = await readJson(req);
    if (typeof body?.name === "string") vault.tables.add(body.name);
    return json(res, 200, { ok: true });
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

  if (path === "/api/v1/relations" && req.method === "GET") {
    return json(res, 200, {
      uri: url.searchParams.get("uri") ?? "",
      relations: [],
    });
  }

  if (path === "/api/v1/search" && req.method === "GET") {
    return json(res, 200, { results: [] });
  }

  return json(res, 404, { error: `unhandled akb mock route: ${path}` });
}

function handleSql(vault, sql) {
  const normalized = sql.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  for (const table of tableNamesInSql(lower)) {
    if (!vault.tables.has(table)) {
      return { error: `relation "${table}" does not exist` };
    }
  }

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
      sortIssueRows(filterIssueRows(vault.issues, normalized), lower),
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
      const row = vault.issues.find((issue) => issue.reef_id === id);
      if (row) {
        Object.assign(row, update.values, { updated_at: NOW });
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

  return tableQuery([], []);
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

function filterIssueRows(rows, sql) {
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

function tableNamesInSql(lowerSql) {
  return [
    "reef_settings",
    "monitored_repos",
    "reef_issues",
    "reef_templates",
    "reef_activity_suggestions",
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
      const chunks = [
        {
          type: "response.created",
          response: {
            id: "resp-e2e",
            created_at: created,
            model: "e2e/mock-model",
            service_tier: null,
          },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "message",
            id: "msg-e2e",
            phase: "final_answer",
          },
        },
        {
          type: "response.output_text.delta",
          item_id: "msg-e2e",
          delta: "Mock OpenRouter response.",
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            id: "msg-e2e",
            phase: "final_answer",
          },
        },
        {
          type: "response.completed",
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 8,
              output_tokens: 4,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
            service_tier: null,
          },
        },
      ];
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.end("data: [DONE]\n\n");
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

function handleGitHub(req, res, url) {
  const path = url.pathname.slice("/github".length);
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
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
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
