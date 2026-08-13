import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SessionCipher } from "./sessionCipher";

const OPAQUE_HANDLE_RE = /^[A-Za-z0-9_-]{43}$/u;
const PROVIDER_ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/u;
const MAX_TOKEN_BYTES = 512 * 1024;

export const SsoTokenSetSchema = z.object({
  accessToken: z.string().min(1).max(MAX_TOKEN_BYTES),
  accessTokenExpiresAt: z.number().int().positive(),
  refreshToken: z.string().min(1).max(MAX_TOKEN_BYTES).optional(),
  refreshTokenExpiresAt: z.number().int().positive().optional(),
  idToken: z.string().min(1).max(MAX_TOKEN_BYTES).optional(),
});

export type SsoTokenSet = z.infer<typeof SsoTokenSetSchema>;

const SsoSessionDataSchema = z.object({
  providerAlias: z.string().regex(PROVIDER_ALIAS_RE),
  oidcNonce: z.string().min(1).max(255),
  tokenSet: SsoTokenSetSchema,
});

export type SsoSessionData = z.infer<typeof SsoSessionDataSchema>;

const LoginTransactionSchema = z.object({
  browserBinding: z.string().regex(OPAQUE_HANDLE_RE),
  providerAlias: z.string().regex(PROVIDER_ALIAS_RE),
  redirectPath: z.string().min(1).max(2_048),
  clientId: z.string().min(1).max(255),
  codeVerifier: z.string().min(43).max(128),
  nonce: z.string().min(1).max(255),
});

export type LoginTransaction = Omit<
  z.infer<typeof LoginTransactionSchema>,
  "browserBinding"
>;

export interface IssuedLoginTransaction {
  state: string;
  browserBinding: string;
}

export interface VersionedSsoSession extends SsoSessionData {
  revision: number;
}

/** Bounded marker for ciphertext/record corruption; store I/O errors pass through. */
export class SsoSessionRecordError extends Error {
  constructor() {
    super("sso_session_record_invalid");
    this.name = "SsoSessionRecordError";
  }
}

export interface SessionStorageBackend {
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  getAndDelete(key: string): Promise<string | null>;
  compareAndSet(
    key: string,
    expectedRevision: number,
    value: string,
    ttlMs: number,
  ): Promise<boolean>;
  delete(key: string): Promise<void>;
  deleteIfValue(key: string, expectedValue: string): Promise<void>;
}

export interface EncryptedSessionRepository {
  createSession(data: SsoSessionData, ttlMs: number): Promise<string>;
  readSession(handle: string): Promise<VersionedSsoSession | null>;
  replaceSession(
    handle: string,
    expectedRevision: number,
    data: SsoSessionData,
    ttlMs: number,
  ): Promise<boolean>;
  deleteSession(handle: string): Promise<void>;
  createLoginTransaction(
    data: LoginTransaction,
    ttlMs: number,
  ): Promise<IssuedLoginTransaction>;
  consumeLoginTransaction(
    state: string,
    browserBinding: string,
  ): Promise<LoginTransaction | null>;
  acquireRefreshLock(
    handle: string,
    owner: string,
    ttlMs: number,
  ): Promise<boolean>;
  releaseRefreshLock(handle: string, owner: string): Promise<void>;
}

export function createEncryptedSessionRepository(options: {
  backend: SessionStorageBackend;
  cipher: SessionCipher;
  now?: () => number;
}): EncryptedSessionRepository {
  const { backend, cipher } = options;

  return {
    async createSession(data, ttlMs) {
      const parsed = SsoSessionDataSchema.parse(data);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const handle = randomOpaqueValue();
        const key = sessionKey(handle);
        const sealed = cipher.seal(parsed, key);
        if (await backend.setIfAbsent(key, encodeRecord(1, sealed), ttlMs)) {
          return handle;
        }
      }
      throw new Error("sso_session_handle_collision");
    },

    async readSession(handle) {
      if (!OPAQUE_HANDLE_RE.test(handle)) return null;
      const key = sessionKey(handle);
      const stored = await backend.get(key);
      if (!stored) return null;
      try {
        const { revision, sealed } = decodeRecord(stored);
        const data = SsoSessionDataSchema.parse(
          cipher.open<unknown>(sealed, key),
        );
        return { revision, ...data };
      } catch {
        throw new SsoSessionRecordError();
      }
    },

    async replaceSession(handle, expectedRevision, data, ttlMs) {
      if (!OPAQUE_HANDLE_RE.test(handle)) return false;
      const parsed = SsoSessionDataSchema.parse(data);
      const key = sessionKey(handle);
      const nextRevision = expectedRevision + 1;
      const sealed = cipher.seal(parsed, key);
      return backend.compareAndSet(
        key,
        expectedRevision,
        encodeRecord(nextRevision, sealed),
        ttlMs,
      );
    },

    async deleteSession(handle) {
      if (!OPAQUE_HANDLE_RE.test(handle)) return;
      await backend.delete(sessionKey(handle));
    },

    async createLoginTransaction(data, ttlMs) {
      const browserBinding = randomOpaqueValue();
      const parsed = LoginTransactionSchema.parse({
        ...data,
        browserBinding,
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = randomOpaqueValue();
        const key = loginKey(state);
        const sealed = cipher.seal(parsed, key);
        if (await backend.setIfAbsent(key, encodeRecord(1, sealed), ttlMs)) {
          return { state, browserBinding };
        }
      }
      throw new Error("sso_login_state_collision");
    },

    async consumeLoginTransaction(state, browserBinding) {
      if (
        !OPAQUE_HANDLE_RE.test(state) ||
        !OPAQUE_HANDLE_RE.test(browserBinding)
      ) {
        return null;
      }
      const key = loginKey(state);
      const stored = await backend.getAndDelete(key);
      if (!stored) return null;
      let parsed: z.infer<typeof LoginTransactionSchema>;
      try {
        const { sealed } = decodeRecord(stored);
        parsed = LoginTransactionSchema.parse(
          cipher.open<unknown>(sealed, key),
        );
      } catch {
        throw new SsoSessionRecordError();
      }
      if (!constantTimeEqual(parsed.browserBinding, browserBinding)) {
        return null;
      }
      const { browserBinding: _browserBinding, ...transaction } = parsed;
      return transaction;
    },

    acquireRefreshLock(handle, owner, ttlMs) {
      if (!OPAQUE_HANDLE_RE.test(handle) || !owner) {
        return Promise.resolve(false);
      }
      return backend.setIfAbsent(refreshLockKey(handle), owner, ttlMs);
    },

    async releaseRefreshLock(handle, owner) {
      if (!OPAQUE_HANDLE_RE.test(handle) || !owner) return;
      await backend.deleteIfValue(refreshLockKey(handle), owner);
    },
  };
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export interface MemorySessionBackend extends SessionStorageBackend {
  /** Ciphertext-only test diagnostic; never returns plaintext token state. */
  inspect(): string;
}

export function createMemorySessionBackend(options?: {
  now?: () => number;
}): MemorySessionBackend {
  const now = options?.now ?? Date.now;
  const entries = new Map<string, MemoryEntry>();

  function readEntry(key: string): MemoryEntry | null {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  return {
    async setIfAbsent(key, value, ttlMs) {
      if (readEntry(key)) return false;
      entries.set(key, { value, expiresAt: now() + ttlMs });
      return true;
    },
    async get(key) {
      return readEntry(key)?.value ?? null;
    },
    async getAndDelete(key) {
      const entry = readEntry(key);
      entries.delete(key);
      return entry?.value ?? null;
    },
    async compareAndSet(key, expectedRevision, value, ttlMs) {
      const entry = readEntry(key);
      if (!entry || recordRevision(entry.value) !== expectedRevision) {
        return false;
      }
      entries.set(key, { value, expiresAt: now() + ttlMs });
      return true;
    },
    async delete(key) {
      entries.delete(key);
    },
    async deleteIfValue(key, expectedValue) {
      if (readEntry(key)?.value === expectedValue) entries.delete(key);
    },
    inspect() {
      return JSON.stringify([...entries]);
    },
  };
}

function encodeRecord(revision: number, sealed: string): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("sso_session_revision_invalid");
  }
  return `${revision}|${sealed}`;
}

function decodeRecord(stored: string): { revision: number; sealed: string } {
  const separator = stored.indexOf("|");
  if (separator <= 0) throw new Error("sso_session_record_invalid");
  const revision = Number(stored.slice(0, separator));
  const sealed = stored.slice(separator + 1);
  if (!Number.isSafeInteger(revision) || revision < 1 || !sealed) {
    throw new Error("sso_session_record_invalid");
  }
  return { revision, sealed };
}

function recordRevision(stored: string): number | null {
  try {
    return decodeRecord(stored).revision;
  } catch {
    return null;
  }
}

function randomOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

function hashedHandle(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function sessionKey(handle: string): string {
  return `reef:sso:session:${hashedHandle(handle)}`;
}

function loginKey(state: string): string {
  return `reef:sso:login:${hashedHandle(state)}`;
}

function refreshLockKey(handle: string): string {
  return `reef:sso:refresh-lock:${hashedHandle(handle)}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
