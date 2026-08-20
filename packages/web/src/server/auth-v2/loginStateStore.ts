import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AuthV2SessionBackend } from "./sessionStore";
import type { AuthV2SessionCipher } from "./sessionCipher";

const OPAQUE_VALUE = /^[A-Za-z0-9_-]{43}$/u;
const PROVIDER_ALIAS = /^[a-z0-9][a-z0-9._-]{0,62}$/u;
const MAX_STATE_TTL_SECONDS = 10 * 60;
const LOGIN_KEY_PREFIX = "reef:auth-v2:login:";

const LoginTransactionSchema = z
  .object({
    browser_binding: z.string().regex(OPAQUE_VALUE),
    provider_alias: z.string().regex(PROVIDER_ALIAS),
    redirect_path: z.string().min(1).max(2_048),
    client_id: z.string().min(1).max(255),
    code_verifier: z.string().min(43).max(128),
    nonce: z.string().regex(OPAQUE_VALUE),
    issued_at: z.number().int().positive(),
    expires_at: z.number().int().positive(),
  })
  .strict();

export type AuthV2LoginTransaction = z.infer<typeof LoginTransactionSchema>;

export interface AuthV2LoginStateStore {
  issue(input: {
    providerAlias: string;
    redirectPath: string;
    clientId: string;
    codeVerifier: string;
    nonce: string;
    ttlSeconds?: number;
  }): Promise<{ state: string; browserBinding: string }>;
  consume(
    state: string,
    browserBinding: string,
  ): Promise<Omit<AuthV2LoginTransaction, "browser_binding"> | null>;
}

export class AuthV2LoginStateError extends Error {
  constructor() {
    super("auth_v2_login_state_invalid");
    this.name = "AuthV2LoginStateError";
  }
}

export function createAuthV2LoginStateStore(params: {
  backend: AuthV2SessionBackend;
  cipher: AuthV2SessionCipher;
  now?: () => number;
}): AuthV2LoginStateStore {
  const now = params.now ?? (() => Math.floor(Date.now() / 1_000));

  return {
    async issue(input) {
      const ttlSeconds = input.ttlSeconds ?? MAX_STATE_TTL_SECONDS;
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new AuthV2LoginStateError();
      }
      const issuedAt = now();
      const expiresAt = issuedAt + Math.min(ttlSeconds, MAX_STATE_TTL_SECONDS);
      const browserBinding = randomOpaqueValue();
      const transaction = LoginTransactionSchema.parse({
        browser_binding: browserBinding,
        provider_alias: input.providerAlias,
        redirect_path: input.redirectPath,
        client_id: input.clientId,
        code_verifier: input.codeVerifier,
        nonce: input.nonce,
        issued_at: issuedAt,
        expires_at: expiresAt,
      });

      const state = randomOpaqueValue();
      const key = loginKey(state);
      const ciphertext = params.cipher.encrypt(
        JSON.stringify(transaction),
        key,
      );
      // The backend's SET operation is intentionally not NX here: random
      // 256-bit state collisions are negligible, while atomic consume is
      // the security boundary for replay. A concrete Redis adapter may add
      // NX when available without changing this contract.
      await params.backend.set(key, ciphertext, expiresAt - issuedAt);
      return { state, browserBinding };
    },

    async consume(state, browserBinding) {
      if (!OPAQUE_VALUE.test(state) || !OPAQUE_VALUE.test(browserBinding)) {
        return null;
      }
      const key = loginKey(state);
      const ciphertext = await params.backend.consume(key);
      if (!ciphertext) return null;
      let transaction: AuthV2LoginTransaction;
      try {
        const plaintext = params.cipher.decrypt(ciphertext, key);
        transaction = LoginTransactionSchema.parse(JSON.parse(plaintext));
      } catch {
        throw new AuthV2LoginStateError();
      }
      if (transaction.expires_at <= now()) return null;
      if (!constantTimeEqual(transaction.browser_binding, browserBinding)) {
        return null;
      }
      const { browser_binding: _binding, ...safeTransaction } = transaction;
      return safeTransaction;
    },
  };
}

export function loginKey(state: string): string {
  return `${LOGIN_KEY_PREFIX}${hashOpaqueValue(state)}`;
}

function randomOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
