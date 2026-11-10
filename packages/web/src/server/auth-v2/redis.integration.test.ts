// @vitest-environment node
import { describe, expect, it } from "vitest";
import { connectAuthV2Redis } from "./redisRuntime";

const redisUrl = process.env.REEF_TEST_REDIS_URL;

describe.skipIf(!redisUrl)("real Redis auth-v2 backend", () => {
  it("supports encrypted-record primitives, CAS, sets, and refresh locks", async () => {
    if (!redisUrl) return;
    const runtime = await connectAuthV2Redis({
      enabled: true,
      mode: "sso",
      issuer: "https://idp.test/realms/reef",
      transportUrl: "https://idp.test/realms/reef",
      clientId: "reef-web",
      audience: "https://akb.test/api",
      publicOrigin: "https://reef.test",
      redisUrl,
      encryptionKey: new Uint8Array(32),
      sessionNamespace: "reef-test",
    });
    const key = `reef-test:auth-v2:test:${Date.now()}`;
    await runtime.backend.set(key, "ciphertext", 30);
    await expect(runtime.backend.get(key)).resolves.toBe("ciphertext");
    await expect(
      runtime.backend.replace(key, "ciphertext", "rotated", 30),
    ).resolves.toBe(true);
    await expect(runtime.backend.get(key)).resolves.toBe("rotated");
    await runtime.backend.addToSet?.(`${key}:set`, "handle", 30);
    await expect(runtime.backend.members?.(`${key}:set`)).resolves.toContain(
      "handle",
    );
    const owner = await runtime.refreshLock.acquire("A".repeat(43), 10);
    expect(owner).toBeTruthy();
    await expect(
      runtime.refreshLock.acquire("A".repeat(43), 10),
    ).resolves.toBeNull();
    if (owner) await runtime.refreshLock.release("A".repeat(43), owner);
    await runtime.backend.del(key);
    await runtime.close();
  });
});
