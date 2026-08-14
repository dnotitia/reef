// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSessionCipher } from "./sessionCipher";
import {
  SsoSessionRecordError,
  createEncryptedSessionRepository,
  createMemorySessionBackend,
} from "./sessionRepository";

const TOKEN_SET = {
  accessToken: "access-token-material",
  accessTokenExpiresAt: 2_000,
  refreshToken: "refresh-token-material",
  refreshTokenExpiresAt: 4_000,
  idToken: "id-token-material",
};

function createRepository() {
  let now = 1_000_000;
  const backend = createMemorySessionBackend({ now: () => now });
  const repository = createEncryptedSessionRepository({
    backend,
    cipher: createSessionCipher(new Uint8Array(Buffer.alloc(32, 9))),
    now: () => now,
  });
  return {
    backend,
    repository,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

describe("encrypted SSO session repository", () => {
  it("atomically indexes sessions by hashed sid/sub and consumes logout jti once", async () => {
    const { backend, repository } = createRepository();
    const sharedSubject = "keycloak-subject-sensitive";
    const firstSessionId = "keycloak-session-sensitive-a";
    const secondSessionId = "keycloak-session-sensitive-b";
    const firstHandle = await repository.createSession(
      {
        providerAlias: "workforce",
        oidcNonce: "nonce-value",
        subject: sharedSubject,
        sessionId: firstSessionId,
        sessionExpiresAt: 5_000,
        tokenSet: TOKEN_SET,
      },
      60_000,
    );
    const secondHandle = await repository.createSession(
      {
        providerAlias: "workforce",
        oidcNonce: "nonce-value",
        subject: sharedSubject,
        sessionId: secondSessionId,
        sessionExpiresAt: 5_000,
        tokenSet: TOKEN_SET,
      },
      60_000,
    );

    const stored = backend.inspect();
    for (const rawValue of [
      firstHandle,
      secondHandle,
      sharedSubject,
      firstSessionId,
      secondSessionId,
      ...Object.values(TOKEN_SET),
    ]) {
      expect(stored).not.toContain(String(rawValue));
    }

    await expect(
      repository.invalidateBackchannelLogout({
        sessionId: firstSessionId,
        subject: sharedSubject,
        jti: "logout-token-jti-sensitive-a",
        replayTtlMs: 180_000,
      }),
    ).resolves.toEqual({ invalidated: 1, replayed: false });
    await expect(repository.readSession(firstHandle)).resolves.toBeNull();
    await expect(repository.readSession(secondHandle)).resolves.not.toBeNull();

    await expect(
      repository.invalidateBackchannelLogout({
        sessionId: firstSessionId,
        subject: sharedSubject,
        jti: "logout-token-jti-sensitive-a",
        replayTtlMs: 180_000,
      }),
    ).resolves.toEqual({ invalidated: 0, replayed: true });

    await expect(
      repository.invalidateBackchannelLogout({
        subject: sharedSubject,
        jti: "logout-token-jti-sensitive-b",
        replayTtlMs: 180_000,
      }),
    ).resolves.toEqual({ invalidated: 1, replayed: false });
    await expect(repository.readSession(secondHandle)).resolves.toBeNull();
    await expect(
      repository.invalidateBackchannelLogout({
        subject: "missing-keycloak-subject",
        jti: "logout-token-jti-sensitive-missing",
        replayTtlMs: 180_000,
      }),
    ).resolves.toEqual({ invalidated: 0, replayed: false });
    expect(backend.inspect()).not.toContain("logout-token-jti-sensitive");
  });

  it("issues only an opaque handle and atomically rotates encrypted token state", async () => {
    const { backend, repository } = createRepository();
    const handle = await repository.createSession(
      {
        providerAlias: "workforce",
        oidcNonce: "nonce-value",
        subject: "keycloak-subject",
        sessionId: "keycloak-session-id",
        sessionExpiresAt: 5_000,
        tokenSet: TOKEN_SET,
      },
      60_000,
    );

    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handle).not.toContain("token");
    expect(backend.inspect()).not.toContain(TOKEN_SET.accessToken);
    expect(backend.inspect()).not.toContain(TOKEN_SET.refreshToken);
    expect(backend.inspect()).not.toContain(TOKEN_SET.idToken);

    const first = await repository.readSession(handle);
    expect(first).toMatchObject({ revision: 1, tokenSet: TOKEN_SET });

    const rotated = {
      ...TOKEN_SET,
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    };
    await expect(
      repository.replaceSession(
        handle,
        first?.revision ?? 0,
        {
          providerAlias: "workforce",
          oidcNonce: "nonce-value",
          subject: "keycloak-subject",
          sessionId: "keycloak-session-id",
          sessionExpiresAt: 5_000,
          tokenSet: rotated,
        },
        60_000,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.replaceSession(
        handle,
        first?.revision ?? 0,
        {
          providerAlias: "workforce",
          oidcNonce: "nonce-value",
          subject: "keycloak-subject",
          sessionId: "keycloak-session-id",
          sessionExpiresAt: 5_000,
          tokenSet: TOKEN_SET,
        },
        60_000,
      ),
    ).resolves.toBe(false);
    await expect(repository.readSession(handle)).resolves.toMatchObject({
      revision: 2,
      tokenSet: rotated,
    });
  });

  it("atomically consumes login state once and binds it to the browser", async () => {
    const { repository } = createRepository();
    const issued = await repository.createLoginTransaction(
      {
        providerAlias: "workforce",
        redirectPath: "/workspace/example/issues",
        clientId: "reef-web",
        codeVerifier: "v".repeat(64),
        nonce: "nonce-value",
      },
      60_000,
    );

    await expect(
      repository.consumeLoginTransaction(issued.state, issued.browserBinding),
    ).resolves.toMatchObject({ providerAlias: "workforce" });
    await expect(
      repository.consumeLoginTransaction(issued.state, issued.browserBinding),
    ).resolves.toBeNull();

    const copied = await repository.createLoginTransaction(
      {
        providerAlias: "workforce",
        redirectPath: "/",
        clientId: "reef-web",
        codeVerifier: "w".repeat(64),
        nonce: "other-nonce",
      },
      60_000,
    );
    await expect(
      repository.consumeLoginTransaction(copied.state, "x".repeat(43)),
    ).resolves.toBeNull();
    await expect(
      repository.consumeLoginTransaction(copied.state, copied.browserBinding),
    ).resolves.toBeNull();
  });

  it("expires records and grants one bounded refresh owner at a time", async () => {
    const { repository, advance } = createRepository();
    const handle = await repository.createSession(
      {
        providerAlias: "workforce",
        oidcNonce: "nonce-value",
        subject: "keycloak-subject",
        sessionId: "keycloak-session-id",
        sessionExpiresAt: 5_000,
        tokenSet: TOKEN_SET,
      },
      100,
    );

    await expect(
      repository.acquireRefreshLock(handle, "owner-a", 50),
    ).resolves.toBe(true);
    await expect(
      repository.acquireRefreshLock(handle, "owner-b", 50),
    ).resolves.toBe(false);
    await repository.releaseRefreshLock(handle, "owner-b");
    await expect(
      repository.acquireRefreshLock(handle, "owner-b", 50),
    ).resolves.toBe(false);
    await repository.releaseRefreshLock(handle, "owner-a");
    await expect(
      repository.acquireRefreshLock(handle, "owner-b", 50),
    ).resolves.toBe(true);

    advance(101);
    await expect(repository.readSession(handle)).resolves.toBeNull();
  });

  it("bounds malformed encrypted-record errors", async () => {
    const backend = createMemorySessionBackend();
    const repository = createEncryptedSessionRepository({
      backend: {
        ...backend,
        get: async () => "1|not-an-encrypted-record",
      },
      cipher: createSessionCipher(new Uint8Array(Buffer.alloc(32, 9))),
    });

    await expect(repository.readSession("h".repeat(43))).rejects.toEqual(
      new SsoSessionRecordError(),
    );
  });
});
