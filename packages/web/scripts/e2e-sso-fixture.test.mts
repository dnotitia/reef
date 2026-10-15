// @vitest-environment node
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { request } from "node:https";
import { expect, it, vi } from "vitest";
import { createRedisFixture } from "../tests/e2e/harness/mock-redis.mjs";
import { startSsoFixture } from "../tests/e2e/harness/mock-sso.mjs";
import { connectAuthV2Redis } from "../src/server/auth-v2/redisRuntime";

it("proxies paths only to the configured Reef server and rejects alternate destinations", async () => {
  const received: string[] = [];
  const web = createServer((req, res) => {
    received.push(req.url ?? "");
    res.end("reef upstream");
  });
  web.listen(0, "127.0.0.1");
  await once(web, "listening");
  const address = web.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const port = address.port;
  vi.stubEnv("REEF_WEB_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("REEF_E2E_MOCK_URL", `http://127.0.0.1:${port + 1}`);
  const fixture = await startSsoFixture(() => ({}));
  const ca = await readFile(
    new URL("../tests/e2e/harness/sso/localhost-cert.pem", import.meta.url),
  );
  async function get(path: string) {
    return new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        const req = request(
          {
            hostname: "localhost",
            port: port + 3,
            path,
            ca,
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode, body }));
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
  }
  try {
    expect(await get("/api/auth/session?probe=1")).toEqual({
      status: 200,
      body: "reef upstream",
    });
    expect((await get("http://127.0.0.1:1/private")).status).toBe(400);
    expect((await get("//127.0.0.1:1/private")).status).toBe(400);
    // URL normalization may change the parsed host; the proxy destination stays fixed.
    expect(await get("/\\127.0.0.1:1/private")).toEqual({
      status: 200,
      body: "reef upstream",
    });
    expect(received).toEqual(["/api/auth/session?probe=1", "/private"]);
  } finally {
    fixture.close();
    web.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      web.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
  }
});

it("runs the real node-redis adapter against atomic auth custody and lock commands", async () => {
  const fixture = createRedisFixture();
  const port = await fixture.listen(0);
  const runtime = await connectAuthV2Redis({
    enabled: true,
    mode: "sso",
    issuer: "https://oidc.test/realms/reef",
    transportUrl: "http://fixture/realms/reef",
    clientId: "reef-e2e",
    audience: "reef-akb-e2e",
    publicOrigin: "https://reef.test",
    redisUrl: `redis://:fixture-password@localhost:${port}`,
    encryptionKey: new Uint8Array(32),
    sessionNamespace: "fixture-proof",
  });
  try {
    expect(await runtime.ping()).toBe("PONG");
    await runtime.backend.set("custody", "encrypted-record", 30);
    expect(fixture.records.get("custody")?.expiresAt).toBeGreaterThan(
      Date.now(),
    );
    expect(
      await runtime.backend.replace("custody", "wrong", "rotated", 30),
    ).toBe(false);
    expect(
      await runtime.backend.replace(
        "custody",
        "encrypted-record",
        "rotated",
        30,
      ),
    ).toBe(true);
    expect(await runtime.backend.consume("custody")).toBe("rotated");
    expect(await runtime.backend.consume("custody")).toBeNull();
    await runtime.backend.addToSet?.("sessions", "handle", 30);
    expect(await runtime.backend.members?.("sessions")).toEqual(["handle"]);
    await runtime.backend.removeFromSet?.("sessions", "handle");
    expect(await runtime.backend.members?.("sessions")).toEqual([]);
    const owner = await runtime.refreshLock.acquire("A".repeat(43));
    expect(owner).toBeTruthy();
    expect(await runtime.refreshLock.acquire("A".repeat(43))).toBeNull();
    await runtime.refreshLock.release("A".repeat(43), "B".repeat(43));
    expect(await runtime.refreshLock.acquire("A".repeat(43))).toBeNull();
    if (owner) await runtime.refreshLock.release("A".repeat(43), owner);
    expect(await runtime.refreshLock.acquire("A".repeat(43))).toBeTruthy();
    await runtime.backend.set("expired", "value", 30);
    const expired = fixture.records.get("expired");
    if (expired) expired.expiresAt = 0;
    expect(await runtime.backend.get("expired")).toBeNull();
    fixture.reset();
    expect(await runtime.backend.members?.("sessions")).toEqual([]);
  } finally {
    await runtime.close();
    fixture.close();
  }
});
