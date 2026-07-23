import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(
  await mkdtemp(join(tmpdir(), "reef-jira-behavior-")),
);
await chmod(root, 0o700);
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { mode: 0o700 });

const policy = {
  statuses: [{ id: "3", name: "In Progress", status: "in_progress" }],
  issueTypes: [{ id: "10002", name: "Task", issueType: "task" }],
  priorities: [],
  linkMappings: [
    {
      typeId: "10000",
      kind: "directional",
      outwardRelation: "blocks",
      inwardRelation: "depends_on",
    },
  ],
};
const policies = {};
for (const key of ["ALPHA", "BETA"]) {
  const path = join(root, `${key}.policy.json`);
  await writeFile(path, `${JSON.stringify(policy)}\n`, { mode: 0o600 });
  policies[key] = path;
}

const issue = (projectKey, projectId, issueId, linked) => ({
  id: issueId,
  key: `${projectKey}-1`,
  self: `https://jira.invalid/rest/api/3/issue/${issueId}`,
  fields: {
    summary: `${projectKey} migration contract`,
    description: null,
    created: "2026-07-23T00:00:00.000+0000",
    updated: "2026-07-23T00:01:00.000+0000",
    labels: ["contract"],
    project: { id: projectId, key: projectKey, name: projectKey },
    issuetype: { id: "10002", name: "Task" },
    status: { id: "3", name: "In Progress" },
    attachment: [],
    issuelinks: linked
      ? [
          {
            id: "link-alpha-beta",
            type: {
              id: "10000",
              name: "Blocks",
              inward: "is blocked by",
              outward: "blocks",
            },
            outwardIssue: {
              id: "20001",
              key: "BETA-1",
              fields: { summary: "BETA migration contract" },
            },
          },
        ]
      : [],
  },
});
const issues = {
  ALPHA: issue("ALPHA", "100", "10001", true),
  BETA: issue("BETA", "200", "20001", false),
};

const state = {
  jiraRequests: [],
  akbRequests: [],
  mutationLog: [],
  issues: new Map(),
  relations: new Map(),
  externalRefs: new Map(),
};
const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length > 0
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : null;
};
const respond = (response, value, status = 200) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};
const sqlResult = (items) => ({
  kind: "table_query",
  columns: [...new Set(items.flatMap((item) => Object.keys(item)))],
  items,
  total: items.length,
});
const projectForReefId = (id) => (id === "REEF-001" ? "ALPHA" : "BETA");
const sourceForReefId = (id) => issues[projectForReefId(id)];
const issueMetadata = (id, reservation = false) => {
  const source = sourceForReefId(id);
  return {
    id,
    title: source.fields.summary,
    status: "in_progress",
    issue_type: "task",
    labels: ["contract"],
    depends_on: [],
    related_to: [],
    blocks: [],
    created_at: "2026-07-23T00:00:00.000Z",
    created_by: "contract-operator",
    updated_at: "2026-07-23T00:01:00.000Z",
    updated_by: "contract-operator",
    ...(reservation ? { archived_at: "2026-07-23T00:01:00.000Z" } : {}),
    custom_fields: {
      jira_migration: {
        owner: {
          jira_cloud_id: "cloud-contract",
          project_key: source.fields.project.key,
          issue_id: source.id,
          issue_key: source.key,
        },
        relations: [],
        external_refs: [],
        ...(reservation ? { reservation: true } : {}),
      },
    },
  };
};
const issueRow = (id, reservation = false) => {
  const stored = state.issues.get(id);
  const issue = stored?.issue ?? issueMetadata(id, reservation);
  return {
    reef_id: issue.id,
    title: issue.title,
    status: issue.status,
    issue_type: issue.issue_type ?? "task",
    priority: issue.priority ?? null,
    assigned_to: issue.assigned_to ?? null,
    requester: issue.requester ?? null,
    reporter: issue.reporter ?? null,
    start_date: issue.start_date ?? null,
    due_date: issue.due_date ?? null,
    milestone_id: issue.milestone_id ?? null,
    sprint_id: issue.sprint_id ?? null,
    release_id: issue.release_id ?? null,
    estimate_points: issue.estimate_points ?? null,
    severity: issue.severity ?? null,
    rank: issue.rank ?? null,
    closed_at: issue.closed_at ?? null,
    closed_reason: issue.closed_reason ?? null,
    parent_id: issue.parent_id ?? null,
    labels: issue.labels ?? [],
    depends_on: issue.depends_on ?? [],
    related_to: issue.related_to ?? [],
    blocks: issue.blocks ?? [],
    archived_at: issue.archived_at ?? null,
    document_uri: `akb://reef-contract/coll/issues/doc/${id.toLowerCase()}.md`,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    meta: {
      author: issue.created_by,
      last_editor: issue.updated_by,
      source: issue.source ?? null,
      last_status_change: issue.last_status_change ?? null,
      implementation_refs: issue.implementation_refs ?? [],
      external_refs: issue.external_refs ?? [],
      custom_fields: issue.custom_fields,
    },
  };
};
const sqlStringValue = (statement, column) => {
  const match = new RegExp(
    `"${column}" = '((?:''|[^'])*)'(?:::json)?`,
    "u",
  ).exec(statement);
  return match?.[1]?.replaceAll("''", "'") ?? null;
};
const sqlNullableStringValue = (statement, column) => {
  const match = new RegExp(`"${column}" = (NULL|'((?:''|[^'])*)')`, "u").exec(
    statement,
  );
  if (!match) return undefined;
  return match[1] === "NULL" ? null : (match[2]?.replaceAll("''", "'") ?? "");
};
const applyIssueSqlUpdate = (statement, id) => {
  const current = state.issues.get(id) ?? {
    issue: issueRow(id, true),
    content: "",
    documented: false,
  };
  const issue = {
    ...sourceForReefId(id),
    ...current.issue,
    id,
    title: sourceForReefId(id).fields.summary,
    status: "in_progress",
    issue_type: "task",
    labels: ["contract"],
    archived_at: undefined,
  };
  for (const column of [
    "title",
    "status",
    "issue_type",
    "priority",
    "assigned_to",
    "requester",
    "reporter",
    "start_date",
    "due_date",
    "milestone_id",
    "sprint_id",
    "release_id",
    "severity",
    "closed_at",
    "closed_reason",
    "parent_id",
    "archived_at",
  ]) {
    const value = sqlNullableStringValue(statement, column);
    if (value === null) delete issue[column];
    else if (value !== undefined) issue[column] = value;
  }
  for (const column of ["labels", "depends_on", "related_to", "blocks"]) {
    const value = sqlStringValue(statement, column);
    if (value !== null) issue[column] = JSON.parse(value);
  }
  for (const column of ["estimate_points", "rank"]) {
    const value = sqlNullableStringValue(statement, column);
    if (value === null) delete issue[column];
    else if (value !== undefined) issue[column] = Number(value);
  }
  const meta = sqlStringValue(statement, "meta");
  if (meta !== null) {
    const parsed = JSON.parse(meta);
    issue.custom_fields = parsed.custom_fields ?? {};
    issue.source = parsed.source ?? undefined;
    issue.last_status_change = parsed.last_status_change ?? undefined;
    issue.implementation_refs = parsed.implementation_refs ?? undefined;
    issue.external_refs = parsed.external_refs ?? undefined;
  }
  state.issues.set(id, {
    issue,
    content: current.content,
    documented: current.documented,
  });
  const relations = issue.custom_fields?.jira_migration?.relations ?? [];
  for (const relation of relations) {
    if (!state.relations.has(relation.idempotencyKey)) {
      state.mutationLog.push(`relation:${relation.idempotencyKey}`);
    }
    state.relations.set(relation.idempotencyKey, {
      sourceReefId: relation.sourceReefId,
      targetReefId: relation.targetReefId,
      relation: relation.relation,
      inverseRelation: relation.inverseRelation,
    });
  }
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/akb/")) {
    state.akbRequests.push({ method: request.method, path: url.pathname });
  }
  if (url.pathname.startsWith("/jira/")) {
    state.jiraRequests.push({ method: request.method, path: url.pathname });
    if (url.pathname === "/jira/rest/api/3/field") return respond(response, []);
    const projectMatch = /^\/jira\/rest\/api\/3\/project\/([^/]+)$/u.exec(
      url.pathname,
    );
    if (projectMatch) {
      const key = decodeURIComponent(projectMatch[1] ?? "");
      return respond(response, { id: key === "ALPHA" ? "100" : "200", key });
    }
    if (url.pathname.includes("/version"))
      return respond(response, {
        startAt: 0,
        maxResults: 50,
        total: 0,
        isLast: true,
        values: [],
      });
    if (url.pathname === "/jira/rest/api/3/search/jql") {
      const match = /project = ([A-Z0-9_]+)/u.exec(
        url.searchParams.get("jql") ?? "",
      );
      const key = match?.[1] ?? "";
      if (!url.searchParams.get("nextPageToken")) {
        return respond(response, {
          issues: [],
          nextPageToken: `next-${key}`,
          isLast: false,
        });
      }
      return respond(response, { issues: [issues[key]], isLast: true });
    }
    if (url.pathname.endsWith("/comment"))
      return respond(response, {
        startAt: 0,
        maxResults: 50,
        total: 0,
        comments: [],
      });
    if (url.pathname.endsWith("/changelog"))
      return respond(response, {
        startAt: 0,
        maxResults: 50,
        total: 0,
        isLast: true,
        values: [],
      });
    if (url.pathname.endsWith("/remotelink")) return respond(response, []);
    return respond(response, { error: "not_found" }, 404);
  }
  if (url.pathname === "/akb/api/v1/auth/me") {
    return respond(response, { username: "contract-operator" });
  }
  if (
    url.pathname === "/akb/api/v1/tables/reef-contract/sql" &&
    request.method === "POST"
  ) {
    const { sql: statement } = await readBody(request);
    state.akbRequests.at(-1).sql = statement;
    if (
      statement.includes("FROM reef_sprints") ||
      statement.includes("FROM reef_milestones") ||
      statement.includes("FROM reef_releases") ||
      statement.includes("FROM reef_comments") ||
      statement.includes("FROM reef_attachments") ||
      statement.includes("FROM reef_activity")
    ) {
      return respond(response, sqlResult([]));
    }
    if (statement.includes("INSERT INTO reef_issues")) {
      const id =
        [...["REEF-001", "REEF-002"]].find((candidate) =>
          statement.includes(`'${candidate}'`),
        ) ?? `REEF-${String(state.issues.size + 1).padStart(3, "0")}`;
      if (state.issues.has(id)) {
        return respond(response, { error: "duplicate reef_id" }, 409);
      }
      state.issues.set(id, {
        issue: issueMetadata(id, true),
        content: "",
        documented: false,
      });
      return respond(response, { kind: "table_sql", result: "INSERT 1" });
    }
    if (
      statement.startsWith("UPDATE reef_issues") ||
      statement.startsWith("WITH upd AS (UPDATE reef_issues")
    ) {
      const id = /"?reef_id"? = '(REEF-\d+)'/u.exec(statement)?.[1];
      if (id) applyIssueSqlUpdate(statement, id);
      return respond(
        response,
        statement.startsWith("WITH upd")
          ? sqlResult(id ? [{ reef_id: id }] : [])
          : { kind: "table_sql", result: "UPDATE 1" },
      );
    }
    if (statement.startsWith("SELECT reef_id, meta FROM reef_issues")) {
      return respond(
        response,
        sqlResult(
          [...state.issues.keys()].map((id) => {
            const row = issueRow(id);
            return { reef_id: row.reef_id, meta: row.meta };
          }),
        ),
      );
    }
    if (statement.includes("FROM reef_issues")) {
      const id = /"?reef_id"? = '(REEF-\d+)'/u.exec(statement)?.[1];
      return respond(
        response,
        sqlResult(id && state.issues.has(id) ? [issueRow(id)] : []),
      );
    }
    if (statement.includes("INSERT INTO reef_activity")) {
      return respond(response, { kind: "table_sql", result: "INSERT 1" });
    }
    return respond(response, sqlResult([]));
  }
  if (url.pathname === "/akb/api/v1/documents" && request.method === "POST") {
    const body = await readBody(request);
    const id = body.title;
    const current = state.issues.get(id);
    if (!current) return respond(response, { error: "row_missing" }, 404);
    current.content = body.content ?? "";
    current.documented = true;
    state.issues.set(id, current);
    state.mutationLog.push(`issue:create:${id}`);
    return respond(response, {
      uri: `akb://reef-contract/coll/issues/doc/${id.toLowerCase()}.md`,
      vault: "reef-contract",
      path: `issues/${id.toLowerCase()}.md`,
      commit_hash: `commit-${id}`,
    });
  }
  if (url.pathname.startsWith("/akb/api/v1/documents/reef-contract/issues/")) {
    const filename = url.pathname.split("/").at(-1) ?? "";
    const id = filename.replace(/\.md$/u, "").toUpperCase();
    const stored = state.issues.get(id);
    if (!stored?.documented) {
      return respond(response, { error: "not_found" }, 404);
    }
    if (request.method === "PATCH") {
      const body = await readBody(request);
      stored.content = body.content ?? stored.content;
      stored.documented = true;
      state.issues.set(id, stored);
      return respond(response, {
        uri: `akb://reef-contract/coll/issues/doc/${filename}`,
        vault: "reef-contract",
        path: `issues/${filename}`,
        commit_hash: `commit-${id}`,
      });
    }
    return respond(response, {
      uri: `akb://reef-contract/coll/issues/doc/${filename}`,
      vault: "reef-contract",
      path: `issues/${filename}`,
      title: id,
      type: "task",
      status: "active",
      summary: stored.issue.title,
      current_commit: `commit-${id}`,
      tags: stored.issue.labels ?? [],
      content: stored.content,
    });
  }
  if (url.pathname === "/akb/preflight")
    return respond(response, {
      actor: "contract-operator",
      vault: "reef-contract",
      planning: { releases: [], sprints: [], milestones: [] },
    });
  if (url.pathname === "/akb/reserve") {
    const { count } = await readBody(request);
    return respond(
      response,
      Array.from(
        { length: count },
        (_, index) => `REEF-${String(index + 1).padStart(3, "0")}`,
      ),
    );
  }
  if (url.pathname === "/akb/issues" && request.method === "POST") {
    const body = await readBody(request);
    state.mutationLog.push(`issue:${body.action}:${body.issue.id}`);
    state.issues.set(body.issue.id, {
      issue: body.issue,
      content: body.content,
    });
    return respond(response, {
      reefId: body.issue.id,
      documentUri: `akb://reef-contract/coll/issues/doc/${body.issue.id.toLowerCase()}.md`,
      commitHash: `commit-${body.issue.id}`,
    });
  }
  if (url.pathname.startsWith("/akb/issues/")) {
    const id = decodeURIComponent(url.pathname.slice("/akb/issues/".length));
    const stored = state.issues.get(id);
    if (!stored) return respond(response, { error: "not_found" }, 404);
    return respond(response, {
      issue: stored?.issue,
      content: stored?.content ?? "",
      commit_hash: `commit-${id}`,
    });
  }
  if (url.pathname === "/akb/relations" && request.method === "PUT") {
    const body = await readBody(request);
    state.mutationLog.push(`relation:${body.idempotencyKey}`);
    state.relations.set(body.idempotencyKey, {
      sourceReefId: body.sourceReefId,
      targetReefId: body.targetReefId,
      relation: body.relation,
      inverseRelation: body.inverseRelation,
    });
    return respond(response, { ok: true });
  }
  if (url.pathname.startsWith("/akb/relations/")) {
    const key = decodeURIComponent(
      url.pathname.slice("/akb/relations/".length),
    );
    if (request.method === "DELETE") {
      state.relations.delete(key);
      return respond(response, { ok: true });
    }
    return respond(response, state.relations.get(key) ?? null);
  }
  if (url.pathname === "/akb/external-refs" && request.method === "GET") {
    const prefix = url.searchParams.get("prefix") ?? "";
    return respond(
      response,
      [...state.externalRefs.keys()].filter((key) => key.startsWith(prefix)),
    );
  }
  if (url.pathname.startsWith("/akb/external-refs/")) {
    const key = decodeURIComponent(
      url.pathname.slice("/akb/external-refs/".length),
    );
    return respond(response, state.externalRefs.get(key) ?? null);
  }
  if (url.pathname === "/akb/external-refs" && request.method === "PUT") {
    const body = await readBody(request);
    state.mutationLog.push(`external-ref:${body.idempotencyKey}`);
    state.externalRefs.set(body.idempotencyKey, {
      reefId: body.reefId,
      ref: body.ref,
      provenance: body.provenance,
    });
    return respond(response, { ok: true });
  }
  return respond(response, { error: "not_found" }, 404);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

const baseConfig = {
  mode: "dry-run",
  dryRun: true,
  jira: {
    baseUrl: `${baseUrl}/jira`,
    cloudId: "cloud-contract",
    projectKey: "ALPHA",
    projectKeys: ["ALPHA", "BETA"],
    boardIds: [],
    mappingPolicyPaths: policies,
    auth: { mode: "bearer", token: "jira-contract-canary" },
  },
  target: {
    baseUrl: `${baseUrl}/akb`,
    vault: "reef-contract",
    jwt: "akb-contract-canary",
  },
  targetVault: "reef-contract",
  reportPath: join(artifacts, "report.json"),
  accountMappingPath: join(artifacts, "accounts.json"),
  artifacts: {
    runId: "contract-alpha-beta",
    ledgerPath: join(artifacts, "ledger.json"),
    archiveRoot: join(artifacts, "archive"),
    accountMappingPath: join(artifacts, "accounts.json"),
    reportPath: join(artifacts, "report.json"),
  },
  resumeRunId: null,
  expectedPlanSha256: null,
  control: { retryCount: 0, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
};
const worker = join(
  dirname(fileURLToPath(import.meta.url)),
  "behavior-contract-worker.mjs",
);
const tsx = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  ".bin",
  "tsx",
);
const run = (config, failAfter) =>
  new Promise((resolve) => {
    const child = spawn(tsx, [worker], {
      env: {
        ...process.env,
        REEF_BEHAVIOR_CONFIG: JSON.stringify(config),
        ...(failAfter ? { REEF_BEHAVIOR_FAIL_AFTER: String(failAfter) } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      const line = stdout.trim().split("\n").at(-1);
      resolve({ code, result: line ? JSON.parse(line) : null, stderr });
    });
  });

try {
  const before = {
    mutations: state.mutationLog.length,
    issues: state.issues.size,
  };
  const dry = await run(baseConfig);
  if (dry.code !== 0 || !dry.result?.ok) {
    throw new Error(
      `dry_run_failed:${JSON.stringify({ code: dry.code, result: dry.result, stderr: dry.stderr })}`,
    );
  }
  const afterDry = {
    mutations: state.mutationLog.length,
    issues: state.issues.size,
  };
  const applyConfig = {
    ...baseConfig,
    mode: "apply",
    dryRun: false,
    expectedPlanSha256: dry.result.plan_sha256,
  };
  const interrupted = await run(applyConfig, 1);
  if (interrupted.result?.code !== "failpoint")
    throw new Error("failpoint_missing");
  const resumed = await run(applyConfig);
  if (resumed.code !== 0 || !resumed.result?.ok)
    throw new Error("resume_failed");
  const beforeRerun = state.mutationLog.length;
  const rerun = await run(applyConfig);
  if (rerun.code !== 0 || !rerun.result?.ok) throw new Error("rerun_failed");
  const reportBytes = await readFile(baseConfig.artifacts.reportPath);
  const reportJson = JSON.parse(reportBytes);
  const proof = {
    contract: "source-blind-built-public-api",
    projects: ["ALPHA", "BETA"],
    before,
    dry_run: {
      ...afterDry,
      target_mutations: afterDry.mutations - before.mutations,
      plan_sha256: dry.result.plan_sha256,
      conservation: dry.result.conservation,
    },
    apply_resume: {
      interrupted_after_confirmed_entity: interrupted.result.code,
      fresh_process_resume: true,
      issues: state.issues.size,
      relations: state.relations.size,
      mutation_log: state.mutationLog,
    },
    rerun: {
      duplicate_mutations: state.mutationLog.length - beforeRerun,
      totals: rerun.result.totals,
    },
    jira: {
      methods: [...new Set(state.jiraRequests.map((entry) => entry.method))],
      enhanced_jql_pages: state.jiraRequests.filter((entry) =>
        entry.path.endsWith("/search/jql"),
      ).length,
    },
    report_sha256: createHash("sha256").update(reportBytes).digest("hex"),
    redaction: {
      canaries_absent:
        !reportBytes.includes("jira-contract-canary") &&
        !reportBytes.includes("akb-contract-canary"),
    },
    screenshot: "N/A (non-visual CLI)",
  };
  if (
    proof.dry_run.target_mutations !== 0 ||
    proof.apply_resume.issues !== 2 ||
    proof.apply_resume.relations !== 1 ||
    proof.rerun.duplicate_mutations !== 0 ||
    proof.jira.methods.join(",") !== "GET" ||
    !proof.redaction.canaries_absent
  ) {
    throw new Error(
      `behavior_contract_invariant_failed:${JSON.stringify({
        proof,
        interrupted: interrupted.result,
        resumed: resumed.result,
        rerun: rerun.result,
        terminal_classifications: reportJson.terminal_classifications,
        related: reportJson.sections?.related,
        akb_requests: state.akbRequests.map((entry) => ({
          method: entry.method,
          path: entry.path,
          sql: entry.sql?.slice(0, 160),
        })),
      })}`,
    );
  }
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (process.env.REEF_BEHAVIOR_KEEP_TEMP === "1") {
    process.stderr.write(`behavior_contract_temp:${root}\n`);
  } else {
    await rm(root, { recursive: true, force: true });
  }
}
