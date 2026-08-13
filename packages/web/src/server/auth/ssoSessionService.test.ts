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

function harness(refresh: KeycloakOidcClient["refresh"]) {
  const repository = createEncryptedSessionRepository({
    backend: createMemorySessionBackend(),
    cipher: createSessionCipher(new Uint8Array(Buffer.alloc(32, 4))),
  });
  const oidc = {
    refresh,
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
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
      now: () => NOW_SECONDS,
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
      tokenSet: tokenSet(overrides),
    },
    60_000,
  );
}

describe("SSO session refresh", () => {
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
});
