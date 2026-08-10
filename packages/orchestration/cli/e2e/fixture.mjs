import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveProviders } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const packageRoot = dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = fileURLToPath(
  new URL("../dist/cli.js", import.meta.url),
);
const TEST_PATH = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
const VAULT = "fixture-vault";
const ACTOR = "fixture-actor";

const gitEnvironment = Object.freeze({
  PATH: TEST_PATH,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
});

const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

const readRequestBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const sendJson = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
};

const runGit = async (cwd, args) => {
  const result = await execFileAsync("git", args, {
    cwd,
    env: gitEnvironment,
    maxBuffer: 256 * 1024,
  });
  return result.stdout.trim();
};

const createGitFixture = async (root, identity) => {
  const repositoryRoot = join(root, "repository");
  const bareRemote = join(root, "remote.git");
  await mkdir(repositoryRoot, { recursive: true });
  await runGit(root, ["init", "--bare", "--quiet", bareRemote]);
  await runGit(root, [
    "init",
    "--quiet",
    "--initial-branch=main",
    repositoryRoot,
  ]);
  await runGit(repositoryRoot, ["config", "user.name", "CLI E2E Fixture"]);
  await runGit(repositoryRoot, [
    "config",
    "user.email",
    "cli-e2e-fixture@example.test",
  ]);
  await writeFile(join(repositoryRoot, "fixture.txt"), `fixture-${identity}\n`);
  await runGit(repositoryRoot, ["add", "fixture.txt"]);
  await runGit(repositoryRoot, ["commit", "--quiet", "-m", "fixture"]);
  await runGit(repositoryRoot, ["remote", "add", "origin", bareRemote]);
  await runGit(repositoryRoot, [
    "push",
    "--quiet",
    "--set-upstream",
    "origin",
    "main",
  ]);
  const baseRevision = await runGit(repositoryRoot, ["rev-parse", "HEAD"]);
  return { repositoryRoot, bareRemote, baseRevision };
};

const createCodexExecutable = async (root, scenario) => {
  const executable = join(root, "codex-app-server.mjs");
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      "process.stdin.setEncoding('utf8');",
      "import { appendFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `const scenario = ${JSON.stringify(scenario)};`,
      "const threadId = 'fixture-thread';",
      "let buffer = '';",
      "let turnCount = 0;",
      "const send = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);",
      "const output = (intent, summary) => JSON.stringify({ intent, summary });",
      "const edit = (name, value) => appendFileSync(join(process.cwd(), name), value);",
      "const emitTurn = (turnId, intent, summary) => {",
      "  const item = { id: `item-${turnId}`, type: 'agentMessage', text: output(intent, summary) };",
      "  send({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });",
      "  send({ method: 'item/completed', params: { threadId, turnId, item } });",
      "  send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [item] } } });",
      "};",
      "const userInput = (turnId) => send({",
      "  id: 41,",
      "  method: 'item/tool/requestUserInput',",
      "  params: { threadId, turnId, itemId: 'question-1', autoResolutionMs: null, questions: [{ id: 'choice', header: 'Decision', question: 'Which synthetic environment should be used?', options: [{ label: 'Existing', description: 'Use the existing environment.' }, { label: 'New', description: 'Create a new environment.' }], isOther: false, isSecret: false }] },",
      "});",
      "const afterTurn = (turnId) => {",
      "  turnCount += 1;",
      "  if (scenario === 'hold') return;",
      "  if (scenario === 'blocked' && turnCount === 1) { userInput(turnId); return; }",
      "  if (scenario === 'repair' && turnCount === 1) { edit('implementation.txt', 'initial\\n'); emitTurn(turnId, 'validation_requested', 'ready for validation'); return; }",
      "  if (scenario === 'repair' && turnCount === 2) { edit('repair.txt', 'repair\\n'); emitTurn(turnId, 'validation_requested', 'ready for repaired validation'); return; }",
      "  if (scenario === 'success' && turnCount === 1) { edit('implementation.txt', 'success\\n'); emitTurn(turnId, 'validation_requested', 'ready for validation'); return; }",
      "  emitTurn(turnId, 'completed', 'implementation complete');",
      "};",
      "const handle = (message) => {",
      "  if (message.method === 'initialize') { send({ id: message.id, result: {} }); return; }",
      "  if (message.method === 'thread/start') { send({ id: message.id, result: { thread: { id: threadId } } }); return; }",
      "  if (message.method === 'thread/resume') { send({ id: message.id, result: { thread: { id: threadId } } }); return; }",
      "  if (message.method === 'turn/start') { const turnId = `turn-${turnCount + 1}`; send({ id: message.id, result: { turn: { id: turnId } } }); afterTurn(turnId); return; }",
      "  if (message.method === 'turn/steer') { send({ id: message.id, result: {} }); afterTurn(message.params.expectedTurnId); return; }",
      "  if (message.method === 'turn/interrupt') { send({ id: message.id, result: {} }); return; }",
      "  if (message.method === 'initialized') return;",
      "  if (message.id !== undefined) send({ id: message.id, result: {} });",
      "};",
      "process.stdin.on('data', (chunk) => { buffer += chunk; for (;;) { const index = buffer.indexOf('\\n'); if (index < 0) break; const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!line.trim()) continue; handle(JSON.parse(line)); } });",
      "setInterval(() => undefined, 1000);",
      "",
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  return executable;
};

const issueRow = (id, targetId, status, dependsOn, identity) => ({
  document_uri: `akb://${VAULT}/coll/issues/doc/${id.toLowerCase()}.md`,
  reef_id: id,
  title: id === targetId ? "Fixture work" : "Fixture dependency",
  status,
  issue_type: "task",
  priority: "medium",
  assigned_to: ACTOR,
  requester: ACTOR,
  reporter: ACTOR,
  start_date: null,
  due_date: null,
  milestone_id: null,
  sprint_id: null,
  release_id: null,
  estimate_points: null,
  severity: null,
  rank: null,
  closed_at: null,
  closed_reason: null,
  parent_id: null,
  labels: JSON.stringify(["fixture"]),
  depends_on: JSON.stringify(dependsOn),
  related_to: JSON.stringify([]),
  blocks: JSON.stringify([]),
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  meta: JSON.stringify({
    author: ACTOR,
    last_editor: ACTOR,
    source: "fixture",
    last_status_change: null,
    external_refs: null,
    implementation_refs: null,
    watchers: null,
    reviewers: null,
    qa_owner: null,
    custom_fields: { fixture_identity: identity },
  }),
});

const issueDocument = (id, targetId, identity) => ({
  uri: `akb://${VAULT}/coll/issues/doc/${id.toLowerCase()}.md`,
  vault: VAULT,
  path: `issues/${id.toLowerCase()}.md`,
  title: id,
  type: "task",
  status: "active",
  summary: id === targetId ? "Fixture work" : "Fixture dependency",
  created_by: ACTOR,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  current_commit: `fixture-commit-${identity}-${id}`,
  tags: ["fixture"],
  content: `Fixture ${id} ${identity}`,
  is_public: false,
  public_slug: null,
});

const sqlLiteral = (sql, pattern) => {
  const match = sql.match(pattern);
  return match?.[1]?.replaceAll("''", "'") ?? null;
};

const sqlJson = (sql, pattern) => {
  const value = sqlLiteral(sql, pattern);
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const createServerFixture = async ({
  identity,
  targetId,
  dependencyId,
  jwt,
  githubToken,
}) => {
  const rows = new Map([
    [targetId, issueRow(targetId, targetId, "todo", [dependencyId], identity)],
    [dependencyId, issueRow(dependencyId, targetId, "done", [], identity)],
  ]);
  const requests = [];
  const tables = new Set();
  const comments = [];
  const pullRequests = [];
  const sockets = new Set();
  let workReadFailure = false;
  let updateSequence = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push({ method: request.method ?? "GET", path: url.pathname });

      if (
        url.pathname.startsWith("/api/v1/") &&
        request.headers.authorization !== `Bearer ${jwt}`
      ) {
        sendJson(response, 401, { error: "fixture_auth_failed" });
        return;
      }

      if (url.pathname === "/api/v1/auth/me") {
        sendJson(response, 200, {
          user_id: "fixture-user",
          username: ACTOR,
          display_name: ACTOR,
          email: "fixture@example.test",
        });
        return;
      }

      const documentMatch = url.pathname.match(
        new RegExp(
          `^/api/v1/documents/${VAULT}/issues/([a-z0-9_-]+)\\.md$`,
          "u",
        ),
      );
      if (documentMatch && request.method === "GET") {
        if (workReadFailure) {
          sendJson(response, 503, { error: "fixture_upstream_failure" });
          return;
        }
        const id = documentMatch[1].toUpperCase();
        if (!rows.has(id)) {
          sendJson(response, 404, { error: "fixture_not_found" });
          return;
        }
        sendJson(response, 200, issueDocument(id, targetId, identity));
        return;
      }

      if (
        url.pathname === `/api/v1/tables/${VAULT}` &&
        request.method === "GET"
      ) {
        sendJson(response, 200, {
          kind: "table",
          vault: VAULT,
          items: [...tables].map((name) => ({ name })),
        });
        return;
      }

      if (
        url.pathname === `/api/v1/tables/${VAULT}` &&
        request.method === "POST"
      ) {
        const body = JSON.parse(await readRequestBody(request));
        if (typeof body.name === "string") tables.add(body.name);
        sendJson(response, 201, { name: body.name });
        return;
      }

      if (
        url.pathname === `/api/v1/tables/${VAULT}/sql` &&
        request.method === "POST"
      ) {
        const body = JSON.parse(await readRequestBody(request));
        const sql = typeof body.sql === "string" ? body.sql : "";
        const id = sql
          .match(/reef_id\s*=\s*'((?:''|[^'])*)'/iu)?.[1]
          ?.replaceAll("''", "'");
        const row = id === undefined ? undefined : rows.get(id);
        if (row && /\bUPDATE\s+reef_issues\b/iu.test(sql)) {
          const status = sqlLiteral(sql, /"status"\s*=\s*'((?:''|[^'])*)'/iu);
          if (status) row.status = status;
          const meta = sqlJson(sql, /"meta"\s*=\s*'((?:''|[^'])*)'::json/iu);
          if (meta && typeof meta === "object") {
            row.meta = JSON.stringify(meta);
          }
          updateSequence += 1;
          row.updated_at = `2026-01-01T00:00:${String(updateSequence).padStart(2, "0")}.000Z`;
        }
        if (/\bINSERT\s+INTO\s+reef_comments\b/iu.test(sql)) {
          const insertSql = sql.slice(
            sql.toLowerCase().indexOf("insert into reef_comments"),
          );
          const commentMatch = insertSql.match(
            /\bSELECT\s+'((?:''|[^'])*)',\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)'::json/iu,
          );
          const reefId = commentMatch?.[1]?.replaceAll("''", "'") ?? null;
          const bodyText = commentMatch?.[2]?.replaceAll("''", "'") ?? null;
          const metadata = commentMatch?.[3]
            ? JSON.parse(commentMatch[3].replaceAll("''", "'"))
            : null;
          const author =
            metadata && typeof metadata === "object" && "author" in metadata
              ? String(metadata.author)
              : null;
          const createdAt =
            metadata && typeof metadata === "object" && "created_at" in metadata
              ? String(metadata.created_at)
              : null;
          if (reefId && bodyText && author && createdAt) {
            const comment = {
              id: `comment-${comments.length + 1}`,
              reef_id: reefId,
              body: bodyText,
              meta: JSON.stringify({
                author,
                created_at: createdAt,
                edited_at: null,
                parent_comment_id: null,
                thread_root_id: null,
                mention_recipients: [],
              }),
            };
            comments.push(comment);
            sendJson(response, 200, {
              kind: "table_query",
              columns: Object.keys(comment),
              items: [comment],
              total: 1,
            });
            return;
          }
        }
        if (/\bINSERT\s+INTO\s+reef_subscriptions\b/iu.test(sql)) {
          const subscriptionMatch = sql.match(
            /\bVALUES\s*\(\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)'/iu,
          );
          if (subscriptionMatch) {
            const [
              subscriptionKey,
              reefId,
              subscriber,
              source,
              status,
              subscribedAt,
            ] = subscriptionMatch
              .slice(1)
              .map((value) => value.replaceAll("''", "'"));
            const subscription = {
              id: "00000000-0000-4000-8000-000000000001",
              subscription_key: subscriptionKey,
              reef_id: reefId,
              subscriber,
              source,
              status,
              subscribed_at: subscribedAt,
              meta: null,
            };
            sendJson(response, 200, {
              kind: "table_query",
              columns: Object.keys(subscription),
              items: [subscription],
              total: 1,
            });
            return;
          }
        }
        const items = row === undefined ? [] : [row];
        sendJson(response, 200, {
          kind: "table_query",
          columns: row === undefined ? [] : Object.keys(row),
          items,
          total: items.length,
        });
        return;
      }

      if (url.pathname.startsWith("/github/")) {
        if (request.headers.authorization !== `token ${githubToken}`) {
          sendJson(response, 401, { message: "fixture_github_auth_failed" });
          return;
        }
        if (
          url.pathname === "/github/repos/fixture/reef/pulls" &&
          request.method === "GET"
        ) {
          sendJson(response, 200, pullRequests);
          return;
        }
        if (
          url.pathname === "/github/repos/fixture/reef/pulls" &&
          request.method === "POST"
        ) {
          const body = JSON.parse(await readRequestBody(request));
          const pullRequest = {
            number: 1,
            state: "open",
            draft: true,
            title: body.title,
            head: { ref: body.head, label: `fixture:${body.head}` },
            base: { ref: body.base },
          };
          pullRequests.push(pullRequest);
          sendJson(response, 201, pullRequest);
          return;
        }
        sendJson(response, 200, { fixture: true, repository: "fixture/reef" });
        return;
      }

      sendJson(response, 404, { error: "fixture_route_not_found" });
    })().catch(() => {
      if (!response.headersSent)
        sendJson(response, 500, { error: "fixture_request_failed" });
      else response.destroy();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_server_address_missing");

  return {
    server,
    sockets,
    requests,
    comments,
    pullRequests,
    targetRow: () => rows.get(targetId),
    port: address.port,
    setWorkReadFailure: (value) => {
      workReadFailure = value;
    },
  };
};

const createConfig = ({
  root,
  repositoryRoot,
  managedWorkRoot,
  bareRemote,
  baseRevision,
  codexExecutable,
  baseUrl,
  jwt,
  githubToken,
  infraSecret,
  validationSecret,
  branch,
  scenario,
}) => ({
  schema_version: 1,
  controller: {
    state_root: join(root, "controller"),
    stale_after_ms: 60_000,
  },
  repository: {
    id: `fixture-repository-${root.split("/").at(-1)}`,
    owner: "fixture",
    name: "reef",
    root: repositoryRoot,
    managed_work_root: managedWorkRoot,
    base_revision: baseRevision,
    remote: "origin",
    remote_url: bareRemote,
    base_branch: "main",
    branch,
    branch_policy: { allowed_prefixes: ["feat/"] },
    permissions: { commit: true, push: true, pull_request: true },
  },
  delivery: { max_validation_attempts: 3 },
  validation_checks: [
    {
      name: "fixture-check",
      command:
        scenario === "repair"
          ? "test -f repair.txt"
          : scenario === "success"
            ? "test -f implementation.txt"
            : "true",
      timeout_ms: 1_000,
    },
  ],
  providers: [
    {
      kind: "work",
      id: "reef",
      version: "1.0.0",
      environment: ["REEF_AKB_BASE_URL", "REEF_AKB_JWT"],
      required_capabilities: [
        "read",
        "refresh",
        "transition",
        "report",
        "linkArtifact",
      ],
      options: {
        vault: VAULT,
        base_url_env: "REEF_AKB_BASE_URL",
        jwt_env: "REEF_AKB_JWT",
      },
    },
    {
      kind: "harness",
      id: "codex",
      version: "0.1.0",
      environment: [],
      required_capabilities: [
        "start",
        "observe",
        "sendInput",
        "interrupt",
        "resume",
        "stop",
      ],
      options: { executable: codexExecutable },
    },
    {
      kind: "infrastructure",
      id: "local",
      version: "0.1.0",
      environment: ["PATH", "INFRA_SECRET"],
      required_capabilities: [
        "provision",
        "exec",
        "sync",
        "collect",
        "cleanup",
      ],
      options: { target: "foreground" },
    },
    {
      kind: "scm",
      id: "github",
      version: "0.1.0",
      environment: ["GITHUB_TOKEN"],
      required_capabilities: [
        "readBase",
        "readRef",
        "createBranch",
        "commit",
        "push",
        "createDraftPullRequest",
        "collectArtifact",
      ],
      options: {
        api_base_url: `${baseUrl}/github`,
        token_env: "GITHUB_TOKEN",
      },
    },
    {
      kind: "validation",
      id: "local-validation",
      version: "0.1.0",
      environment: ["PATH", "VALIDATION_SECRET"],
      required_capabilities: ["validate"],
      options: {},
    },
  ],
  _fixture_environment: {
    REEF_AKB_BASE_URL: baseUrl,
    REEF_AKB_JWT: jwt,
    GITHUB_TOKEN: githubToken,
    INFRA_SECRET: infraSecret,
    VALIDATION_SECRET: validationSecret,
    PATH: TEST_PATH,
  },
});

const stripFixtureEnvironment = (config) => {
  const copy = JSON.parse(JSON.stringify(config));
  delete copy._fixture_environment;
  return copy;
};

export const createFixture = async ({ scenario = "success" } = {}) => {
  const identity = randomUUID().replaceAll("-", "").slice(0, 12);
  const numericIdentity = Number.parseInt(identity.slice(0, 6), 16);
  const targetId = `REEF-${100 + (numericIdentity % 800)}`;
  const dependencyId = `REEF-${100 + ((numericIdentity + 1) % 800)}`;
  const branch = `feat/fixture-${identity}`;
  const root = await mkdtemp(join(tmpdir(), "reef-cli-e2e-"));
  const jwt = `fixture-jwt-${identity}`;
  const githubToken = `fixture-github-token-${identity}`;
  const infraSecret = `fixture-infra-secret-${identity}`;
  const validationSecret = `fixture-validation-secret-${identity}`;
  const git = await createGitFixture(root, identity);
  const codexExecutable = await createCodexExecutable(root, scenario);
  const managedWorkRoot = join(root, "managed-work");
  await mkdir(managedWorkRoot, { recursive: true });
  const serverFixture = await createServerFixture({
    identity,
    targetId,
    dependencyId,
    jwt,
    githubToken,
  });
  const baseUrl = `http://127.0.0.1:${serverFixture.port}`;
  const config = createConfig({
    root,
    ...git,
    managedWorkRoot,
    codexExecutable,
    baseUrl,
    jwt,
    githubToken,
    infraSecret,
    validationSecret,
    branch,
    scenario,
  });
  const configPath = join(root, "config.json");
  const invalidConfigPath = join(root, "invalid-config.json");
  const providerMismatchConfigPath = join(
    root,
    "provider-mismatch-config.json",
  );
  await writeFile(
    configPath,
    `${JSON.stringify(stripFixtureEnvironment(config))}\n`,
  );
  await writeFile(
    invalidConfigPath,
    `${JSON.stringify({ schema_version: 1 })}\n`,
  );
  const providerMismatch = JSON.parse(
    JSON.stringify(stripFixtureEnvironment(config)),
  );
  providerMismatch.providers.find(
    (provider) => provider.kind === "harness",
  ).version = "0.1.1";
  await writeFile(
    providerMismatchConfigPath,
    `${JSON.stringify(providerMismatch)}\n`,
  );

  let disposed = false;
  const children = new Set();
  const fixture = {
    root,
    identity,
    targetId,
    dependencyId,
    branch,
    configPath,
    invalidConfigPath,
    providerMismatchConfigPath,
    controllerRoot: join(root, "controller"),
    repositoryRoot: git.repositoryRoot,
    bareRemote: git.bareRemote,
    codexExecutable,
    baseRevision: git.baseRevision,
    workUri: `reef://${VAULT}/${targetId}`,
    port: serverFixture.port,
    baseUrl,
    environment: config._fixture_environment,
    requests: serverFixture.requests,
    comments: serverFixture.comments,
    pullRequests: serverFixture.pullRequests,
    targetRow: serverFixture.targetRow,
    config: stripFixtureEnvironment(config),
    setWorkReadFailure: serverFixture.setWorkReadFailure,
    spawnCli: (options = {}) => {
      const invocation = spawnCli(fixture, options);
      children.add(invocation);
      void invocation.result.then(
        () => children.delete(invocation),
        () => children.delete(invocation),
      );
      return invocation;
    },
    exerciseGithubAdapter: () => exerciseGithubAdapter(fixture),
    directCommand: (path = configPath) => directCommand(fixture, path),
    controllerFiles: async () => {
      const files = [];
      for (const directory of [
        join(fixture.controllerRoot, "records"),
        join(fixture.controllerRoot, "claims"),
      ]) {
        let names;
        try {
          names = await readdir(directory);
        } catch {
          continue;
        }
        for (const name of names.filter((value) => value.endsWith(".json"))) {
          files.push({
            path: join(directory, name),
            content: await readFile(join(directory, name), "utf8"),
          });
        }
      }
      return files;
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const activeChildren = [...children].filter(
        ({ child }) => child.exitCode === null,
      );
      for (const { child } of activeChildren) child.kill("SIGKILL");
      await Promise.all(activeChildren.map(({ result }) => result));
      for (const socket of serverFixture.sockets) socket.destroy();
      await new Promise((resolve) =>
        serverFixture.server.close(() => resolve()),
      );
      await rm(root, { recursive: true, force: true });
    },
  };
  return fixture;
};

const parseProgressLine = (line) => {
  try {
    const value = JSON.parse(line);
    return value &&
      (value.event === "execution.phase" ||
        value.event === "execution.validation")
      ? value
      : null;
  } catch {
    return null;
  }
};

export const spawnCli = (
  fixture,
  { configPath = fixture.configPath, environment = fixture.environment } = {},
) => {
  const childEnvironment = { ...process.env, ...environment };
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete childEnvironment[name];
  }
  const child = spawn(
    process.execPath,
    [CLI_PATH, "run", fixture.workUri, "--config", configPath],
    {
      cwd: packageRoot,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdoutChunks = [];
  const stderrChunks = [];
  const events = [];
  const waiters = [];
  let stderrBuffer = "";
  const observeLine = (line) => {
    const event = parseProgressLine(line);
    if (!event) return;
    events.push(event);
    for (const waiter of [...waiters]) {
      if (event.phase !== waiter.phase) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  };
  child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => {
    const value = Buffer.from(chunk).toString("utf8");
    stderrChunks.push(Buffer.from(value));
    stderrBuffer += value;
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) observeLine(line.trim());
  });
  const result = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      if (stderrBuffer.trim()) observeLine(stderrBuffer.trim());
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      let terminal = null;
      try {
        terminal = JSON.parse(stdout.trim());
      } catch {
        terminal = null;
      }
      resolve({ code, signal, stdout, stderr, events: [...events], terminal });
    });
  });
  return {
    child,
    result,
    waitForPhase: (phase, timeoutMs = 5_000) => {
      const existing = events.find((event) => event.phase === phase);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`phase ${phase} not observed`));
        }, timeoutMs);
        waiters.push({ phase, resolve, reject, timer });
      });
    },
  };
};

export const directCommand = (fixture, configPath = fixture.configPath) => {
  const environment = Object.entries(fixture.environment)
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");
  return [
    "env",
    environment,
    shellQuote(process.execPath),
    shellQuote(CLI_PATH),
    "run",
    shellQuote(fixture.workUri),
    "--config",
    shellQuote(configPath),
  ].join(" ");
};

export const exerciseGithubAdapter = async (fixture) => {
  const branch = `feat/github-fixture-${fixture.identity}`;
  await runGit(fixture.repositoryRoot, [
    "switch",
    "--create",
    branch,
    fixture.baseRevision,
  ]);
  await writeFile(
    join(fixture.repositoryRoot, "github-fixture.txt"),
    `github-${fixture.identity}\n`,
  );
  await runGit(fixture.repositoryRoot, ["add", "github-fixture.txt"]);
  await runGit(fixture.repositoryRoot, [
    "commit",
    "--quiet",
    "-m",
    "github fixture",
  ]);
  await runGit(fixture.repositoryRoot, ["push", "--quiet", "origin", branch]);

  const config = JSON.parse(JSON.stringify(fixture.config));
  config.repository.permissions = {
    commit: true,
    push: true,
    pull_request: true,
  };
  const resolved = resolveProviders(config, fixture.environment);
  return resolved.providers.scm.createDraftPullRequest(
    {
      repository: config.repository.id,
      head: branch,
      base: config.repository.base_branch,
      title: "Fixture draft pull request",
      body: "Fixture provider boundary smoke.",
    },
    { signal: new AbortController().signal },
  );
};

export const pathExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const environmentWithout = (fixture, ...names) => {
  const environment = { ...fixture.environment };
  for (const name of names) delete environment[name];
  return environment;
};
