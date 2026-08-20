// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createAuthV2SessionCipher,
  AuthV2SessionCipherError,
} from "./sessionCipher";
import {
  createAuthV2SessionStore,
  hashHandle,
  type AuthV2SessionBackend,
  type AuthV2SessionRecord,
  sessionKey,
} from "./sessionStore";

class MemoryBackend implements AuthV2SessionBackend {
  readonly values = new Map<string, string>();
  readonly ttls: number[] = [];
  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, value);
    this.ttls.push(ttlSeconds);
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

const RECORD: AuthV2SessionRecord = {
  provider_alias: "workforce",
  subject: "kc-user-1",
  access_token: "access-secret",
  refresh_token: "refresh-secret",
  id_token: "id-secret",
  issued_at: 1_000,
  access_token_expires_at: 1_900,
  absolute_expires_at: 3_000,
};

describe("auth-v2 encrypted session store", () => {
  it("stores only a hash-keyed ciphertext and returns an opaque handle", async () => {
    const backend = new MemoryBackend();
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(7)),
      now: () => 1_100,
    });

    const issued = await store.issue(RECORD);

    expect(issued.handle).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect([...backend.values.keys()]).toEqual([sessionKey(issued.handle)]);
    expect(sessionKey(issued.handle)).not.toContain(issued.handle);
    expect([...backend.values.values()][0]).not.toContain("access-secret");
    expect([...backend.values.values()][0]).not.toContain("refresh-secret");
    expect([...backend.values.values()][0]).not.toContain("id-secret");
    expect(backend.ttls).toEqual([1_900]);
    await expect(store.resolve(issued.handle)).resolves.toEqual(RECORD);
  });

  it("keeps an expired access token available for refresh until the absolute deadline", async () => {
    const backend = new MemoryBackend();
    let now = 1_100;
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(10)),
      now: () => now,
    });

    const issued = await store.issue({
      ...RECORD,
      access_token_expires_at: 1_900,
      absolute_expires_at: 3_000,
    });
    now = 2_000;
    await expect(store.resolve(issued.handle)).resolves.toMatchObject({
      access_token_expires_at: 1_900,
      refresh_token: "refresh-secret",
    });
  });

  it("never extends the absolute deadline during a refresh-shaped record update", async () => {
    const backend = new MemoryBackend();
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(8)),
      now: () => 2_950,
    });

    await expect(store.issue({ ...RECORD, issued_at: 2_900 })).rejects.toThrow(
      "auth_v2_session_store_invalid",
    );
  });

  it("rejects ciphertext moved to a different hash-keyed record", async () => {
    const backend = new MemoryBackend();
    const cipher = createAuthV2SessionCipher(new Uint8Array(32).fill(9));
    const store = createAuthV2SessionStore({
      backend,
      cipher,
      now: () => 1_100,
    });
    const issued = await store.issue(RECORD);
    const source = sessionKey(issued.handle);
    const otherHandle = "b".repeat(43);
    const sourceCiphertext = backend.values.get(source);
    expect(sourceCiphertext).toBeDefined();
    if (!sourceCiphertext) throw new Error("expected source ciphertext");
    backend.values.set(sessionKey(otherHandle), sourceCiphertext);

    await expect(store.resolve(otherHandle)).rejects.toThrow(
      "auth_v2_session_store_invalid",
    );
    expect(backend.values.has(sessionKey(otherHandle))).toBe(false);
  });

  it("does not treat arbitrary browser strings as session handles", async () => {
    const backend = new MemoryBackend();
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32)),
    });
    await expect(store.resolve("access-secret")).resolves.toBeNull();
    await expect(store.revoke("access-secret")).resolves.toBeUndefined();
    expect(hashHandle("access-secret")).not.toContain("access-secret");
  });

  it("requires an independent 32-byte key", () => {
    expect(() => createAuthV2SessionCipher(new Uint8Array(31))).toThrow(
      AuthV2SessionCipherError,
    );
  });

  it("rotates ciphertext atomically without extending the absolute deadline", async () => {
    const backend = new MemoryBackend();
    const cipher = createAuthV2SessionCipher(new Uint8Array(32).fill(3));
    const store = createAuthV2SessionStore({
      backend,
      cipher,
      now: () => 1_100,
    });
    const issued = await store.issue(RECORD);
    const replacement = {
      ...RECORD,
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      access_token_expires_at: 1_800,
      absolute_expires_at: 3_000,
    };
    await expect(
      store.replace(issued.handle, RECORD, replacement),
    ).resolves.toBe(true);
    await expect(store.resolve(issued.handle)).resolves.toEqual(replacement);
    await expect(
      store.replace(issued.handle, RECORD, {
        ...replacement,
        absolute_expires_at: 4_000,
      }),
    ).resolves.toBe(false);
  });
});
