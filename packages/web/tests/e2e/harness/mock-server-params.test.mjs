import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import {
  akbCreateComment,
  akbUpdateComment,
  createAkbAdapter,
} from "@reef/core";

const require = createRequire(import.meta.url);
const fixtureLogin = require("./fixture-login.json");
const MOCK_SERVER_PATH = fileURLToPath(
  new URL("./mock-server.mjs", import.meta.url),
);

let fixtureProcess;
let fixtureToken;
let fixtureUrl;

before(async () => {
  const port = await reservePort();
  fixtureProcess = spawn(process.execPath, [MOCK_SERVER_PATH], {
    env: {
      ...process.env,
      REEF_E2E_MOCK_HOST: "127.0.0.1",
      REEF_E2E_MOCK_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  fixtureProcess.stderr.resume();
  fixtureUrl = `http://127.0.0.1:${port}`;
  await waitForHealth();
  const login = await requestJson("/akb/api/v1/auth/login", {
    method: "POST",
    body: fixtureLogin,
  });
  fixtureToken = login.token;
});

after(async () => {
  if (!fixtureProcess || fixtureProcess.exitCode !== null) return;
  fixtureProcess.kill("SIGTERM");
  await once(fixtureProcess, "exit");
});

test("mock SQL fixture materializes positional params before its existing parser", async () => {
  await requestJson("/__e2e/reset", {
    method: "POST",
    body: { scenario: "configured" },
  });

  const special = String.raw`댓글 ' \\ 한글 🧪`;
  await postSql(
    "INSERT INTO reef_settings (key, value) VALUES ($1, $2::json)",
    ["special_key", JSON.stringify(special)],
  );
  const settings = await postSql(
    "SELECT key, value FROM reef_settings WHERE key = $1",
    ["special_key"],
  );
  assert.equal(settings.items.length, 1);
  assert.equal(JSON.parse(settings.items[0].value), special);

  await postSql('UPDATE reef_issues SET "title" = $1 WHERE "reef_id" = $2', [
    special,
    "REEF-001",
  ]);
  await postSql(
    "INSERT INTO monitored_repos (github_id, owner, name, description) VALUES ($1, $2, $3, $4)",
    [123456, "acme", "repo", null],
  );
  await postSql(
    "INSERT INTO reef_comments (reef_id, body, meta) VALUES ($1, $2, $3::jsonb)",
    [
      "REEF-001",
      special,
      JSON.stringify({ author: "alice", mention_recipients: ["한글😀"] }),
    ],
  );

  const state = await requestJson("/__e2e/state");
  const vault = state.vaults.find((candidate) => candidate.name === "reef-e2e");
  assert.ok(vault);
  assert.equal(
    vault.issues.find((issue) => issue.id === "REEF-001").title,
    special,
  );
  assert.deepEqual(vault.monitored_repos, [
    { github_id: 123456, owner: "acme", name: "repo" },
  ]);

  const comments = await postSql(
    "SELECT * FROM reef_comments WHERE reef_id = $1",
    ["REEF-001"],
  );
  const comment = comments.items.find((item) => item.body === special);
  assert.deepEqual(comment?.meta, {
    author: "alice",
    mention_recipients: ["한글😀"],
  });
});

test("preserves consecutive backslashes through production comment create and update SQL", async () => {
  await requestJson("/__e2e/reset", {
    method: "POST",
    body: { scenario: "configured" },
  });
  const adapter = createAkbAdapter({
    baseUrl: `${fixtureUrl}/akb`,
    jwt: fixtureToken,
  });
  const original = String.raw`댓글 ' \\ 한글 🧪`;
  const created = await akbCreateComment(
    adapter,
    "reef-e2e",
    "REEF-001",
    original,
    "alice",
    undefined,
    { createdAt: "2026-06-18T04:00:00.000Z", editedAt: null },
  );
  assert.equal(created.body, original);

  const edited = String.raw`수정 댓글 ' \\ 한글 🚀`;
  const updated = await akbUpdateComment(
    adapter,
    "reef-e2e",
    "REEF-001",
    created.id,
    edited,
    "alice",
  );
  assert.equal(updated.body, edited);

  const state = await requestJson("/__e2e/state");
  const vault = state.vaults.find((candidate) => candidate.name === "reef-e2e");
  assert.ok(vault);
  assert.equal(
    vault.comments.find((comment) => comment.id === created.id).body,
    edited,
  );
});

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForHealth() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (fixtureProcess.exitCode !== null) {
      throw new Error(`fixture exited with code ${fixtureProcess.exitCode}`);
    }
    try {
      const response = await fetch(`${fixtureUrl}/__e2e/health`);
      if (response.ok) return;
    } catch {
      // The fixture may need a few milliseconds to bind its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fixture did not become healthy at ${fixtureUrl}`);
}

async function requestJson(path, { method = "GET", body, headers } = {}) {
  const response = await fetch(`${fixtureUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

async function postSql(sql, params) {
  return requestJson("/akb/api/v1/tables/reef-e2e/sql", {
    method: "POST",
    body: { sql, params },
    headers: { authorization: `Bearer ${fixtureToken}` },
  });
}
