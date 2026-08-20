import { createHash, randomBytes } from "node:crypto";

const LOCK_PREFIX = "reef:auth-v2:refresh-lock:";
const OWNER_BYTES = 32;
const MAX_OWNER_SECONDS = 30;

export interface AuthV2RefreshLockClient {
  set(
    key: string,
    value: string,
    options: { EX: number; NX: true },
  ): Promise<string | null | undefined>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

export class AuthV2RefreshLockError extends Error {
  constructor() {
    super("auth_v2_refresh_lock_invalid");
    this.name = "AuthV2RefreshLockError";
  }
}

export interface AuthV2RefreshLock {
  acquire(handle: string, ttlSeconds?: number): Promise<string | null>;
  release(handle: string, owner: string): Promise<void>;
}

const RELEASE_IF_OWNER = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * A short, single-owner refresh lock. The Redis SET NX and compare-and-delete
 * script keep refresh-token rotation from racing or deleting a newer owner's
 * lock. No GET-then-SET or unconditional DEL fallback is permitted.
 */
export function createAuthV2RefreshLock(
  client: AuthV2RefreshLockClient,
): AuthV2RefreshLock {
  if (
    !client ||
    typeof client.set !== "function" ||
    typeof client.eval !== "function"
  ) {
    throw new AuthV2RefreshLockError();
  }
  return {
    async acquire(handle, ttlSeconds = 10) {
      if (!isOpaqueHandle(handle) || !isValidTtl(ttlSeconds)) {
        throw new AuthV2RefreshLockError();
      }
      const owner = randomBytes(OWNER_BYTES).toString("base64url");
      const result = await client.set(lockKey(handle), owner, {
        EX: ttlSeconds,
        NX: true,
      });
      return result === "OK" ? owner : null;
    },
    async release(handle, owner) {
      if (!isOpaqueHandle(handle) || !isOpaqueOwner(owner)) return;
      await client.eval(RELEASE_IF_OWNER, {
        keys: [lockKey(handle)],
        arguments: [owner],
      });
    },
  };
}

export function lockKey(handle: string): string {
  return `${LOCK_PREFIX}${createHash("sha256").update(handle).digest("base64url")}`;
}

function isOpaqueHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function isOpaqueOwner(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function isValidTtl(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_OWNER_SECONDS;
}
