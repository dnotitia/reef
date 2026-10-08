// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AkbApiError } from "@reef/core";
import type { AuthV2OidcProtocol } from "./oidcProtocol";
import { AuthV2OidcProtocolError } from "./oidcProtocol";
import type { AuthV2RouteRuntime } from "./runtime";
import { AuthV2RedisBackendError } from "./redisBackend";
import { resolveAuthV2Credential } from "./routeHelpers";
import type { AuthV2SessionRecord, AuthV2SessionStore } from "./sessionStore";

const runtimeRef = vi.hoisted(() => ({
  current: undefined as AuthV2RouteRuntime | undefined,
  factory: undefined as (() => AuthV2RouteRuntime) | undefined,
}));

vi.mock("./runtime", () => ({
  AuthV2RouteRuntimeError: class AuthV2RouteRuntimeError extends Error {},
  getAuthV2RouteRuntime: vi.fn(async () =>
    runtimeRef.factory ? runtimeRef.factory() : runtimeRef.current,
  ),
}));

const HANDLE = "H".repeat(43);

function makeRecord(): AuthV2SessionRecord {
  return {
    provider_alias: "workforce",
    subject: "subject-1",
    session_id: "sid-1",
    access_token: "access-1",
    refresh_token: "refresh-1",
    id_token: "id-1",
    issued_at: 100,
    access_token_expires_at: 110,
    refresh_token_expires_at: 200,
    absolute_expires_at: 1_000,
  };
}

function makeProtocol(
  refresh: AuthV2OidcProtocol["refresh"],
): AuthV2OidcProtocol {
  return {
    refresh,
    beginAuthorization: async () => {
      throw new Error("unused");
    },
    completeAuthorization: async () => {
      throw new Error("unused");
    },
    revoke: async () => undefined,
    logoutLocation: () => "https://idp.test/logout",
    validator: {
      validate: async () => {
        throw new Error("unused");
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function installRuntime(options: {
  record?: AuthV2SessionRecord;
  now?: () => number;
  protocol: AuthV2OidcProtocol;
  acquire?: () => Promise<string | null>;
  resolve?: () => Promise<AuthV2SessionRecord | null>;
  replace?: AuthV2SessionStore["replace"];
  revoke?: AuthV2SessionStore["revoke"];
}): {
  getRecord: () => AuthV2SessionRecord | undefined;
  replace: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
} {
  let current: AuthV2SessionRecord | undefined = options.record ?? makeRecord();
  const replace = vi.fn<AuthV2SessionStore["replace"]>(
    async (_handle, expected, replacement) => {
      if (expected !== current) return false;
      current = replacement;
      return true;
    },
  );
  const revoke = vi.fn<AuthV2SessionStore["revoke"]>(async () => {
    current = undefined;
  });
  const store = {
    issue: async () => ({ handle: HANDLE, expiresAt: 1_000 }),
    resolve: options.resolve ?? (async () => current ?? null),
    replace: options.replace ?? replace,
    revoke: options.revoke ?? revoke,
    revokeBySessionId: async () => undefined,
  } as AuthV2SessionStore;
  runtimeRef.current = {
    store,
    refreshLock: {
      acquire: options.acquire ?? (async () => "owner"),
      release: async () => undefined,
    },
    now: options.now ?? (() => 111),
    protocolFor: () => options.protocol,
    close: async () => undefined,
  } as unknown as AuthV2RouteRuntime;
  runtimeRef.factory = undefined;

  return {
    getRecord: () => current,
    replace,
    revoke,
  };
}

afterEach(() => {
  runtimeRef.current = undefined;
  runtimeRef.factory = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auth-v2 credential resolution", () => {
  it("rotates repeatedly past the first refresh credential window", async () => {
    let now = 111;
    const refresh = vi.fn(
      async (input: Parameters<AuthV2OidcProtocol["refresh"]>[0]) => ({
        accessToken: `access-${input.previousRefreshTokenExpiresAt}`,
        refreshToken: `refresh-${input.previousRefreshTokenExpiresAt}`,
        idToken: "id-rotated",
        accessTokenExpiresAt: now + 50,
        refreshTokenExpiresAt: now + 200,
      }),
    );
    const runtime = installRuntime({
      now: () => now,
      protocol: makeProtocol(refresh),
    });

    await expect(resolveAuthV2Credential(HANDLE)).resolves.toBe("access-200");
    now = 250;
    await expect(resolveAuthV2Credential(HANDLE)).resolves.toBe("access-311");

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(runtime.getRecord()).toMatchObject({
      refresh_token_expires_at: 450,
      absolute_expires_at: 1_000,
    });
    expect(runtime.replace).toHaveBeenCalledTimes(2);
  });

  it("waits for a competing request and uses the rotated credential from the shared session", async () => {
    vi.useFakeTimers();
    let current: AuthV2SessionRecord | undefined = makeRecord();
    let lockOwner: string | null = null;
    let ownerCount = 0;
    const store = {
      issue: async () => ({ handle: HANDLE, expiresAt: 1_000 }),
      resolve: vi.fn(async () => current ?? null),
      replace: vi.fn<AuthV2SessionStore["replace"]>(
        async (_handle, expected, replacement) => {
          if (current !== expected) return false;
          current = replacement;
          return true;
        },
      ),
      revoke: vi.fn<AuthV2SessionStore["revoke"]>(async () => {
        current = undefined;
      }),
      revokeBySessionId: async () => undefined,
    } as AuthV2SessionStore;
    const refreshStarted = deferred<void>();
    const refreshResult =
      deferred<Awaited<ReturnType<AuthV2OidcProtocol["refresh"]>>>();
    const refresh = vi.fn(async () => {
      refreshStarted.resolve();
      return refreshResult.promise;
    });
    const waiterContended = deferred<void>();
    const refreshLock = {
      acquire: vi.fn(async () => {
        if (lockOwner) {
          waiterContended.resolve();
          return null;
        }
        lockOwner = `owner-${++ownerCount}`;
        return lockOwner;
      }),
      release: vi.fn(async (_handle: string, owner: string) => {
        if (lockOwner === owner) lockOwner = null;
      }),
    };
    const runtimes: AuthV2RouteRuntime[] = [];
    runtimeRef.factory = () => {
      const runtime = {
        store,
        refreshLock,
        now: () => 111,
        protocolFor: () => makeProtocol(refresh),
        close: vi.fn(async () => undefined),
      } as unknown as AuthV2RouteRuntime;
      runtimes.push(runtime);
      return runtime;
    };

    const ownerResult = resolveAuthV2Credential(HANDLE);
    await refreshStarted.promise;
    const waiterResult = resolveAuthV2Credential(HANDLE).then(
      (credential) => ({ credential }),
      (error: unknown) => ({ error }),
    );
    await waiterContended.promise;
    await vi.advanceTimersByTimeAsync(50);

    refreshResult.resolve({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      idToken: "id-2",
      accessTokenExpiresAt: 200,
      refreshTokenExpiresAt: 300,
    });
    await expect(ownerResult).resolves.toBe("access-2");
    await vi.advanceTimersByTimeAsync(200);

    await expect(waiterResult).resolves.toEqual({ credential: "access-2" });
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]).not.toBe(runtimes[1]);
    expect(runtimes[0]?.store).toBe(store);
    expect(runtimes[1]?.store).toBe(store);
    expect(runtimes[0]?.refreshLock).toBe(refreshLock);
    expect(runtimes[1]?.refreshLock).toBe(refreshLock);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.replace).toHaveBeenCalledTimes(1);
  });

  it("returns a retryable conflict after the bounded refresh contention wait", async () => {
    vi.useFakeTimers();
    const stale = makeRecord();
    const resolve = vi.fn(async () => stale);
    installRuntime({
      protocol: makeProtocol(async () => {
        throw new Error("a waiter must not start its own refresh");
      }),
      acquire: async () => null,
      resolve,
    });

    const result = resolveAuthV2Credential(HANDLE).then(
      () => ({ credential: "unexpected" }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(5_500);

    await expect(result).resolves.toMatchObject({
      error: { name: "AkbApiError", status: 409 },
    });
    expect(resolve).toHaveBeenCalledTimes(24);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a session revoked during refresh contention as expired", async () => {
    let calls = 0;
    installRuntime({
      protocol: makeProtocol(async () => {
        throw new Error("a waiter must not start its own refresh");
      }),
      acquire: async () => null,
      resolve: async () => (calls++ === 0 ? makeRecord() : null),
    });

    await expect(resolveAuthV2Credential(HANDLE)).rejects.toMatchObject({
      name: "AuthError",
      context: { origin: "akb", status: 401 },
    });
  });

  it("turns a definitive refresh rejection into expiry and revokes the handle", async () => {
    const protocol = makeProtocol(async () => {
      throw new AuthV2OidcProtocolError("auth_v2_refresh_rejected", "rejected");
    });
    const runtime = installRuntime({ protocol });

    await expect(resolveAuthV2Credential(HANDLE)).rejects.toMatchObject({
      name: "AuthError",
      context: { origin: "akb", status: 401 },
    });
    expect(runtime.revoke).toHaveBeenCalledWith(HANDLE);
  });

  it("keeps the session on a temporary upstream failure", async () => {
    const protocol = makeProtocol(async () => {
      throw new AuthV2OidcProtocolError(
        "auth_v2_upstream_unavailable",
        "unavailable",
      );
    });
    const runtime = installRuntime({ protocol });

    let failure: unknown;
    try {
      await resolveAuthV2Credential(HANDLE);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AkbApiError);
    expect(failure).toMatchObject({ name: "AkbApiError", status: 503 });
    expect(runtime.revoke).not.toHaveBeenCalled();
    expect(runtime.getRecord()).toMatchObject({
      absolute_expires_at: 1_000,
      refresh_token_expires_at: 200,
    });
  });

  it("custodies a rotated refresh credential after a temporary JWKS failure", async () => {
    const protocol = makeProtocol(async () => {
      throw new AuthV2OidcProtocolError(
        "auth_v2_keyset_unavailable",
        "unavailable",
        {
          refreshToken: "refresh-2",
          refreshTokenExpiresAt: 500,
        },
      );
    });
    const runtime = installRuntime({ protocol });

    await expect(resolveAuthV2Credential(HANDLE)).rejects.toMatchObject({
      name: "AkbApiError",
      status: 503,
    });
    expect(runtime.getRecord()).toMatchObject({
      refresh_token: "refresh-2",
      refresh_token_expires_at: 500,
      absolute_expires_at: 1_000,
    });
    expect(runtime.revoke).not.toHaveBeenCalled();
  });

  it("returns a retryable conflict when refresh CAS loses without invalidating", async () => {
    const record = makeRecord();
    const runtime = installRuntime({
      record,
      protocol: makeProtocol(async () => {
        return {
          accessToken: "access-2",
          refreshToken: "refresh-2",
          idToken: "id-2",
          accessTokenExpiresAt: 200,
          refreshTokenExpiresAt: 300,
        };
      }),
      acquire: async () => "owner",
      replace: async () => false,
    });

    await expect(resolveAuthV2Credential(HANDLE)).rejects.toMatchObject({
      name: "AkbApiError",
      status: 409,
    });
    expect(runtime.revoke).not.toHaveBeenCalled();
  });

  it("maps Redis operation failures to retryable server errors", async () => {
    const protocol = makeProtocol(async () => {
      throw new Error("unused");
    });
    installRuntime({
      protocol,
      resolve: async () => {
        throw new AuthV2RedisBackendError();
      },
    });

    await expect(resolveAuthV2Credential(HANDLE)).rejects.toMatchObject({
      name: "AkbApiError",
      status: 503,
    });
  });
});
