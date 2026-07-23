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
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/jira/")) {
    state.jiraRequests.push({ method: request.method, path: url.pathname });
    if (url.pathname === "/jira/rest/api/3/field") return respond(response, []);
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
    state.issues.set(body.issue.id, body.issue);
    return respond(response, {
      reefId: body.issue.id,
      documentUri: `akb://reef-contract/coll/issues/doc/${body.issue.id.toLowerCase()}.md`,
      commitHash: `commit-${body.issue.id}`,
    });
  }
  if (url.pathname.startsWith("/akb/issues/")) {
    const id = decodeURIComponent(url.pathname.slice("/akb/issues/".length));
    return respond(response, {
      issue: state.issues.get(id),
      content: "",
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
      `behavior_contract_invariant_failed:${JSON.stringify(proof)}`,
    );
  }
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
