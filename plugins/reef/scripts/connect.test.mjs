import assert from "node:assert/strict";
import test from "node:test";
import { reefResource } from "./connect.mjs";

test("canonicalizes Reef deployment URLs and isolated loopback URLs", () => {
  assert.equal(
    reefResource(" https://reef.example/ "),
    "https://reef.example/mcp",
  );
  assert.equal(
    reefResource("https://reef.example/mcp/"),
    "https://reef.example/mcp",
  );
  assert.equal(reefResource("http://[::1]:7333"), "http://[::1]:7333/mcp");
});

test("rejects non-Reef paths, credentials, query, fragments and remote HTTP", () => {
  for (const url of [
    "https://reef.example/path",
    "https://reef.example/a/../mcp",
    "https://user:password@reef.example",
    "https://reef.example/mcp?",
    "https://reef.example#",
    "https://reef.example\\other.example/mcp",
    "file:///var/run/reef",
    "http://reef.example/mcp",
  ]) {
    assert.throws(() => reefResource(url), /Enter the HTTPS Reef/u);
  }
});

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const path = process.env.REEF_FAKE_CODEX_STATE;
const state = JSON.parse(fs.readFileSync(path, "utf8"));
const save = () => fs.writeFileSync(path, JSON.stringify(state));
const args = process.argv.slice(2);
if (args[0] === "mcp" && args[1] === "login") {
  state.logins.push(args.slice(2));
  save();
  process.exit(0);
}
if (args[0] !== "app-server") process.exit(2);
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  const reply = (result) => console.log(JSON.stringify({ id, result }));
  if (method === "initialize") return reply({});
  if (method === "config/read") {
    const user = { type: "user", profile: null, file: "/fixture/config.toml" };
    return reply({ config: state.config, layers: [{ name: user, config: state.config, version: state.version }] });
  }
  if (method !== "config/value/write") process.exit(2);
  state.writes.push(params);
  if (state.conflict || params.expectedVersion !== state.version) {
    save();
    return console.log(JSON.stringify({ id, error: { code: -32600 } }));
  }
  const name = params.keyPath.split(".")[1];
  state.config.mcp_servers[name] = params.value;
  state.version = "updated";
  save();
  reply({ status: "ok" });
});
`;

test("onboarding preserves config, reuses a match and rejects collisions and stale writes", async () => {
  const { spawn } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { once } = await import("node:events");
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { createServer } = await import("node:http");
  const { tmpdir } = await import("node:os");
  const { delimiter, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const directory = await mkdtemp(join(tmpdir(), "reef-connect-test-"));
  const statePath = join(directory, "state.json");
  const server = createServer((request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const metadata =
      request.url === "/.well-known/oauth-protected-resource/mcp"
        ? { resource: `${origin}/mcp`, authorization_servers: [origin] }
        : {
            issuer: origin,
            authorization_endpoint: `${origin}/oauth/authorize`,
            registration_endpoint: `${origin}/oauth/register`,
            token_endpoint: `${origin}/oauth/token`,
            code_challenge_methods_supported: ["S256"],
          };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(metadata));
  });
  async function run(resource) {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./connect.mjs", import.meta.url)), resource],
      {
        env: {
          ...process.env,
          PATH: [directory, process.env.PATH].join(delimiter),
          REEF_FAKE_CODEX_STATE: statePath,
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const exited = once(child, "close");
    const timer = setTimeout(() => child.kill(), 10_000);
    try {
      let output = "";
      for await (const chunk of child.stdout) output += chunk;
      const [code] = await exited;
      return { code, result: JSON.parse(output.trim().split("\n").at(-1)) };
    } finally {
      clearTimeout(timer);
    }
  }
  const read = async () => JSON.parse(await readFile(statePath, "utf8"));
  const save = (state) => writeFile(statePath, JSON.stringify(state));
  try {
    await writeFile(join(directory, "codex"), FAKE_CODEX, { mode: 0o700 });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const resource = `http://127.0.0.1:${server.address().port}/mcp`;
    const name = `reef-${createHash("sha256").update(resource).digest("hex").slice(0, 12)}`;
    const original = {
      model: "unrelated-model",
      mcp_servers: { other: { command: "unrelated-command" } },
    };
    const initial = {
      config: original,
      version: "initial",
      writes: [],
      logins: [],
    };

    await save(initial);
    const saved = await run(resource);
    assert.equal(saved.code, 0);
    assert.equal(saved.result.registration, "saved");
    const rerun = await run(resource);
    assert.equal(rerun.code, 0);
    assert.equal(rerun.result.registration, "existing");
    assert.deepEqual((await read()).config, {
      ...original,
      mcp_servers: { ...original.mcp_servers, [name]: { url: resource } },
    });
    assert.equal((await read()).writes.length, 1);
    assert.equal((await read()).writes[0].expectedVersion, "initial");
    assert.deepEqual((await read()).logins, [
      [name, "--oauth-client-registration", "dcr"],
      [name, "--oauth-client-registration", "dcr"],
    ]);

    const collision = {
      ...original,
      mcp_servers: { ...original.mcp_servers, [name]: { command: "other" } },
    };
    await save({ ...initial, config: collision });
    const collided = await run(resource);
    assert.equal(collided.code, 1);
    assert.match(collided.result.next, /already uses Reef's connection name/u);
    assert.deepEqual(await read(), { ...initial, config: collision });

    await save({ ...initial, conflict: true });
    const raced = await run(resource);
    assert.equal(raced.code, 1);
    assert.match(raced.result.next, /could not update the connection/u);
    assert.deepEqual((await read()).config, original);
    assert.equal((await read()).writes[0].expectedVersion, "initial");
    assert.deepEqual((await read()).logins, []);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
