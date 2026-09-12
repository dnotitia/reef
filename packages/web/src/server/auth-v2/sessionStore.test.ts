// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createAuthV2SessionStore,
  type AuthV2SessionBackend,
} from "./sessionStore";
import { createAuthV2SessionCipher } from "./sessionCipher";

class MemoryBackend implements AuthV2SessionBackend {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  async set(key: string, value: string) {
    this.values.set(key, value);
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
  async replace(key: string, expected: string, value: string) {
    if (this.values.get(key) !== expected) return false;
    this.values.set(key, value);
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
  absolute_expires_at: 2_000,
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
    expect([...backend.values.values()].join()).not.toContain("refresh");
    await expect(store.resolve(issued.handle)).resolves.toEqual(record);
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
    };
    await expect(store.replace(issued.handle, record, next)).resolves.toBe(
      true,
    );
    await expect(
      store.replace(issued.handle, record, { ...next, access_token: "stale" }),
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
