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

import { createAkbAppRollout } from "./rollout";
import { ControlPlaneError } from "../../../errors";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_JOB_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_KEY = "55555555-5555-4555-8555-555555555555";
const SECRET = "rollout-private-marker";
const CHECKSUM = "a".repeat(64);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rolloutFixture(overrides: Record<string, unknown> = {}) {
  return {
    job_id: JOB_ID,
    app_id: APP_ID,
    release_id: RELEASE_ID,
    manifest_checksum: CHECKSUM,
    snapshot_id: "66666666-6666-4666-8666-666666666666",
    status: "pending",
    blocked_reason: null,
    created_at: "2026-09-04T06:00:00.000Z",
    updated_at: "2026-09-04T06:00:00.000Z",
    completed_at: null,
    targets: [
      {
        target_id: SOURCE_JOB_ID,
        installation_id: APP_ID,
        vault_id: RELEASE_ID,
        ordinal: 0,
        batch: 0,
        canary: true,
        state: "pending",
        reason: null,
        steps: [
          {
            step_id: "noop",
            operation: "create_table",
            state: "pending",
            checkpoint: { secret: SECRET },
            reason: null,
          },
        ],
      },
    ],
    replayed: false,
    source_rollout_id: null,
    resume_outcome: null,
    resume_reason: null,
    ...overrides,
  };
}

function makeRollout(
  response: Response | (() => Promise<Response>),
  calls: Array<{ url: string; init: RequestInit }>,
) {
  return createAkbAppRollout({
    baseUrl: "https://akb.example.test/api/v1///",
    adminToken: "admin-secret",
    fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return typeof response === "function" ? response() : response;
    }),
  });
}

afterEach(() => {
  spans.splice(0);
  vi.restoreAllMocks();
});

describe("createAkbAppRollout", () => {
  it("requests a rollout with the UUID header and only release coordinates in JSON", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rollout = makeRollout(
      jsonResponse(rolloutFixture({ replayed: false }), 202),
      calls,
    );

    const result = await rollout.requestRollout({
      appId: APP_ID,
      releaseId: RELEASE_ID,
      manifestChecksum: CHECKSUM,
      idempotencyKey: REQUEST_KEY,
    });

    expect(result.responseStatus).toBe(202);
    expect(result.rollout.replayed).toBe(false);
    expect(result.rollout.resumeOutcome).toBeUndefined();
    expect(result.rollout.status).toBe("pending");
    expect(calls[0]?.url).toBe(
      `https://akb.example.test/api/v1/apps/${APP_ID}/rollouts`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      release_id: RELEASE_ID,
      manifest_checksum: CHECKSUM,
    });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer admin-secret");
    expect(headers.get("idempotency-key")).toBe(REQUEST_KEY);
    expect(spans[0]?.name).toBe("akb.control_plane.apps.rollouts.request");
    expect(spans[0]?.attributes["control_plane.upstream_status"]).toBe(202);
  });

  it("keeps replay transport status separate from an applied job state", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rollout = makeRollout(
      jsonResponse(rolloutFixture({ status: "applied", replayed: true }), 200),
      calls,
    );

    const result = await rollout.requestRollout({
      appId: APP_ID,
      releaseId: RELEASE_ID,
      manifestChecksum: CHECKSUM,
      idempotencyKey: REQUEST_KEY,
    });

    expect(result).toMatchObject({
      responseStatus: 200,
      rollout: { status: "applied", replayed: true },
    });
  });

  it("reads a job and strips checkpoint contents from the public projection", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rollout = makeRollout(
      jsonResponse(rolloutFixture({ status: "applied", replayed: null })),
      calls,
    );

    const result = await rollout.getRollout(APP_ID, JOB_ID);

    expect(result.jobId).toBe(JOB_ID);
    expect(result.status).toBe("applied");
    expect(result.replayed).toBeUndefined();
    expect(result.resumeOutcome).toBeUndefined();
    expect(result.targets[0]?.steps[0]?.checkpoint).toEqual({});
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("uses the source job and the same release/checksum for an explicit resume", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const resumed = rolloutFixture({
      job_id: JOB_ID,
      source_rollout_id: SOURCE_JOB_ID,
      status: "pending",
      replayed: false,
      resume_outcome: "accepted",
      resume_reason: "new_attempt",
    });
    const rollout = makeRollout(jsonResponse(resumed, 202), calls);

    const result = await rollout.resumeRollout({
      appId: APP_ID,
      sourceRolloutId: SOURCE_JOB_ID,
      releaseId: RELEASE_ID,
      manifestChecksum: CHECKSUM,
      idempotencyKey: REQUEST_KEY,
    });

    expect(result.rollout.sourceRolloutId).toBe(SOURCE_JOB_ID);
    expect(calls[0]?.url).toBe(
      `https://akb.example.test/api/v1/apps/${APP_ID}/rollouts/${SOURCE_JOB_ID}/resume`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      release_id: RELEASE_ID,
      manifest_checksum: CHECKSUM,
    });
  });

  it("preserves blocked as a failure state and rejects inconsistent acknowledgements", async () => {
    const blocked = makeRollout(
      jsonResponse(
        rolloutFixture({
          status: "blocked",
          blocked_reason: "target_failed",
        }),
        200,
      ),
      [],
    );
    await expect(blocked.getRollout(APP_ID, JOB_ID)).resolves.toMatchObject({
      status: "blocked",
      blockedReason: "target_failed",
    });

    const inconsistent = makeRollout(
      jsonResponse(rolloutFixture({ replayed: true }), 202),
      [],
    );
    const error = await inconsistent
      .requestRollout({
        appId: APP_ID,
        releaseId: RELEASE_ID,
        manifestChecksum: CHECKSUM,
        idempotencyKey: REQUEST_KEY,
      })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ControlPlaneError);
    expect(error.category).toBe("invalid_response");
  });

  it("does not expose an upstream error body", async () => {
    const rollout = makeRollout(
      jsonResponse(
        { message: SECRET, detail: { message: SECRET }, code: "blocked" },
        422,
      ),
      [],
    );

    const error = await rollout
      .getRollout(APP_ID, JOB_ID)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ControlPlaneError);
    expect(error.message).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });
});
