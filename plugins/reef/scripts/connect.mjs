import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const RESOURCE_METADATA = "/.well-known/oauth-protected-resource/mcp";
const ISSUER_METADATA = "/.well-known/oauth-authorization-server";
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
const NATIVE_NAME = /^[A-Za-z0-9_-]+$/u;

export function reefResource(input) {
  const value = input?.trim();
  const match = /^(https?):\/\/([^/?#\\\s]+)(\/|\/mcp\/?)?$/iu.exec(
    value ?? "",
  );
  const url = match ? URL.parse(value) : null;
  if (
    !url ||
    match[2].includes("@") ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
  ) {
    throw new Error(
      "Enter the HTTPS Reef deployment URL or its /mcp URL. HTTP requires a local loopback fixture.",
    );
  }
  return `${url.origin}/mcp`;
}

async function preflight(resource) {
  const { origin } = new URL(resource);
  async function discover(path) {
    const response = await fetch(origin + path, {
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const metadata = await response.json();
    if (response.status === 404 && metadata.error === "reef_sso_required") {
      throw new Error(
        "This Reef deployment requires OAuth/SSO for the Codex plugin. Contact your Reef administrator.",
      );
    }
    if (!response.ok)
      throw new Error(
        "Reef OAuth discovery failed. Check the deployment URL and retry.",
      );
    return metadata;
  }

  const protectedResource = await discover(RESOURCE_METADATA);
  if (
    protectedResource?.resource !== resource ||
    protectedResource.authorization_servers?.length !== 1 ||
    protectedResource.authorization_servers[0] !== origin
  ) {
    throw new Error(
      "The URL did not identify the deployment's canonical Reef MCP endpoint.",
    );
  }

  const issuer = await discover(ISSUER_METADATA);
  if (
    issuer?.issuer !== origin ||
    ![
      "authorization_endpoint",
      "token_endpoint",
      "registration_endpoint",
    ].every((key) => {
      const url =
        typeof issuer[key] === "string" ? URL.parse(issuer[key]) : null;
      return (
        url?.origin === origin &&
        !url.username &&
        !url.password &&
        url.href === origin + url.pathname
      );
    }) ||
    !issuer.code_challenge_methods_supported?.includes("S256")
  ) {
    throw new Error(
      "The deployment did not advertise Reef's native OAuth setup. Check the deployment URL and retry.",
    );
  }
}

function compatible(entry, resource) {
  return (
    entry?.url === resource &&
    entry.enabled !== false &&
    ![
      "bearer_token_env_var",
      "http_headers",
      "env_http_headers",
      "oauth",
      "oauth_client_id",
      "oauth_resource",
    ].some((key) => Object.hasOwn(entry, key))
  );
}

async function withConfig(call) {
  const process = spawn("codex", ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const spawned = once(process, "spawn");
  const timer = setTimeout(() => process.kill(), 15_000);
  try {
    await spawned;
    const lines = createInterface({ input: process.stdout })[
      Symbol.asyncIterator
    ]();
    let sequence = 0;
    function send(message) {
      process.stdin.write(`${JSON.stringify(message)}\n`);
    }
    async function rpc(method, params) {
      const id = ++sequence;
      send({ id, method, params });
      for (;;) {
        const line = await lines.next();
        if (line.done)
          throw new Error(
            "Codex config did not respond. Check that the Codex CLI is available.",
          );
        const reply = JSON.parse(line.value);
        if (reply.id !== id) continue;
        if (reply.error) {
          throw new Error(
            "Codex could not update the connection. Check its configuration and run Reef setup again.",
          );
        }
        return reply.result;
      }
    }
    await rpc("initialize", {
      clientInfo: { name: "reef-setup", version: "0.1.0" },
    });
    send({ method: "initialized", params: {} });
    return await call(rpc);
  } finally {
    clearTimeout(timer);
    process.stdin.end();
    process.kill();
  }
}

export async function register(resource) {
  return withConfig(async (rpc) => {
    const inspect = () =>
      rpc("config/read", { includeLayers: true, cwd: process.cwd() });
    const current = await inspect();
    const entries = current.config.mcp_servers ?? {};
    for (const [name, entry] of Object.entries(entries)) {
      if (NATIVE_NAME.test(name) && compatible(entry, resource)) {
        return { name, registration: "existing" };
      }
    }
    const name =
      "reef-" +
      createHash("sha256").update(resource).digest("hex").slice(0, 12);
    if (
      Object.hasOwn(entries, name) ||
      current.layers?.some((layer) =>
        Object.hasOwn(layer.config?.mcp_servers ?? {}, name),
      )
    ) {
      throw new Error(
        "A different Codex connection already uses Reef's connection name. Review it in Codex settings and retry.",
      );
    }
    const user = current.layers?.find(
      (layer) => layer.name.type === "user" && layer.name.profile === null,
    );
    if (typeof user?.version !== "string")
      throw new Error("Codex did not provide a writable user configuration.");
    await rpc("config/value/write", {
      keyPath: `mcp_servers.${name}`,
      value: { url: resource },
      mergeStrategy: "replace",
      filePath: user.name.file,
      expectedVersion: user.version,
    });
    const saved = await inspect();
    if (!compatible(saved.config.mcp_servers?.[name], resource)) {
      throw new Error(
        "Codex did not load the saved Reef connection. Review its settings and retry.",
      );
    }
    return { name, registration: "saved" };
  });
}

async function connect(input) {
  let registration = "not_saved";
  try {
    const resource = reefResource(input);
    await preflight(resource);
    const connection = await register(resource);
    registration = connection.registration;
    console.log(
      JSON.stringify({
        registration,
        oauth: "pending",
        ui: "unverified",
        next: "Complete Reef sign-in and allow read access in the browser.",
      }),
    );
    const child = spawn(
      "codex",
      ["mcp", "login", connection.name, "--oauth-client-registration", "dcr"],
      {
        stdio: "ignore",
      },
    );
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1_000);
    let code;
    try {
      [code] = await once(child, "exit");
    } finally {
      clearTimeout(timer);
    }
    if (code !== 0) {
      throw new Error(
        "Browser sign-in did not finish. Run Reef setup again and approve access in the browser.",
      );
    }
    console.log(
      JSON.stringify({
        registration,
        oauth: "complete",
        ui: "unverified",
        next: "Open a new Codex conversation and ask: Open the Reef Issue Picker.",
      }),
    );
  } catch (error) {
    const message =
      error instanceof TypeError || error instanceof SyntaxError
        ? "Reef is unreachable or its OAuth metadata is invalid. Check the deployment URL and retry."
        : error.code === "ENOENT"
          ? "Install the Codex CLI for this desktop host and run Reef setup again."
          : error.message;
    console.log(
      JSON.stringify({
        registration,
        oauth: "incomplete",
        ui: "unverified",
        next: message,
      }),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await connect(process.argv[2]);
}
