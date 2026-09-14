// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AUTH_V2_ABSOLUTE_LIFETIME_SECONDS,
  createAuthV2SessionStore,
  effectiveSessionExpiresAt,
  sessionKey,
  type AuthV2SessionBackend,
} from "./sessionStore";
import { createAuthV2SessionCipher } from "./sessionCipher";

class MemoryBackend implements AuthV2SessionBackend {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly setTtls: number[] = [];
  readonly replaceTtls: number[] = [];
  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, value);
    this.setTtls.push(ttlSeconds);
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async del(key: string) {
    this.values.delete(key);
    this.sets.delete(key);
  }
  async consume(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async replace(
    key: string,
    expected: string,
    value: string,
    ttlSeconds: number,
  ) {
    if (this.values.get(key) !== expected) return false;
    this.values.set(key, value);
    this.replaceTtls.push(ttlSeconds);
    return true;
  }
  async addToSet(key: string, member: string) {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }
  async members(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async removeFromSet(key: string, member: string) {
    this.sets.get(key)?.delete(member);
  }
}

const record = {
  provider_alias: "workforce",
  subject: "subject-1",
  session_id: "sid-1",
  access_token: "access",
  refresh_token: "refresh",
  id_token: "id",
  issued_at: 1_000,
  access_token_expires_at: 1_060,
  refresh_token_expires_at: 1_800,
  absolute_expires_at: 87_400,
};

describe("encrypted auth-v2 session store", () => {
  it("encrypts opaque records and resolves them by handle", async () => {
    const backend = new MemoryBackend();
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(7)),
      namespace: "one",
      now: () => 1_000,
    });
    const issued = await store.issue(record);
    expect(issued.handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toBe(record.absolute_expires_at);
    expect(backend.setTtls).toEqual([800]);
    expect([...backend.values.values()].join()).not.toContain("refresh");
    await expect(store.resolve(issued.handle)).resolves.toEqual(record);
  });

  it("uses the current refresh deadline until the fixed absolute deadline", async () => {
    expect(effectiveSessionExpiresAt(record)).toBe(1_800);
    expect(AUTH_V2_ABSOLUTE_LIFETIME_SECONDS).toBe(86_400);

    const backend = new MemoryBackend();
    let now = 1_000;
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(6)),
      now: () => now,
    });
    const issued = await store.issue(record);
    now = 1_500;
    const rotated = {
      ...record,
      refresh_token: "rotated-refresh",
      refresh_token_expires_at: 3_300,
    };

    await expect(store.replace(issued.handle, record, rotated)).resolves.toBe(
      true,
    );
    expect(backend.replaceTtls).toEqual([1_800]);
    await expect(store.resolve(issued.handle)).resolves.toEqual(rotated);
  });

  it("expires a record at the refresh deadline without waiting for Redis", async () => {
    const backend = new MemoryBackend();
    let now = 1_000;
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(5)),
      now: () => now,
    });
    const issued = await store.issue(record);
    now = record.refresh_token_expires_at;

    await expect(store.resolve(issued.handle)).resolves.toBeNull();
    expect(backend.values.size).toBe(0);
  });

  it("rejects the pre-rotation record shape without a compatibility path", async () => {
    const backend = new MemoryBackend();
    const cipher = createAuthV2SessionCipher(new Uint8Array(32).fill(3));
    const handle = "H".repeat(43);
    const key = sessionKey(handle);
    const legacy = { ...record } as Partial<typeof record>;
    delete legacy.refresh_token_expires_at;
    await backend.set(key, cipher.encrypt(JSON.stringify(legacy), key), 600);
    const store = createAuthV2SessionStore({
      backend,
      cipher,
      now: () => 1_000,
    });

    await expect(store.resolve(handle)).rejects.toMatchObject({
      name: "AuthV2SessionStoreError",
    });
    expect(backend.values.size).toBe(0);
  });

  it("uses compare-and-set for refresh rotation", async () => {
    const backend = new MemoryBackend();
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(8)),
      now: () => 1_000,
    });
    const issued = await store.issue(record);
    const next = {
      ...record,
      access_token: "next-access",
      access_token_expires_at: 1_500,
      refresh_token_expires_at: 2_000,
    };
    await expect(store.replace(issued.handle, record, next)).resolves.toBe(
      true,
    );
    await expect(
      store.replace(issued.handle, record, { ...next, access_token: "stale" }),
    ).resolves.toBe(false);
  });

  it("rejects any rotation that changes the Reef absolute deadline", async () => {
    const backend = new MemoryBackend();
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(4)),
      now: () => 1_000,
    });
    const issued = await store.issue(record);

    await expect(
      store.replace(issued.handle, record, {
        ...record,
        absolute_expires_at: record.absolute_expires_at - 1,
      }),
    ).resolves.toBe(false);
  });

  it("revokes every handle indexed by the OIDC sid", async () => {
    const backend = new MemoryBackend();
    const store = createAuthV2SessionStore({
      backend,
      cipher: createAuthV2SessionCipher(new Uint8Array(32).fill(9)),
      namespace: "one",
      now: () => 1_000,
    });
    const first = await store.issue(record);
    const second = await store.issue({ ...record, subject: "subject-2" });
    await store.revokeBySessionId("sid-1");
    await expect(store.resolve(first.handle)).resolves.toBeNull();
    await expect(store.resolve(second.handle)).resolves.toBeNull();
  });
});
