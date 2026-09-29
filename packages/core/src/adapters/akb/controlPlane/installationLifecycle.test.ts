import { describe, expect, it } from "vitest";
import { AuthError, SchemaValidationError } from "../../../errors";
import { makeAdapter, setupFetch } from "../core/akb.testSupport";
import {
  readInstallation,
  readMemberInstallationActive,
  requestInstallation,
  uninstallInstallation,
} from "./installationLifecycle";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const VAULT_ID = "22222222-2222-4222-8222-222222222222";
const INSTALLATION_ID = "33333333-3333-4333-8333-333333333333";
const RELEASE_ID = "44444444-4444-4444-8444-444444444444";

function installation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    installation_id: INSTALLATION_ID,
    app_id: APP_ID,
    vault_id: VAULT_ID,
    lifecycle: "active",
    command_status: "accepted",
    replayed: false,
    ...overrides,
  };
}

function body(call: { init: RequestInit | undefined } | undefined): unknown {
  return JSON.parse(String(call?.init?.body));
}

describe("user-scoped AKB installation lifecycle", () => {
  it("reads only the minimal member availability projection", async () => {
    const { calls } = setupFetch([{ body: { active: true } }]);

    await expect(
      readMemberInstallationActive({
        adapter: makeAdapter(),
        appId: APP_ID,
        vaultId: VAULT_ID,
      }),
    ).resolves.toBe(true);
    expect(calls[0]?.url).toBe(
      `https://akb.test/api/v1/apps/${APP_ID}/installations/${VAULT_ID}/active`,
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("keeps inactive as a boolean and rejects detail fields", async () => {
    setupFetch([{ body: { active: false } }]);
    await expect(
      readMemberInstallationActive({
        adapter: makeAdapter(),
        appId: APP_ID,
        vaultId: VAULT_ID,
      }),
    ).resolves.toBe(false);

    setupFetch([{ body: { active: true, lifecycle: "active" } }]);
    await expect(
      readMemberInstallationActive({
        adapter: makeAdapter(),
        appId: APP_ID,
        vaultId: VAULT_ID,
      }),
    ).rejects.toMatchObject({
      category: "invalid_response",
      httpStatus: 502,
    });
  });

  it("preserves member permission denials and maps lookup outages to retryable 503", async () => {
    setupFetch([{ status: 403, body: { detail: "denied" } }]);
    await expect(
      readMemberInstallationActive({
        adapter: makeAdapter(),
        appId: APP_ID,
        vaultId: VAULT_ID,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    setupFetch([
      {
        status: 503,
        body: { code: "member_installation_status_unavailable" },
      },
    ]);
    await expect(
      readMemberInstallationActive({
        adapter: makeAdapter(),
        appId: APP_ID,
        vaultId: VAULT_ID,
      }),
    ).rejects.toMatchObject({
      category: "unavailable",
      upstreamStatus: 503,
      httpStatus: 503,
      retryable: true,
      upstreamCode: "member_installation_status_unavailable",
    });
  });

  it("reads the canonical app/vault installation with the user's AKB session", async () => {
    const { calls } = setupFetch([{ body: installation() }]);

    const result = await readInstallation({
      adapter: makeAdapter(),
      appId: APP_ID,
      vaultId: VAULT_ID,
    });

    expect(result).toMatchObject({
      installationId: INSTALLATION_ID,
      appId: APP_ID,
      vaultId: VAULT_ID,
      lifecycle: "active",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://akb.test/api/v1/apps/${APP_ID}/installations/${VAULT_ID}`,
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer jwt.example.token",
    );
  });

  it("sends a fixed capability and server-selected release for install", async () => {
    const { calls } = setupFetch([{ body: installation() }]);

    const result = await requestInstallation({
      adapter: makeAdapter(),
      appId: APP_ID,
      vaultId: VAULT_ID,
      releaseId: RELEASE_ID,
      mode: "install",
    });

    expect(result).toMatchObject({
      installation: { lifecycle: "active" },
      commandStatus: "accepted",
      replayed: false,
    });
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(body(calls[0])).toEqual({
      release_id: RELEASE_ID,
      capabilities: ["installation:read"],
      mode: "install",
    });
  });

  it("restores only from the retained release on an uninstalled record", async () => {
    const retainedReleaseId = "55555555-5555-4555-8555-555555555555";
    const { calls } = setupFetch([
      {
        body: installation({
          lifecycle: "uninstalled",
          current_release: { id: retainedReleaseId, version: "1.4.0" },
        }),
      },
      { body: installation({ lifecycle: "installing" }) },
    ]);

    const result = await requestInstallation({
      adapter: makeAdapter(),
      appId: APP_ID,
      vaultId: VAULT_ID,
      releaseId: RELEASE_ID,
      mode: "restore",
    });

    expect(result.installation.lifecycle).toBe("installing");
    expect(calls.map((call) => call.init?.method)).toEqual(["GET", "PUT"]);
    expect(body(calls[1])).toEqual({
      release_id: retainedReleaseId,
      capabilities: ["installation:read"],
      mode: "restore",
    });
  });

  it("rejects restore unless AKB reports a retained uninstalled release", async () => {
    const { calls } = setupFetch([
      { body: installation({ lifecycle: "blocked" }) },
    ]);

    await expect(
      requestInstallation({
        adapter: makeAdapter(),
        appId: APP_ID,
        vaultId: VAULT_ID,
        releaseId: RELEASE_ID,
        mode: "restore",
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("uninstalls without deleting any vault data", async () => {
    const { calls } = setupFetch([
      { body: installation({ lifecycle: "uninstalled" }) },
    ]);

    const result = await uninstallInstallation({
      adapter: makeAdapter(),
      appId: APP_ID,
      vaultId: VAULT_ID,
    });

    expect(result.installation.lifecycle).toBe("uninstalled");
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("validates IDs before making an AKB request", async () => {
    const { calls } = setupFetch([]);

    await expect(
      readInstallation({
        adapter: makeAdapter(),
        appId: "not-a-uuid",
        vaultId: VAULT_ID,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });
});
