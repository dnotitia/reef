import { afterEach, describe, expect, it, vi } from "vitest";

const spans: Array<{
  name: string;
  attributes: Record<string, unknown>;
  setAttribute: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  trace: {
    getTracer: () => ({
      startActiveSpan: vi.fn(
        async (
          name: string,
          callback: (span: (typeof spans)[number]) => Promise<unknown>,
        ) => {
          const span = {
            name,
            attributes: {} as Record<string, unknown>,
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

import {
  buildReleaseBlueprint,
  createAkbAppRegistry,
  finalizeAppReleaseManifest,
} from "../../../index";
import { ControlPlaneError } from "../../../errors";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "registry-private-marker";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function appFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    app_key: "reef",
    display_name: "Reef",
    description: "Reef project management workspace",
    metadata: { internal: SECRET },
    created_at: "2026-09-04T06:00:00.000Z",
    updated_at: "2026-09-04T06:00:00.000Z",
    replayed: false,
    ...overrides,
  };
}

async function finalizedRelease() {
  return finalizeAppReleaseManifest({
    blueprint: await buildReleaseBlueprint(),
    version: "0.14.1",
    sourceRevision: "a".repeat(40),
    imageDigest: `sha256:${"b".repeat(64)}`,
  });
}

afterEach(() => {
  spans.splice(0);
  vi.restoreAllMocks();
});

describe("createAkbAppRegistry", () => {
  it("uses the fixed Reef app payload and projects the app response", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const registry = createAkbAppRegistry({
      baseUrl: "https://akb.example.test/api/v1///",
      adminToken: "admin-secret",
      fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return jsonResponse(appFixture());
      }),
    });

    const result = await registry.createApp();

    expect(result).toEqual({
      id: APP_ID,
      appKey: "reef",
      displayName: "Reef",
      description: "Reef project management workspace",
      replayed: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://akb.example.test/api/v1/apps");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      app_key: "reef",
      display_name: "Reef",
      description: "Reef project management workspace",
    });
    expect(Object.fromEntries(new Headers(calls[0]?.init.headers))).toEqual({
      accept: "application/json",
      authorization: "Bearer admin-secret",
      "content-type": "application/json",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(spans[0]?.name).toBe("akb.control_plane.apps.create");
  });

  it("reads a persisted app UUID without guessing another identity", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(appFixture({ app_key: "other" })),
    );
    const registry = createAkbAppRegistry({
      baseUrl: "https://akb.example.test",
      adminToken: "admin-secret",
      fetch,
    });

    const result = await registry.getApp(APP_ID);

    expect(result.appKey).toBe("other");
    expect(fetch).toHaveBeenCalledWith(
      `https://akb.example.test/api/v1/apps/${APP_ID}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("finalizes and sends the exact immutable release payload", async () => {
    const finalized = await finalizedRelease();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const registry = createAkbAppRegistry({
      baseUrl: "https://akb.example.test",
      adminToken: "admin-secret",
      fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          id: RELEASE_ID,
          app_id: APP_ID,
          version: finalized.version,
          manifest: finalized.manifest,
          manifest_checksum: finalized.manifest_checksum,
          registered_at: "2026-09-04T06:00:00.000Z",
          replayed: true,
        });
      }),
    });

    const result = await registry.createRelease({
      appId: APP_ID,
      ...finalized,
    });

    expect(result).toMatchObject({
      id: RELEASE_ID,
      appId: APP_ID,
      version: finalized.version,
      manifestChecksum: finalized.manifest_checksum,
      replayed: true,
    });
    expect(calls[0]?.url).toBe(
      `https://akb.example.test/api/v1/apps/${APP_ID}/releases`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      version: finalized.version,
      manifest: finalized.manifest,
      manifest_checksum: finalized.manifest_checksum,
    });
    expect(
      new Headers(calls[0]?.init.headers).get("idempotency-key"),
    ).toBeNull();
  });

  it("rejects a mutable or stale release before network I/O", async () => {
    const fetch = vi.fn();
    const registry = createAkbAppRegistry({
      baseUrl: "https://akb.example.test",
      adminToken: "admin-secret",
      fetch,
    });

    await expect(
      registry.createRelease({
        appId: APP_ID,
        version: "0.14.1",
        manifest: { manifest_version: 2 } as never,
        manifest_checksum: "a".repeat(64),
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps registry failures without retaining upstream messages", async () => {
    const registry = createAkbAppRegistry({
      baseUrl: "https://akb.example.test",
      adminToken: "admin-secret",
      fetch: vi.fn(async () =>
        jsonResponse(
          { message: SECRET, detail: { message: SECRET }, code: "conflict" },
          409,
        ),
      ),
    });

    const error = await registry.getApp(APP_ID).catch((caught) => caught);

    expect(error).toBeInstanceOf(ControlPlaneError);
    expect(error).toMatchObject({
      category: "conflict",
      upstreamStatus: 409,
      httpStatus: 409,
      retryable: false,
      upstreamCode: "conflict",
    });
    expect(error.message).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });
});
