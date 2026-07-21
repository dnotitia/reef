#!/usr/bin/env node

import { createServer } from "node:http";

const port = Number(process.env.MOCK_AKB_PORT ?? "8765");
const scenario = process.env.MOCK_AKB_SCENARIO ?? "success";
const sentinel = process.env.MOCK_AKB_SENTINEL ?? "fixture-sentinel";
const account = "reef-migrator";
const vaults = ["raw", "reef-a", "reef-b", "reef-c"];
const tables = new Map(vaults.map((vault) => [vault, new Set()]));
const state = {
  requests: [],
  tableCreates: [],
  ensureStarts: [],
  failedOnce: false,
};

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const tableQuery = (items = []) => ({
  kind: "table_query",
  columns: items.length > 0 ? Object.keys(items[0]) : [],
  items,
  total: items.length,
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const body = await readBody(request);
  const safePath = url.pathname;
  state.requests.push(`${request.method} ${safePath}`);

  if (safePath === "/__state") {
    return json(response, 200, {
      ...state,
      tables: Object.fromEntries(
        [...tables].map(([vault, names]) => [vault, [...names].sort()]),
      ),
    });
  }
  if (safePath === "/api/v1/auth/me") {
    return json(response, 200, {
      user_id: "service-fixture",
      username: account,
      is_admin: false,
      auth_method: "service_key",
      key_class: "service",
    });
  }
  if (safePath === "/api/v1/my/vaults") {
    return json(response, 200, {
      vaults: vaults.map((name) => ({
        name,
        role: name === "raw" ? "reader" : "writer",
      })),
    });
  }

  const membersMatch = safePath.match(/^\/api\/v1\/vaults\/([^/]+)\/members$/);
  if (membersMatch) {
    const vault = decodeURIComponent(membersMatch[1]);
    const role =
      scenario === "preflight-failure" && vault === "reef-b"
        ? "reader"
        : "writer";
    return json(response, 200, {
      members: [{ username: account, role }],
    });
  }

  const sqlMatch = safePath.match(/^\/api\/v1\/tables\/([^/]+)\/sql$/);
  if (sqlMatch) {
    const vault = decodeURIComponent(sqlMatch[1]);
    const sql = String(body?.sql ?? "");
    if (sql.includes("WHERE key IN")) {
      return json(
        response,
        200,
        tableQuery(
          vault === "raw" ? [] : [{ key: "project_prefix", value: '"REEF"' }],
        ),
      );
    }
    if (sql.includes("monitored_repos"))
      return json(response, 200, tableQuery([]));
    if (sql.includes("schema_version") && sql.startsWith("SELECT")) {
      return json(response, 200, tableQuery([{ value: '{"version":0}' }]));
    }
    return json(response, 200, {
      kind: "table_sql",
      result: "OK",
      affected_rows: 1,
    });
  }

  const tablesMatch = safePath.match(/^\/api\/v1\/tables\/([^/]+)$/);
  if (tablesMatch && request.method === "GET") {
    const vault = decodeURIComponent(tablesMatch[1]);
    state.ensureStarts.push(vault);
    if (
      scenario === "workspace-failure" &&
      vault === "reef-b" &&
      !state.failedOnce
    ) {
      state.failedOnce = true;
      return json(response, 500, { detail: `upstream ${sentinel}` });
    }
    if (scenario === "sentinel-error" && vault === "reef-a") {
      return json(response, 500, {
        detail: `Authorization: Bearer ${sentinel}`,
      });
    }
    return json(response, 200, {
      kind: "table",
      vault,
      items: [...(tables.get(vault) ?? [])].map((name) => ({ name })),
    });
  }
  if (tablesMatch && request.method === "POST") {
    const vault = decodeURIComponent(tablesMatch[1]);
    const name = String(body?.name ?? "unknown");
    tables.get(vault)?.add(name);
    state.tableCreates.push(`${vault}:${name}`);
    return json(response, 200, { kind: "table", vault, name });
  }

  return json(response, 404, { detail: "fixture route not found" });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mock-akb-ready:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
