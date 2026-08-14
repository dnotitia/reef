import { afterEach, describe, expect, it, vi } from "vitest";

type Span = {
  name: string;
  attributes: Record<string, unknown>;
  setAttribute: (key: string, value: unknown) => void;
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
};

const spans: Span[] = [];

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  trace: {
    getTracer: () => ({
      startActiveSpan: vi.fn(
        async (name: string, callback: (span: Span) => Promise<unknown>) => {
          const span: Span = {
            name,
            attributes: {},
            setAttribute: (key, value) => {
              span.attributes[key] = value;
            },
            end: vi.fn(),
            recordException: vi.fn(),
            setStatus: vi.fn(),
          };
          spans.push(span);
          return callback(span);
        },
      ),
    }),
  },
}));

import {
  createControlPlaneAdminAdapter,
  createControlPlaneAppAdapter,
  exchangeControlPlaneCredential,
} from "./controlPlane";
import { ControlPlaneError, SchemaValidationError } from "../../errors";

const SECRET = "private-control-plane-marker";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installationFixture(overrides: Record<string, unknown> = {}) {
  return {
    installation_id: "installation-1",
    app_id: "app-1",
    vault_id: "vault-1",
    lifecycle: "blocked",
    blocked_reason: "checksum_mismatch",
    desired_release: { id: "release-2", version: "2.0.0" },
    current_release: { id: "release-1", version: "1.0.0" },
    observed: {
      generation: 4,
      observed_at: "2026-08-14T10:00:00.000Z",
      release: { id: "release-1", version: "1.0.0" },
      schema_fingerprint: "schema-1",
      grant_generation: 2,
      checkpoint: { step: "verify" },
      recent_error: null,
    },
    desired_grant_generation: 3,
    latest_grant: {
      generation: 3,
      status: "active",
      capabilities: ["inventory:read"],
    },
    active_grant: {
      generation: 2,
      status: "active",
      capabilities: ["inventory:read"],
    },
    owned_resources: [{ kind: "table", key: "reef_issues", status: "owned" }],
    checkpoint: { phase: "blocked" },
    recent_error: null,
    drift: {
      release: { status: "mismatch", expected: "2.0.0", actual: "1.0.0" },
      schema: { status: "in_sync" },
      grant: { status: "in_sync" },
      overall: "drifted",
      reasons: ["release_mismatch"],
      unknown_dimensions: [],
    },
    drift_classification: {
      release: { status: "mismatch" },
      schema: { status: "in_sync" },
      grant: { status: "in_sync" },
      overall: "drifted",
      reasons: ["release_mismatch"],
      unknown_dimensions: [],
    },
    created_at: "2026-08-14T09:00:00.000Z",
    updated_at: "2026-08-14T10:00:00.000Z",
    command_status: "accepted",
    replayed: true,
    ...overrides,
  };
}

function rolloutFixture(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "job-1",
    app_id: "app-1",
    release_id: "release-2",
    manifest_checksum: "checksum-2",
    snapshot_id: "snapshot-1",
    status: "blocked",
    blocked_reason: "schema_incompatible",
    created_at: "2026-08-14T09:00:00.000Z",
    updated_at: "2026-08-14T10:00:00.000Z",
    completed_at: null,
    targets: [
      {
        target_id: "target-1",
        installation_id: "installation-1",
        vault_id: "vault-1",
        ordinal: 1,
        batch: 1,
        canary: true,
        state: "blocked",
        reason: "schema_incompatible",
        steps: [
          {
            step_id: "step-1",
            operation: "install",
            state: "blocked",
            checkpoint: { marker: "bounded" },
            reason: "schema_incompatible",
          },
        ],
      },
    ],
    replayed: true,
    source_rollout_id: "job-0",
    resume_outcome: "replayed",
    resume_reason: "same idempotency key",
    ...overrides,
  };
}

function appFixture() {
  return {
    id: "app-1",
    app_key: "reef-app",
    display_name: "Reef App",
    description: "Control-plane app",
    metadata: { owner: "reef" },
    created_at: "2026-08-14T09:00:00.000Z",
    updated_at: "2026-08-14T10:00:00.000Z",
    replayed: false,
  };
}

function releaseFixture() {
  return {
    id: "release-1",
    app_id: "app-1",
    version: "1.0.0",
    manifest: { steps: [{ operation: "install" }] },
    manifest_checksum: "checksum-1",
    registered_at: "2026-08-14T09:00:00.000Z",
    replayed: false,
  };
}

function observedStateResultFixture() {
  return {
    accepted: true,
    installation_id: "installation-1",
    observed_generation: 5,
    observed_at: "2026-08-14T10:00:00.000Z",
  };
}

function snapshotCreateFixture() {
  return {
    snapshot_id: "snapshot-1",
    app_id: "app-1",
    created_at: "2026-08-14T09:00:00.000Z",
    sealed_at: null,
    requested_by_kind: "admin",
    target_count: 1,
  };
}

function snapshotFixture() {
  return {
    ...snapshotCreateFixture(),
    sealed_at: "2026-08-14T09:01:00.000Z",
    targets: [
      {
        target_id: "target-1",
        installation_id: "installation-1",
        vault_id: "vault-1",
        desired_release: { id: "release-1", version: "1.0.0" },
        current_release: { id: "release-1", version: "1.0.0" },
        baseline_grant_generation: 2,
        state: "pending",
        reason_code: null,
        created_at: "2026-08-14T09:00:00.000Z",
        updated_at: "2026-08-14T09:00:00.000Z",
      },
    ],
  };
}

function eligibilityFixture() {
  return {
    target_id: "target-1",
    eligible: true,
    executed: true,
    state: "eligible",
    reason_code: null,
  };
}

function inventoryFixture() {
  const installation = installationFixture();
  return {
    items: [
      {
        installation_id: installation.installation_id,
        app_id: installation.app_id,
        vault_id: installation.vault_id,
        vault_name: "Reef Vault",
        lifecycle: installation.lifecycle,
        desired_release: installation.desired_release,
        current_release: installation.current_release,
        observed: installation.observed,
        latest_grant: installation.latest_grant,
        latest_active_grant: installation.active_grant,
        grant_generation: 3,
        checkpoint: installation.checkpoint,
        recent_error: installation.recent_error,
        drift: installation.drift,
        drift_classification: installation.drift_classification,
        created_at: installation.created_at,
        updated_at: installation.updated_at,
      },
    ],
    next_cursor: null,
  };
}

afterEach(() => {
  spans.splice(0);
  vi.restoreAllMocks();
});

describe("control-plane adapters", () => {
  it("covers the admin REST route, method, query, body, and idempotency contract", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/apps")) return jsonResponse(appFixture(), 201);
        if (url.includes("/releases")) return jsonResponse(releaseFixture());
        if (url.includes("/installations")) {
          return jsonResponse(installationFixture());
        }
        if (url.includes("/inventory?"))
          return jsonResponse(inventoryFixture());
        if (url.endsWith("/observed-state")) {
          return jsonResponse(observedStateResultFixture());
        }
        if (url.endsWith("/rollout-snapshots")) {
          return jsonResponse(snapshotCreateFixture());
        }
        if (
          url.includes("/rollout-snapshots/") &&
          url.endsWith("/eligibility")
        ) {
          return jsonResponse(eligibilityFixture());
        }
        if (url.includes("/rollout-snapshots/"))
          return jsonResponse(snapshotFixture());
        if (url.endsWith("/apps/app%2Fid")) return jsonResponse(appFixture());
        return jsonResponse(rolloutFixture());
      },
    );
    const adapter = createControlPlaneAdminAdapter({
      baseUrl: "https://akb.example.test/api/v1/",
      adminToken: "admin-token",
      fetch,
    });

    await adapter.apps.create({ appKey: "reef-app" });
    await adapter.apps.get("app/id");
    await adapter.apps.update("app/id", { displayName: "Updated App" });
    await adapter.releases.create("app/id", {
      version: "1.0.0",
      manifest: { steps: [] },
      manifestChecksum: "checksum-1",
    });
    await adapter.releases.get("app/id", "release/id");
    await adapter.installations.apply("app/id", "vault/id", {
      releaseId: "release-1",
      capabilities: ["inventory:read"],
    });
    await adapter.installations.get("app/id", "vault/id");
    await adapter.installations.uninstall("app/id", "vault/id");
    await adapter.inventory.list("app/id", {
      limit: 3,
      cursor: "cursor/id",
      lifecycle: "active",
    });
    await adapter.inventory.reportObserved("app/id", {
      installationId: "installation-1",
      observedGeneration: 5,
      checkpoint: { phase: "observe" },
    });
    await adapter.snapshots.create("app/id");
    await adapter.snapshots.get("app/id", "snapshot/id");
    await adapter.snapshots.evaluate("app/id", "snapshot/id", "target/id");
    await adapter.rollouts.request(
      "app/id",
      { releaseId: "release-1", manifestChecksum: "checksum-1" },
      "request-key",
    );
    await adapter.rollouts.get("app/id", "job/id");
    await adapter.rollouts.resume(
      "app/id",
      "job/id",
      { releaseId: "release-1", manifestChecksum: "checksum-1" },
      "resume-key",
    );

    expect(calls.map(({ url, init }) => [init.method, url])).toEqual([
      ["POST", "https://akb.example.test/api/v1/apps"],
      ["GET", "https://akb.example.test/api/v1/apps/app%2Fid"],
      ["PATCH", "https://akb.example.test/api/v1/apps/app%2Fid"],
      ["POST", "https://akb.example.test/api/v1/apps/app%2Fid/releases"],
      [
        "GET",
        "https://akb.example.test/api/v1/apps/app%2Fid/releases/release%2Fid",
      ],
      [
        "PUT",
        "https://akb.example.test/api/v1/apps/app%2Fid/installations/vault%2Fid",
      ],
      [
        "GET",
        "https://akb.example.test/api/v1/apps/app%2Fid/installations/vault%2Fid",
      ],
      [
        "DELETE",
        "https://akb.example.test/api/v1/apps/app%2Fid/installations/vault%2Fid",
      ],
      [
        "GET",
        "https://akb.example.test/api/v1/apps/app%2Fid/inventory?limit=3&cursor=cursor%2Fid&lifecycle=active",
      ],
      ["POST", "https://akb.example.test/api/v1/apps/app%2Fid/observed-state"],
      [
        "POST",
        "https://akb.example.test/api/v1/apps/app%2Fid/rollout-snapshots",
      ],
      [
        "GET",
        "https://akb.example.test/api/v1/apps/app%2Fid/rollout-snapshots/snapshot%2Fid",
      ],
      [
        "POST",
        "https://akb.example.test/api/v1/apps/app%2Fid/rollout-snapshots/snapshot%2Fid/targets/target%2Fid/eligibility",
      ],
      ["POST", "https://akb.example.test/api/v1/apps/app%2Fid/rollouts"],
      [
        "GET",
        "https://akb.example.test/api/v1/apps/app%2Fid/rollouts/job%2Fid",
      ],
      [
        "POST",
        "https://akb.example.test/api/v1/apps/app%2Fid/rollouts/job%2Fid/resume",
      ],
    ]);
    expect(calls[0].init.body).toBe(JSON.stringify({ app_key: "reef-app" }));
    expect(calls[9].init.body).toBe(
      JSON.stringify({
        installation_id: "installation-1",
        observed_generation: 5,
        checkpoint: { phase: "observe" },
      }),
    );
    expect(
      Object.fromEntries(new Headers(calls[13].init.headers)),
    ).toMatchObject({
      authorization: "Bearer admin-token",
      "idempotency-key": "request-key",
    });
    expect(
      Object.fromEntries(new Headers(calls[15].init.headers)),
    ).toMatchObject({
      authorization: "Bearer admin-token",
      "idempotency-key": "resume-key",
    });
    expect(calls[10].init.body).toBeUndefined();
    expect(calls[12].init.body).toBeUndefined();
  });

  it("projects installation state, preserves replay/drift, and keeps the private wire boundary", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return jsonResponse(installationFixture());
      },
    );
    const adapter = createControlPlaneAdminAdapter({
      baseUrl: "https://akb.example.test",
      adminToken: "admin-token",
      fetch,
    });

    const result = await adapter.installations.apply("app-1", "vault-1", {
      releaseId: "release-2",
      capabilities: ["inventory:read"],
      mode: "install",
    });

    expect(result.lifecycle).toBe("blocked");
    expect(result.commandStatus).toBe("accepted");
    expect(result.replayed).toBe(true);
    expect(result.desiredRelease?.version).toBe("2.0.0");
    expect(result.drift?.overall).toBe("drifted");
    expect(result.driftClassification?.release.status).toBe("mismatch");
    expect(result.observed?.observedAt).toBe("2026-08-14T10:00:00.000Z");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://akb.example.test/api/v1/apps/app-1/installations/vault-1",
    );
    expect(calls[0].init.method).toBe("PUT");
    expect(
      Object.fromEntries(new Headers(calls[0].init.headers)),
    ).toMatchObject({
      authorization: "Bearer admin-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      release_id: "release-2",
      capabilities: ["inventory:read"],
      mode: "install",
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].end).toHaveBeenCalledTimes(1);
    expect(spans[0].attributes).toMatchObject({
      "control_plane.operation": "admin.installations.apply",
      "control_plane.actor_mode": "admin",
      "control_plane.lifecycle": "blocked",
      "control_plane.replayed": true,
    });
    expect(spans[0].attributes).not.toHaveProperty("release-2");
    expect(adapter).not.toHaveProperty("request");
    expect(adapter).not.toHaveProperty("vault");
    expect(adapter).not.toHaveProperty("credentials");
  });

  it("encodes camelCase requests and idempotency keys for app rollouts", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return jsonResponse(rolloutFixture());
      },
    );
    const adapter = createControlPlaneAppAdapter({
      baseUrl: "https://akb.example.test/api/v1/",
      appToken: () => "app-token",
      fetch,
    });

    const result = await adapter.rollouts.resume(
      "job-1",
      { releaseId: "release-2", manifestChecksum: "checksum-2" },
      "resume-key",
    );

    expect(result.status).toBe("blocked");
    expect(result.resumeOutcome).toBe("replayed");
    expect(result.sourceRolloutId).toBe("job-0");
    expect(calls[0].url).toBe(
      "https://akb.example.test/api/v1/app/rollouts/job-1/resume",
    );
    expect(
      Object.fromEntries(new Headers(calls[0].init.headers)),
    ).toMatchObject({
      authorization: "Bearer app-token",
      "idempotency-key": "resume-key",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      release_id: "release-2",
      manifest_checksum: "checksum-2",
    });
    expect(spans[0].end).toHaveBeenCalledTimes(1);
    expect(spans[0].attributes).toMatchObject({
      "control_plane.operation": "app.rollouts.resume",
      "control_plane.actor_mode": "app",
      "control_plane.rollout_status": "blocked",
      "control_plane.replayed": true,
      "control_plane.resume_outcome": "replayed",
    });
  });

  it("authorizes an app capability through the direct REST projection", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return jsonResponse({ authorized: true, correlation_id: "corr-2" });
      },
    );
    const adapter = createControlPlaneAppAdapter({
      baseUrl: "https://akb.example.test/api/v1/",
      appToken: "app-token",
      fetch,
    });

    await expect(
      adapter.authorize({
        vaultId: "vault/one",
        capability: "inventory:read",
        resourceKind: "table",
        resourceKey: "reef_issues",
      }),
    ).resolves.toEqual({ authorized: true, correlationId: "corr-2" });
    expect(calls[0].url).toBe("https://akb.example.test/api/v1/app/authorize");
    expect(calls[0].init.method).toBe("POST");
    expect(
      Object.fromEntries(new Headers(calls[0].init.headers)),
    ).toMatchObject({
      authorization: "Bearer app-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      vault_id: "vault/one",
      capability: "inventory:read",
      resource_kind: "table",
      resource_key: "reef_issues",
    });
    expect(spans[0].attributes).toMatchObject({
      "control_plane.operation": "app.authorize",
      "control_plane.actor_mode": "app",
      "control_plane.upstream_status": 200,
    });
    expect(JSON.stringify(spans[0].attributes)).not.toContain(SECRET);
  });

  it("maps statuses and stable codes without retaining upstream body/details", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(
        {
          message: SECRET,
          code: "permission_denied",
          hint: "Check the app installation",
          details: { secret: SECRET, manifest: { marker: SECRET } },
        },
        403,
      ),
    );
    const adapter = createControlPlaneAppAdapter({
      baseUrl: "https://akb.example.test",
      appToken: "app-token",
      fetch,
    });

    await expect(adapter.installations.get("vault-1")).rejects.toMatchObject({
      category: "authorization",
      status: 403,
      httpStatus: 403,
      upstreamCode: "permission_denied",
      retryable: false,
      hint: "Check the app installation",
    });
    const error = await adapter.installations
      .get("vault-1")
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ControlPlaneError);
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(spans).toHaveLength(2);
    expect(spans[1].end).toHaveBeenCalledTimes(1);
    expect(spans[1].attributes).not.toHaveProperty(SECRET);
  });

  it("treats transport failures as retryable and redacts their details", async () => {
    const fetch = vi.fn(async () => {
      throw new Error(SECRET);
    });
    const adapter = createControlPlaneAppAdapter({
      baseUrl: "https://akb.example.test",
      appToken: "app-token",
      fetch,
    });

    const error = await adapter.inventory
      .list()
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ControlPlaneError);
    expect(error).toMatchObject({
      category: "transport",
      httpStatus: 503,
      retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(spans[0].recordException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining(SECRET),
      }),
    );
    expect(spans[0].end).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "authentication", 401, false],
    [403, "authorization", 403, false],
    [404, "not_found", 404, false],
    [409, "conflict", 409, false],
    [400, "invalid_argument", 400, false],
    [422, "invalid_argument", 422, false],
    [429, "rate_limited", 429, true],
    [500, "unavailable", 503, true],
    [418, "unknown", 502, false],
  ] as const)(
    "classifies direct REST status %i as %s",
    async (status, category, httpStatus, retryable) => {
      const fetch = vi.fn(async () =>
        jsonResponse(
          {
            code: "wire_code",
            message: SECRET,
            details: { marker: SECRET },
          },
          status,
        ),
      );
      const adapter = createControlPlaneAppAdapter({
        baseUrl: "https://akb.example.test",
        appToken: "app-token",
        fetch,
      });

      const error = await adapter.inventory
        .list()
        .catch((value: unknown) => value);
      expect(error).toMatchObject({ category, httpStatus, retryable });
      expect(JSON.stringify(error)).not.toContain(SECRET);
      expect(spans.at(-1)?.end).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects caller requests before any server call", async () => {
    const fetch = vi.fn();
    const adapter = createControlPlaneAdminAdapter({
      baseUrl: "https://akb.example.test",
      adminToken: "admin-token",
      fetch,
    });

    await expect(
      adapter.rollouts.request(
        "app-1",
        { releaseId: "", manifestChecksum: "" },
        "",
      ),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(fetch).not.toHaveBeenCalled();
    expect(spans).toHaveLength(0);
  });

  it("exchanges a deployment credential into a short-lived token projection", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          access_token: "short-lived-token",
          token_type: "Bearer",
          expires_in: 300,
          expires_at: "2026-08-14T10:05:00.000Z",
          correlation_id: "corr-1",
        });
      },
    );

    const result = await exchangeControlPlaneCredential({
      baseUrl: "https://akb.example.test",
      credential: "deployment-credential",
      fetch,
    });

    expect(result).toEqual({
      accessToken: "short-lived-token",
      tokenType: "Bearer",
      expiresIn: 300,
      expiresAt: "2026-08-14T10:05:00.000Z",
      correlationId: "corr-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://akb.example.test/api/v1/auth/app-token");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.stringify(calls[0].init.headers)).not.toContain(
      "authorization",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      credential: "deployment-credential",
    });
    expect(spans[0].attributes).not.toHaveProperty("credential");
  });
});
