import { afterEach, describe, expect, it, vi } from "vitest";

type TestSpan = {
  name: string;
  attributes: Record<string, unknown>;
  setAttribute: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const spans: TestSpan[] = [];

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  trace: {
    getTracer: () => ({
      startActiveSpan: vi.fn(
        async (
          name: string,
          callback: (span: TestSpan) => Promise<unknown>,
        ) => {
          const span: TestSpan = {
            name,
            attributes: {},
            setAttribute: vi.fn((key: string, value: unknown) => {
              span.attributes[key] = value;
            }),
            recordException: vi.fn(),
            setStatus: vi.fn(),
            end: vi.fn(),
          };
          spans.push(span);
          return callback(span);
        },
      ),
    }),
  },
}));

import { createAkbAppInstallationReader } from "./installationReader";
import type { ControlPlaneInstallation } from "../../../schemas/controlPlane";
import { ControlPlaneError, SchemaValidationError } from "../../../errors";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const VAULT_ID = "22222222-2222-4222-8222-222222222222";
const INSTALLATION_ID = "33333333-3333-4333-8333-333333333333";
const RELEASE_ID = "44444444-4444-4444-8444-444444444444";
const SECRET = "private-control-plane-marker";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installationFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    installation_id: INSTALLATION_ID,
    app_id: APP_ID,
    vault_id: VAULT_ID,
    lifecycle: "blocked",
    blocked_reason: "checksum_mismatch",
    desired_release: { id: RELEASE_ID, version: "2.0.0" },
    current_release: { id: null, version: null },
    observed: {
      generation: 4,
      observed_at: "2026-08-14T10:00:00.000Z",
      release: { id: RELEASE_ID, version: "1.0.0" },
      schema_fingerprint: "schema-1",
      grant_generation: 2,
      checkpoint: { secret: SECRET },
      recent_error: { message: SECRET },
    },
    desired_grant_generation: 3,
    latest_grant: {
      generation: 3,
      status: "active",
      capabilities: ["installation:read"],
    },
    active_grant: {
      generation: 2,
      status: "revoked",
      capabilities: ["installation:read"],
    },
    owned_resources: [{ kind: "table", key: SECRET, status: "owned" }],
    checkpoint: { marker: SECRET },
    recent_error: { detail: SECRET },
    drift: {
      release: { status: "mismatch", expected: SECRET, actual: "1.0.0" },
      schema: { status: "in_sync", expected: SECRET, actual: SECRET },
      grant: { status: "unknown", expected: SECRET, actual: SECRET },
      overall: "drifted",
      reasons: ["release_mismatch"],
      unknown_dimensions: ["grant"],
    },
    drift_classification: {
      release: { status: "mismatch", expected: SECRET, actual: SECRET },
      schema: { status: "in_sync", expected: SECRET, actual: SECRET },
      grant: { status: "unknown", expected: SECRET, actual: SECRET },
      overall: "drifted",
      reasons: ["release_mismatch"],
      unknown_dimensions: ["grant"],
    },
    created_at: "2026-08-14T09:00:00.000Z",
    updated_at: "2026-08-14T10:00:00.000Z",
    command_status: "accepted",
    replayed: true,
    ...overrides,
  };
}

function makeReader(
  response: Response | (() => Promise<Response>),
  overrides: Partial<Parameters<typeof createAkbAppInstallationReader>[0]> = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return typeof response === "function" ? response() : response;
    },
  );
  const reader = createAkbAppInstallationReader({
    baseUrl: "https://akb.example.test/api/v1///",
    appToken: "app-token",
    fetch,
    ...overrides,
  });
  return { reader, calls, fetch };
}

afterEach(() => {
  spans.splice(0);
  vi.restoreAllMocks();
});

describe("createAkbAppInstallationReader", () => {
  it("performs only the app installation GET and projects the bounded public shape", async () => {
    const { reader, calls } = makeReader(jsonResponse(installationFixture()));

    const result = await reader.getInstallation(VAULT_ID);

    expect(Object.keys(reader)).toEqual(["getInstallation"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://akb.example.test/api/v1/app/installations/${VAULT_ID}`,
    );
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    expect(Object.fromEntries(new Headers(calls[0].init.headers))).toEqual({
      accept: "application/json",
      authorization: "Bearer app-token",
    });

    expect(result).toMatchObject<Partial<ControlPlaneInstallation>>({
      installationId: INSTALLATION_ID,
      appId: APP_ID,
      vaultId: VAULT_ID,
      lifecycle: "blocked",
      blockedReason: "checksum_mismatch",
      desiredRelease: { id: RELEASE_ID, version: "2.0.0" },
      currentRelease: { id: null, version: null },
      observed: {
        generation: 4,
        observedAt: "2026-08-14T10:00:00.000Z",
        release: { id: RELEASE_ID, version: "1.0.0" },
        schemaFingerprint: "schema-1",
        grantGeneration: 2,
      },
      latestGrant: {
        generation: 3,
        status: "active",
        capabilities: ["installation:read"],
      },
      activeGrant: {
        generation: 2,
        status: "revoked",
        capabilities: ["installation:read"],
      },
      drift: {
        release: { status: "mismatch" },
        schema: { status: "in_sync" },
        grant: { status: "unknown" },
        overall: "drifted",
        reasons: ["release_mismatch"],
        unknownDimensions: ["grant"],
      },
      driftClassification: {
        release: { status: "mismatch" },
        schema: { status: "in_sync" },
        grant: { status: "unknown" },
        overall: "drifted",
        reasons: ["release_mismatch"],
        unknownDimensions: ["grant"],
      },
    });
    expect(result).not.toHaveProperty("ownedResources");
    expect(result).not.toHaveProperty("checkpoint");
    expect(result).not.toHaveProperty("recentError");
    expect(result).not.toHaveProperty("commandStatus");
    expect(result).not.toHaveProperty("replayed");
    expect(JSON.stringify(result)).not.toContain(SECRET);

    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("akb.control_plane.app.installations.get");
    expect(spans[0].end).toHaveBeenCalledTimes(1);
    expect(spans[0].attributes).toMatchObject({
      "control_plane.operation": "app.installations.get",
      "control_plane.actor_mode": "app",
      "control_plane.lifecycle": "blocked",
      "control_plane.upstream_status": 200,
    });
    expect(JSON.stringify(spans[0].attributes)).not.toContain(SECRET);
  });

  it("preserves null state and does not recompute upstream drift", async () => {
    const { reader } = makeReader(
      jsonResponse(
        installationFixture({
          lifecycle: "uninstalled",
          blocked_reason: null,
          desired_release: null,
          current_release: null,
          observed: null,
          latest_grant: null,
          active_grant: null,
          drift: null,
          drift_classification: null,
        }),
      ),
    );

    const result = await reader.getInstallation(VAULT_ID);

    expect(result.lifecycle).toBe("uninstalled");
    expect(result.blockedReason).toBeNull();
    expect(result.desiredRelease).toBeNull();
    expect(result.currentRelease).toBeNull();
    expect(result.observed).toBeNull();
    expect(result.latestGrant).toBeNull();
    expect(result.activeGrant).toBeNull();
    expect(result.drift).toBeNull();
    expect(result.driftClassification).toBeNull();
  });

  it.each([
    [400, "invalid_argument", false, 400],
    [401, "authentication", false, 401],
    [403, "authorization", false, 403],
    [404, "not_found", false, 404],
    [409, "conflict", false, 409],
    [422, "invalid_argument", false, 422],
    [429, "rate_limited", true, 429],
    [500, "unavailable", true, 503],
  ] as const)(
    "maps HTTP %s to a safe ControlPlaneError",
    async (status, category, retryable, httpStatus) => {
      const { reader } = makeReader(
        jsonResponse(
          {
            message: SECRET,
            detail: { message: SECRET },
            hint: SECRET,
            code: "access_denied",
          },
          status,
        ),
      );

      const thrown = await reader
        .getInstallation(VAULT_ID)
        .catch((error) => error);

      expect(thrown).toBeInstanceOf(ControlPlaneError);
      expect(thrown).toMatchObject({
        category,
        upstreamStatus: status,
        httpStatus,
        retryable,
        upstreamCode: "access_denied",
      });
      expect(thrown.message).not.toContain(SECRET);
      expect(JSON.stringify(thrown)).not.toContain(SECRET);
      expect(spans[0].end).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(spans[0].attributes)).not.toContain(SECRET);
    },
  );

  it("redacts a credential-shaped upstream code and maps transport failures", async () => {
    const privateCode = makeReader(
      jsonResponse({ code: "private-marker-code", message: SECRET }, 403),
    );
    const privateCodeError = await privateCode.reader
      .getInstallation(VAULT_ID)
      .catch((error) => error);
    expect(privateCodeError.upstreamCode).toBeUndefined();

    spans.splice(0);
    const { reader } = makeReader(async () => {
      throw new Error(SECRET);
    });

    const thrown = await reader
      .getInstallation(VAULT_ID)
      .catch((error) => error);

    expect(thrown).toMatchObject({
      category: "transport",
      upstreamStatus: 0,
      httpStatus: 503,
      retryable: true,
    });
    expect(thrown.upstreamCode).toBe("transport_error");
    expect(thrown.message).not.toContain(SECRET);
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
    expect(spans[0].recordException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.not.stringContaining(SECRET) }),
    );
    expect(spans[0].end).toHaveBeenCalledTimes(1);
  });

  it("maps malformed, oversized, and late-success responses to bounded errors", async () => {
    const malformed = makeReader(jsonResponse({ lifecycle: "active" }));
    const malformedError = await malformed.reader
      .getInstallation(VAULT_ID)
      .catch((error) => error);
    expect(malformedError).toMatchObject({
      category: "invalid_response",
      upstreamStatus: 200,
      retryable: true,
      upstreamCode: "invalid_response",
    });

    spans.splice(0);
    const oversized = makeReader(jsonResponse({ payload: SECRET.repeat(20) }), {
      requestPolicy: { timeoutMs: 1_000, maxJsonResponseBytes: 32 },
    });
    const oversizedError = await oversized.reader
      .getInstallation(VAULT_ID)
      .catch((error) => error);
    expect(oversizedError).toMatchObject({ category: "invalid_response" });
    expect(JSON.stringify(oversizedError)).not.toContain(SECRET);

    spans.splice(0);
    const late = makeReader(jsonResponse(installationFixture(), 201));
    const lateError = await late.reader
      .getInstallation(VAULT_ID)
      .catch((error) => error);
    expect(lateError).toMatchObject({
      category: "invalid_response",
      upstreamStatus: 201,
    });
  });

  it("rejects a non-UUID vault locally without HTTP or a span", async () => {
    const { reader, fetch } = makeReader(jsonResponse(installationFixture()));

    const thrown = await reader
      .getInstallation("vault/not-a-uuid")
      .catch((error) => error);

    expect(thrown).toBeInstanceOf(SchemaValidationError);
    expect(fetch).not.toHaveBeenCalled();
    expect(spans).toHaveLength(0);
  });
});
