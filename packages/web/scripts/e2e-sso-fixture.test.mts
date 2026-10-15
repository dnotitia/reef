// @vitest-environment node
import { expect, it } from "vitest";
import { createRedisFixture } from "../tests/e2e/harness/mock-redis.mjs";
import { connectAuthV2Redis } from "../src/server/auth-v2/redisRuntime";

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
