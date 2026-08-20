// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createAuthV2SessionCipher } from "./sessionCipher";
import { createAuthV2LoginStateStore, loginKey } from "./loginStateStore";
import type { AuthV2SessionBackend } from "./sessionStore";

class MemoryBackend implements AuthV2SessionBackend {
  readonly values = new Map<string, string>();
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async del(key: string) {
    this.values.delete(key);
  }
  async consume(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async replace(key: string, expectedValue: string, value: string) {
    if (this.values.get(key) !== expectedValue) return false;
    this.values.set(key, value);
    return true;
  }
}

function store(backend: MemoryBackend, now = 2_000) {
  return createAuthV2LoginStateStore({
    backend,
    cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(5)),
    now: () => now,
  });
}

describe("auth-v2 login state store", () => {
  it("stores encrypted state and consumes it exactly once", async () => {
    const backend = new MemoryBackend();
    const stateStore = store(backend);
    const issued = await stateStore.issue({
      providerAlias: "workforce",
      redirectPath: "/workspace/reef/issues",
      clientId: "reef-web",
      codeVerifier: "v".repeat(64),
      nonce: "n".repeat(43),
    });

    const encrypted = backend.values.get(loginKey(issued.state));
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toContain("v".repeat(64));
    await expect(
      stateStore.consume(issued.state, "w".repeat(43)),
    ).resolves.toBeNull();
    await expect(
      stateStore.consume(issued.state, issued.browserBinding),
    ).resolves.toBeNull();
  });

  it("requires the browser binding and prevents a second consume", async () => {
    const backend = new MemoryBackend();
    const stateStore = store(backend);
    const issued = await stateStore.issue({
      providerAlias: "workforce",
      redirectPath: "/login",
      clientId: "reef-web",
      codeVerifier: "v".repeat(64),
      nonce: "n".repeat(43),
    });
    const result = await stateStore.consume(
      issued.state,
      issued.browserBinding,
    );
    expect(result).toMatchObject({
      provider_alias: "workforce",
      client_id: "reef-web",
    });
    await expect(
      stateStore.consume(issued.state, issued.browserBinding),
    ).resolves.toBeNull();
  });

  it("rejects expired state before it can produce a transaction", async () => {
    const backend = new MemoryBackend();
    const stateStore = createAuthV2LoginStateStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(6)),
      now: () => 1_000,
    });
    const issued = await stateStore.issue({
      providerAlias: "workforce",
      redirectPath: "/login",
      clientId: "reef-web",
      codeVerifier: "v".repeat(64),
      nonce: "n".repeat(43),
      ttlSeconds: 1,
    });
    const expiredStore = createAuthV2LoginStateStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(6)),
      now: () => 1_001,
    });
    await expect(
      expiredStore.consume(issued.state, issued.browserBinding),
    ).resolves.toBeNull();
  });
});
