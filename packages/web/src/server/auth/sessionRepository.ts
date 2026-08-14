import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SessionCipher } from "./sessionCipher";

const OPAQUE_HANDLE_RE = /^[A-Za-z0-9_-]{43}$/u;
const PROVIDER_ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/u;
const MAX_TOKEN_BYTES = 512 * 1024;
const MAX_OIDC_IDENTIFIER_BYTES = 2_048;

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
  subject: z.string().min(1).max(MAX_OIDC_IDENTIFIER_BYTES),
  sessionId: z.string().min(1).max(MAX_OIDC_IDENTIFIER_BYTES).optional(),
  sessionExpiresAt: z.number().int().positive(),
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
  setIndexedSessionIfAbsent(
    key: string,
    metadataKey: string,
    value: string,
    indexKeys: readonly string[],
    ttlMs: number,
  ): Promise<boolean>;
  get(key: string): Promise<string | null>;
  getAndDelete(key: string): Promise<string | null>;
  compareAndSet(
    key: string,
    expectedRevision: number,
    value: string,
    ttlMs: number,
  ): Promise<boolean>;
  compareAndSetIndexedSession(
    key: string,
    metadataKey: string,
    expectedRevision: number,
    value: string,
    indexKeys: readonly string[],
    ttlMs: number,
  ): Promise<boolean>;
  delete(key: string): Promise<void>;
  deleteIndexedSession(key: string, metadataKey: string): Promise<void>;
  invalidateIndexedSessions(
    indexKey: string,
    replayKey: string,
    replayTtlMs: number,
  ): Promise<{ invalidated: number; replayed: boolean }>;
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
  invalidateBackchannelLogout(input: {
    sessionId?: string;
    subject?: string;
    jti: string;
    replayTtlMs: number;
  }): Promise<{ invalidated: number; replayed: boolean }>;
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
        if (
          await backend.setIndexedSessionIfAbsent(
            key,
            sessionMetadataKey(handle),
            encodeRecord(1, sealed),
            sessionIndexKeys(parsed),
            ttlMs,
          )
        ) {
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
      return backend.compareAndSetIndexedSession(
        key,
        sessionMetadataKey(handle),
        expectedRevision,
        encodeRecord(nextRevision, sealed),
        sessionIndexKeys(parsed),
        ttlMs,
      );
    },

    async deleteSession(handle) {
      if (!OPAQUE_HANDLE_RE.test(handle)) return;
      await backend.deleteIndexedSession(
        sessionKey(handle),
        sessionMetadataKey(handle),
      );
    },

    invalidateBackchannelLogout(input) {
      const identifier = input.sessionId ?? input.subject;
      if (
        !identifier ||
        identifier.length > MAX_OIDC_IDENTIFIER_BYTES ||
        !input.jti ||
        input.jti.length > MAX_OIDC_IDENTIFIER_BYTES ||
        !Number.isSafeInteger(input.replayTtlMs) ||
        input.replayTtlMs <= 0
      ) {
        throw new Error("sso_backchannel_logout_input_invalid");
      }
      const indexKey = input.sessionId
        ? sessionIdIndexKey(identifier)
        : subjectIndexKey(identifier);
      return backend.invalidateIndexedSessions(
        indexKey,
        logoutReplayKey(input.jti),
        input.replayTtlMs,
      );
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

interface MemoryIndex {
  members: Set<string>;
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
  const indexes = new Map<string, MemoryIndex>();

  function readEntry(key: string): MemoryEntry | null {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function readIndex(key: string): MemoryIndex | null {
    const index = indexes.get(key);
    if (!index) return null;
    if (index.expiresAt <= now()) {
      indexes.delete(key);
      return null;
    }
    return index;
  }

  function addIndexMember(key: string, member: string, expiresAt: number) {
    const index = readIndex(key) ?? {
      members: new Set<string>(),
      expiresAt,
    };
    index.members.add(member);
    index.expiresAt = Math.max(index.expiresAt, expiresAt);
    indexes.set(key, index);
  }

  function removeIndexMember(key: string, member: string) {
    const index = readIndex(key);
    if (!index) return;
    index.members.delete(member);
    if (index.members.size === 0) indexes.delete(key);
  }

  function deleteIndexedSession(key: string, metadataKey: string): boolean {
    const metadata = readEntry(metadataKey)?.value;
    if (metadata) {
      const decoded = decodeIndexMetadata(metadata);
      if (decoded?.sessionKey === key) {
        for (const indexKey of decoded.indexKeys) {
          removeIndexMember(indexKey, metadataKey);
        }
      }
    }
    const existed = readEntry(key) !== null;
    entries.delete(key);
    entries.delete(metadataKey);
    return existed;
  }

  return {
    async setIfAbsent(key, value, ttlMs) {
      if (readEntry(key)) return false;
      entries.set(key, { value, expiresAt: now() + ttlMs });
      return true;
    },
    async setIndexedSessionIfAbsent(key, metadataKey, value, indexKeys, ttlMs) {
      if (readEntry(key) || readEntry(metadataKey)) return false;
      const expiresAt = now() + ttlMs;
      entries.set(key, { value, expiresAt });
      entries.set(metadataKey, {
        value: encodeIndexMetadata(key, indexKeys),
        expiresAt,
      });
      for (const indexKey of indexKeys) {
        addIndexMember(indexKey, metadataKey, expiresAt);
      }
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
    async compareAndSetIndexedSession(
      key,
      metadataKey,
      expectedRevision,
      value,
      indexKeys,
      ttlMs,
    ) {
      const entry = readEntry(key);
      const metadata = readEntry(metadataKey);
      const expectedMetadata = encodeIndexMetadata(key, indexKeys);
      if (
        !entry ||
        recordRevision(entry.value) !== expectedRevision ||
        metadata?.value !== expectedMetadata
      ) {
        return false;
      }
      const expiresAt = now() + ttlMs;
      entries.set(key, { value, expiresAt });
      entries.set(metadataKey, { value: expectedMetadata, expiresAt });
      for (const indexKey of indexKeys) {
        addIndexMember(indexKey, metadataKey, expiresAt);
      }
      return true;
    },
    async delete(key) {
      entries.delete(key);
    },
    async deleteIndexedSession(key, metadataKey) {
      deleteIndexedSession(key, metadataKey);
    },
    async invalidateIndexedSessions(indexKey, replayKey, replayTtlMs) {
      if (readEntry(replayKey)) {
        return { invalidated: 0, replayed: true };
      }
      entries.set(replayKey, {
        value: "1",
        expiresAt: now() + replayTtlMs,
      });
      const members = [...(readIndex(indexKey)?.members ?? [])];
      let invalidated = 0;
      for (const metadataKey of members) {
        const metadata = readEntry(metadataKey)?.value;
        const decoded = metadata ? decodeIndexMetadata(metadata) : null;
        if (!decoded) {
          removeIndexMember(indexKey, metadataKey);
          continue;
        }
        if (deleteIndexedSession(decoded.sessionKey, metadataKey)) {
          invalidated += 1;
        }
      }
      indexes.delete(indexKey);
      return { invalidated, replayed: false };
    },
    async deleteIfValue(key, expectedValue) {
      if (readEntry(key)?.value === expectedValue) entries.delete(key);
    },
    inspect() {
      return JSON.stringify([
        ...entries,
        ...[...indexes].map(([key, value]) => [
          key,
          { members: [...value.members], expiresAt: value.expiresAt },
        ]),
      ]);
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

function encodeIndexMetadata(
  sessionStorageKey: string,
  indexKeys: readonly string[],
): string {
  return [sessionStorageKey, ...indexKeys].join("|");
}

function decodeIndexMetadata(
  value: string,
): { sessionKey: string; indexKeys: string[] } | null {
  const [storedSessionKey, ...indexKeys] = value.split("|");
  if (
    !storedSessionKey ||
    indexKeys.length === 0 ||
    indexKeys.some((key) => !key)
  ) {
    return null;
  }
  return { sessionKey: storedSessionKey, indexKeys };
}

function hashedHandle(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function sessionKey(handle: string): string {
  return `reef:sso:session:${hashedHandle(handle)}`;
}

function sessionMetadataKey(handle: string): string {
  return `reef:sso:session-meta:${hashedHandle(handle)}`;
}

function subjectIndexKey(subject: string): string {
  return `reef:sso:sub:${hashedHandle(subject)}`;
}

function sessionIdIndexKey(sessionId: string): string {
  return `reef:sso:sid:${hashedHandle(sessionId)}`;
}

function logoutReplayKey(jti: string): string {
  return `reef:sso:logout-jti:${hashedHandle(jti)}`;
}

function sessionIndexKeys(data: SsoSessionData): string[] {
  return [
    ...(data.sessionId ? [sessionIdIndexKey(data.sessionId)] : []),
    subjectIndexKey(data.subject),
  ];
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
