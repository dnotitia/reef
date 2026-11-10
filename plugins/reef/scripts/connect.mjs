import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const RESOURCE_METADATA = "/.well-known/oauth-protected-resource/mcp";
const ISSUER_METADATA = "/.well-known/oauth-authorization-server";
const READ_SCOPE = "reef:issues:read";
const SCOPES = ["openid", "profile", "email", READ_SCOPE];
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
  const { origin, hostname } = new URL(resource);
  async function discover(url) {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    const metadata = await response.json();
    if (response.status === 404 && metadata.error === "reef_sso_required") {
      throw new Error(
        "This Reef deployment does not have Codex OAuth enabled. Contact your Reef administrator.",
      );
    }
    if (!response.ok)
      throw new Error(
        "Reef OAuth discovery failed. Check the deployment URL and retry.",
      );
    return metadata;
  }

  const protectedResource = await discover(origin + RESOURCE_METADATA);
  const servers = protectedResource?.authorization_servers;
  const issuerUrl =
    Array.isArray(servers) && servers.length === 1
      ? publicUrl(servers[0])
      : null;
  if (
    protectedResource?.resource !== resource ||
    !Array.isArray(protectedResource.scopes_supported) ||
    !protectedResource.scopes_supported.includes(READ_SCOPE) ||
    !issuerUrl ||
    (issuerUrl.protocol === "http:" && !LOOPBACK.has(hostname)) ||
    !/^\/realms\/[A-Za-z0-9._~-]+$/u.test(issuerUrl.pathname)
  ) {
    throw new Error(
      "The URL did not identify the deployment's canonical Reef MCP endpoint.",
    );
  }

  const issuer = await discover(
    issuerUrl.origin + ISSUER_METADATA + issuerUrl.pathname,
  );
  if (
    issuer?.issuer !== issuerUrl.href ||
    ![
      "authorization_endpoint",
      "token_endpoint",
      "registration_endpoint",
    ].every((key) => {
      const url = publicUrl(issuer[key]);
      return (
        url?.origin === issuerUrl.origin &&
        url.pathname.startsWith(`${issuerUrl.pathname}/`)
      );
    }) ||
    !Array.isArray(issuer.code_challenge_methods_supported) ||
    !issuer.code_challenge_methods_supported.includes("S256")
  ) {
    throw new Error(
      "The deployment did not advertise Reef's native OAuth setup. Check the deployment URL and retry.",
    );
  }
}

function publicUrl(value) {
  const url = typeof value === "string" ? URL.parse(value) : null;
  if (
    !url ||
    url.href !== url.origin + url.pathname ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
  )
    return null;
  return url;
}

function compatible(entry, resource) {
  return (
    entry?.url === resource &&
    entry.enabled !== false &&
    entry.oauth_resource === resource &&
    Array.isArray(entry.scopes) &&
    entry.scopes.length === SCOPES.length &&
    SCOPES.every((scope) => entry.scopes.includes(scope)) &&
    ![
      "bearer_token_env_var",
      "http_headers",
      "env_http_headers",
      "http_headers_helper",
      "oauth",
      "oauth_client_id",
      "auth",
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
      value: { url: resource, scopes: SCOPES, oauth_resource: resource },
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
        next: "Sign in to Keycloak and approve Reef issue read access in the browser.",
      }),
    );
    const child = spawn(
      "codex",
      [
        "mcp",
        "login",
        connection.name,
        "--oauth-client-registration",
        "dcr",
        "--scopes",
        SCOPES.join(","),
      ],
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
