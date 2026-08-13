// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { KeycloakOidcClient } from "./oidcClient";
import { OidcProtocolError } from "./oidcClient";
import { createSessionCipher } from "./sessionCipher";
import {
  createEncryptedSessionRepository,
  createMemorySessionBackend,
} from "./sessionRepository";
import { createSsoSessionService } from "./ssoSessionService";

const NOW_SECONDS = 2_000_000_000;

function tokenSet(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "current-access-token",
    accessTokenExpiresAt: NOW_SECONDS + 10,
    refreshToken: "current-refresh-token",
    refreshTokenExpiresAt: NOW_SECONDS + 1_800,
    idToken: "current-id-token",
    ...overrides,
  };
}

function harness(
  refresh: KeycloakOidcClient["refresh"],
  options: { now?: () => number } = {},
) {
  const now = options.now ?? (() => NOW_SECONDS);
  const repository = createEncryptedSessionRepository({
    backend: createMemorySessionBackend({ now: () => now() * 1_000 }),
    cipher: createSessionCipher(new Uint8Array(Buffer.alloc(32, 4))),
  });
  const oidc = {
    refresh,
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    verifyBackchannelLogoutToken: vi.fn(),
    logoutLocation: vi
      .fn()
      .mockReturnValue("https://identity.example.com/logout"),
  } as unknown as KeycloakOidcClient;
  return {
    repository,
    oidc,
    service: createSsoSessionService({
      repository,
      oidc,
      now,
      sleep: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
      refreshPollMs: 1,
      refreshWaitMs: 100,
    }),
  };
}

async function createSession(
  repository: ReturnType<typeof harness>["repository"],
  overrides: Record<string, unknown> = {},
) {
  return repository.createSession(
    {
      providerAlias: "workforce",
      oidcNonce: "login-nonce",
      subject: "keycloak-subject",
      sessionId: "keycloak-session-id",
      sessionExpiresAt: NOW_SECONDS + 24 * 60 * 60,
      tokenSet: tokenSet(overrides),
    },
    60_000,
  );
}

describe("SSO session refresh", () => {
  it("caps every refresh TTL at the immutable login-time deadline", async () => {
    let now = NOW_SECONDS;
    const refresh = vi.fn<KeycloakOidcClient["refresh"]>(async () =>
      tokenSet({
        accessToken: "rotated-access-token",
        accessTokenExpiresAt: now + 300,
        refreshToken: "rotated-refresh-token",
        refreshTokenExpiresAt: now + 7 * 24 * 60 * 60,
      }),
    );
    const { repository, service } = harness(refresh, { now: () => now });
    const replaceSession = vi.spyOn(repository, "replaceSession");

    const issued = await service.createSession({
      providerAlias: "workforce",
      redirectPath: "/",
      oidcNonce: "login-nonce",
      subject: "keycloak-subject",
      sessionId: "keycloak-session-id",
      tokenSet: tokenSet({
        refreshTokenExpiresAt: NOW_SECONDS + 7 * 24 * 60 * 60,
      }),
    });

    expect(issued.expiresAt).toBe(NOW_SECONDS + 24 * 60 * 60);
    now = issued.expiresAt - 10;
    await expect(service.resolveAccessToken(issued.handle)).resolves.toBe(
      "rotated-access-token",
    );
    expect(replaceSession).toHaveBeenCalledWith(
      issued.handle,
      1,
      expect.objectContaining({ sessionExpiresAt: issued.expiresAt }),
      10_000,
    );

    now = issued.expiresAt + 1;
    await expect(
      service.resolveAccessToken(issued.handle),
    ).rejects.toMatchObject({ code: "sso_session_expired", kind: "expired" });
    await expect(repository.readSession(issued.handle)).resolves.toBeNull();
  });

  it("rotates refresh credentials once under concurrent requests", async () => {
    const refresh = vi.fn<KeycloakOidcClient["refresh"]>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return tokenSet({
        accessToken: "rotated-access-token",
        accessTokenExpiresAt: NOW_SECONDS + 300,
        refreshToken: "rotated-refresh-token",
      });
    });
    const { repository, service } = harness(refresh);
    const acquireRefreshLock = vi.spyOn(repository, "acquireRefreshLock");
    const handle = await createSession(repository);

    await expect(
      Promise.all([
        service.resolveAccessToken(handle),
        service.resolveAccessToken(handle),
      ]),
    ).resolves.toEqual(["rotated-access-token", "rotated-access-token"]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(acquireRefreshLock).toHaveBeenCalledWith(
      handle,
      expect.any(String),
      30_000,
    );
    await expect(repository.readSession(handle)).resolves.toMatchObject({
      revision: 2,
      tokenSet: {
        accessToken: "rotated-access-token",
        refreshToken: "rotated-refresh-token",
      },
    });
  });

  it("expires the session when refresh is rejected", async () => {
    const { repository, service } = harness(
      vi
        .fn()
        .mockRejectedValue(
          new OidcProtocolError("oidc_refresh_rejected", "rejected"),
        ),
    );
    const handle = await createSession(repository, {
      accessTokenExpiresAt: NOW_SECONDS - 1,
    });

    await expect(service.resolveAccessToken(handle)).rejects.toThrowError(
      "sso_session_expired",
    );
    await expect(repository.readSession(handle)).resolves.toBeNull();
  });

  it("keeps a still-valid session on a transient upstream failure", async () => {
    const { repository, service } = harness(
      vi
        .fn()
        .mockRejectedValue(
          new OidcProtocolError("oidc_upstream_unavailable", "transient"),
        ),
    );
    const handle = await createSession(repository);

    await expect(service.resolveAccessToken(handle)).resolves.toBe(
      "current-access-token",
    );
    await expect(repository.readSession(handle)).resolves.not.toBeNull();
  });

  it("does not destroy an expired session record on a transient failure", async () => {
    const { repository, service } = harness(
      vi
        .fn()
        .mockRejectedValue(
          new OidcProtocolError("oidc_upstream_unavailable", "transient"),
        ),
    );
    const handle = await createSession(repository, {
      accessTokenExpiresAt: NOW_SECONDS - 1,
    });

    await expect(service.resolveAccessToken(handle)).rejects.toThrowError(
      "sso_upstream_unavailable",
    );
    await expect(repository.readSession(handle)).resolves.not.toBeNull();
  });

  it("keeps the encrypted session when the store read fails transiently", async () => {
    const { repository, service } = harness(vi.fn());
    const handle = await createSession(repository);
    const read = vi
      .spyOn(repository, "readSession")
      .mockRejectedValueOnce(new Error("redis connection details"));

    await expect(service.resolveAccessToken(handle)).rejects.toMatchObject({
      message: "sso_session_store_unavailable",
      kind: "transient",
    });

    read.mockRestore();
    await expect(repository.readSession(handle)).resolves.not.toBeNull();
  });
});

describe("SSO session logout", () => {
  it("invalidates the sid-selected sessions and rejects a replayed logout jti", async () => {
    const { repository, service, oidc } = harness(vi.fn());
    const firstHandle = await createSession(repository);
    const secondHandle = await repository.createSession(
      {
        providerAlias: "workforce",
        oidcNonce: "login-nonce",
        subject: "keycloak-subject",
        sessionId: "other-keycloak-session-id",
        sessionExpiresAt: NOW_SECONDS + 24 * 60 * 60,
        tokenSet: tokenSet(),
      },
      60_000,
    );
    vi.mocked(oidc.verifyBackchannelLogoutToken).mockResolvedValue({
      jti: "logout-token-jti",
      subject: "keycloak-subject",
      sessionId: "keycloak-session-id",
      replayTtlMs: 180_000,
    });

    await expect(
      service.backchannelLogout("signed-logout-token"),
    ).resolves.toBeUndefined();
    await expect(repository.readSession(firstHandle)).resolves.toBeNull();
    await expect(repository.readSession(secondHandle)).resolves.not.toBeNull();

    await expect(
      service.backchannelLogout("signed-logout-token"),
    ).rejects.toMatchObject({
      code: "oidc_logout_token_replayed",
      kind: "invalid",
    });
  });

  it("deletes locally before best-effort refresh-token revocation", async () => {
    const { repository, service, oidc } = harness(vi.fn());
    const handle = await createSession(repository);
    let missingAtRevocation = false;
    vi.mocked(oidc.revokeRefreshToken).mockImplementation(async (token) => {
      expect(token).toBe("current-refresh-token");
      missingAtRevocation = (await repository.readSession(handle)) === null;
      throw new OidcProtocolError("oidc_revocation_failed", "transient");
    });

    const location = await service.logout(handle);

    expect(missingAtRevocation).toBe(true);
    await expect(repository.readSession(handle)).resolves.toBeNull();
    expect(location).toBe("https://identity.example.com/logout");
    expect(location).not.toContain("id_token_hint");
    expect(location).not.toContain("current-id-token");
  });

  it("does not report logout success or revoke when authoritative deletion fails", async () => {
    const { repository, service, oidc } = harness(vi.fn());
    const handle = await createSession(repository);
    vi.spyOn(repository, "deleteSession").mockRejectedValue(
      new Error("redis unavailable"),
    );

    await expect(service.logout(handle)).rejects.toThrow("redis unavailable");
    expect(oidc.revokeRefreshToken).not.toHaveBeenCalled();
  });
});
