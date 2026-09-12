import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AuthV2SessionCipher } from "./sessionCipher";

const HANDLE_BYTES = 32;
const HANDLE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const AuthV2SessionRecordSchema = z.object({
  provider_alias: z.string().min(1).max(63),
  subject: z.string().min(1).max(512),
  session_id: z.string().min(1).max(2_048).nullable().optional(),
  access_token: z
    .string()
    .min(1)
    .max(512 * 1024),
  refresh_token: z
    .string()
    .min(1)
    .max(512 * 1024),
  id_token: z
    .string()
    .min(1)
    .max(512 * 1024),
  issued_at: z.number().int().positive(),
  access_token_expires_at: z.number().int().positive(),
  absolute_expires_at: z.number().int().positive(),
});

export type AuthV2SessionRecord = z.infer<typeof AuthV2SessionRecordSchema>;

export interface AuthV2SessionBackend {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Atomic GET+DELETE, required for one-time login state/replay records. */
  consume(key: string): Promise<string | null>;
  /** Atomic ciphertext compare-and-set for refresh rotation. */
  replace(
    key: string,
    expectedValue: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  addToSet?(key: string, member: string, ttlSeconds: number): Promise<void>;
  members?(key: string): Promise<string[]>;
  removeFromSet?(key: string, member: string): Promise<void>;
}

export interface AuthV2SessionStore {
  issue(record: AuthV2SessionRecord): Promise<{
    handle: string;
    expiresAt: number;
  }>;
  resolve(handle: string): Promise<AuthV2SessionRecord | null>;
  /** Atomic refresh-token/session replacement guarded by the caller's lock. */
  replace(
    handle: string,
    expected: AuthV2SessionRecord,
    replacement: AuthV2SessionRecord,
  ): Promise<boolean>;
  revoke(handle: string): Promise<void>;
  revokeBySessionId(sessionId: string): Promise<void>;
}

export function createAuthV2SessionStore(params: {
  backend: AuthV2SessionBackend;
  cipher: AuthV2SessionCipher;
  namespace?: string;
  now?: () => number;
}): AuthV2SessionStore {
  const now = params.now ?? (() => Math.floor(Date.now() / 1_000));
  const prefix = `${params.namespace ?? "test"}:reef:auth-v2:session:`;
  const indexPrefix = `${params.namespace ?? "test"}:reef:auth-v2:sid:`;

  return {
    async issue(record) {
      const parsed = AuthV2SessionRecordSchema.parse(record);
      const nowSeconds = now();
      // Keep the Redis record through access-token expiry so a caller can
      // perform a refresh-token rotation under the refresh lock. The absolute
      // session deadline is the only lifetime that storage may extend to.
      const expiresAt = parsed.absolute_expires_at;
      const ttlSeconds = expiresAt - nowSeconds;
      if (parsed.access_token_expires_at <= nowSeconds || ttlSeconds <= 0) {
        throw new AuthV2SessionStoreError();
      }

      const handle = randomBytes(HANDLE_BYTES).toString("base64url");
      const key = sessionKey(handle, prefix);
      const ciphertext = params.cipher.encrypt(JSON.stringify(parsed), key);
      await params.backend.set(key, ciphertext, ttlSeconds);
      if (parsed.session_id && params.backend.addToSet) {
        await params.backend.addToSet(
          sessionIdKey(parsed.session_id, indexPrefix),
          handle,
          ttlSeconds,
        );
      }
      return { handle, expiresAt };
    },

    async resolve(handle) {
      if (!HANDLE_PATTERN.test(handle)) return null;
      const key = sessionKey(handle, prefix);
      const ciphertext = await params.backend.get(key);
      if (!ciphertext) return null;

      let record: AuthV2SessionRecord;
      try {
        const plaintext = params.cipher.decrypt(ciphertext, key);
        record = AuthV2SessionRecordSchema.parse(JSON.parse(plaintext));
      } catch {
        // Corrupt, tampered, or schema-invalid records are unrecoverable. Do
        // not leave them in Redis to fail every subsequent request; deletion
        // is safe because the browser only holds an opaque handle and a fresh
        // login creates a new record.
        await params.backend.del(key);
        throw new AuthV2SessionStoreError();
      }

      if (record.absolute_expires_at <= now()) {
        await params.backend.del(key);
        return null;
      }
      return record;
    },

    async replace(handle, expected, replacement) {
      if (!HANDLE_PATTERN.test(handle)) return false;
      const parsedExpected = AuthV2SessionRecordSchema.parse(expected);
      const parsedReplacement = AuthV2SessionRecordSchema.parse(replacement);
      if (
        parsedExpected.provider_alias !== parsedReplacement.provider_alias ||
        parsedExpected.subject !== parsedReplacement.subject ||
        parsedReplacement.absolute_expires_at >
          parsedExpected.absolute_expires_at
      ) {
        return false;
      }
      const key = sessionKey(handle, prefix);
      const currentCiphertext = await params.backend.get(key);
      if (!currentCiphertext) return false;
      let current: AuthV2SessionRecord;
      try {
        const plaintext = params.cipher.decrypt(currentCiphertext, key);
        current = AuthV2SessionRecordSchema.parse(JSON.parse(plaintext));
      } catch {
        await params.backend.del(key);
        throw new AuthV2SessionStoreError();
      }
      if (JSON.stringify(current) !== JSON.stringify(parsedExpected))
        return false;
      const expiresAt = parsedReplacement.absolute_expires_at;
      const ttlSeconds = expiresAt - now();
      if (ttlSeconds <= 0) return false;
      const ciphertext = params.cipher.encrypt(
        JSON.stringify(parsedReplacement),
        key,
      );
      return params.backend.replace(
        key,
        currentCiphertext,
        ciphertext,
        ttlSeconds,
      );
    },

    async revoke(handle) {
      if (!HANDLE_PATTERN.test(handle)) return;
      const key = sessionKey(handle, prefix);
      const ciphertext = await params.backend.get(key);
      await params.backend.del(key);
      if (ciphertext && params.backend.removeFromSet) {
        try {
          const plaintext = params.cipher.decrypt(ciphertext, key);
          const record = AuthV2SessionRecordSchema.parse(JSON.parse(plaintext));
          if (record.session_id) {
            await params.backend.removeFromSet(
              sessionIdKey(record.session_id, indexPrefix),
              handle,
            );
          }
        } catch {
          // Deleting the session is the security boundary; a stale index is harmless.
        }
      }
    },

    async revokeBySessionId(sessionId) {
      if (!sessionId || !params.backend.members) return;
      const key = sessionIdKey(sessionId, indexPrefix);
      const handles = await params.backend.members(key);
      for (const handle of handles) {
        if (HANDLE_PATTERN.test(handle)) {
          await params.backend.del(sessionKey(handle, prefix));
        }
      }
      await params.backend.del(key);
    },
  };
}

export class AuthV2SessionStoreError extends Error {
  constructor() {
    super("auth_v2_session_store_invalid");
    this.name = "AuthV2SessionStoreError";
  }
}

export function sessionKey(
  handle: string,
  prefix = "test:reef:auth-v2:session:",
): string {
  return `${prefix}${hashHandle(handle)}`;
}

function sessionIdKey(sessionId: string, prefix: string): string {
  return `${prefix}${createHash("sha256").update(sessionId, "utf8").digest("base64url")}`;
}

export function hashHandle(handle: string): string {
  return createHash("sha256").update(handle, "utf8").digest("base64url");
}
