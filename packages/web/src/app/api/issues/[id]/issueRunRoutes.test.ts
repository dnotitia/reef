// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/server/developmentProfiles", async () => {
  const core = await import("@reef/core");
  return {
    getDevelopmentProfileCatalog: () =>
      core.DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
  };
});

const { mockEligibility, mockRequestRun, mockCreateAkbAdapter } = vi.hoisted(
  () => ({
    mockEligibility: vi.fn(),
    mockRequestRun: vi.fn(),
    mockCreateAkbAdapter: vi.fn(),
  }),
);

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbGetIssueRunRequestEligibility: mockEligibility,
    akbRequestQueuedIssueRun: mockRequestRun,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./run-eligibility/route";
import { POST } from "./runs/route";

const context = (id = "REEF-382") => ({
  params: Promise.resolve({ id }),
});

function headers() {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/issues/REEF-382/runs", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
}

const validBody = {
  vault: "reef-acme",
  github_id: 123,
  request_id: "0d1ed0f5-3139-4af0-a26a-67ba58648b5d",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({
    request: vi.fn(async () => ({ username: "alice" })),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/issues/[id]/run-eligibility", () => {
  it("returns the core-owned safe eligibility snapshot", async () => {
    mockEligibility.mockResolvedValueOnce({
      eligible: true,
      reasons: [],
      target_options: [
        {
          github_id: 123,
          repo: "dnotitia/reef",
          recipe_path: ".agents/recipe.md",
          branch_template: "feat/{issue_id}-{run_id}",
          runner_profile: { id: "default", label: "Default runner" },
          permission_profile: {
            id: ":workspace",
            label: "Workspace access",
          },
        },
      ],
      default_target_github_id: 123,
      active_run: null,
    });
    const response = await GET(
      new Request(
        "http://localhost/api/issues/REEF-382/run-eligibility?vault=reef-acme",
        { headers: headers() },
      ),
      context(),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).default_target_github_id).toBe(123);
    expect(mockEligibility).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        id: "REEF-382",
        actor: "alice",
      }),
    );
  });

  it("validates id, vault, and session before core reads", async () => {
    expect(
      (
        await GET(
          new Request("http://localhost/api/issues/bad/run-eligibility"),
          context("bad"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request("http://localhost/api/issues/REEF-382/run-eligibility", {
            headers: headers(),
          }),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/issues/REEF-382/run-eligibility?vault=reef-acme",
          ),
          context(),
        )
      ).status,
    ).toBe(401);
  });
});

describe("POST /api/issues/[id]/runs", () => {
  it.each([
    ["created", 202, true],
    ["replayed", 200, false],
  ] as const)("returns %s as %i", async (kind, status, created) => {
    mockRequestRun.mockResolvedValueOnce({
      kind,
      run_id: "run-request",
      status: "queued",
      created,
    });
    const response = await POST(postRequest(validBody), context());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      run_id: "run-request",
      status: "queued",
      created,
    });
  });

  it("returns 403 for authorization rejections without creating a run", async () => {
    mockRequestRun.mockResolvedValueOnce({
      kind: "rejected",
      reason: "not_assignee",
    });
    const response = await POST(postRequest(validBody), context());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "not_assignee" });
  });

  it("returns the retained run id for an active-run conflict", async () => {
    mockRequestRun.mockResolvedValueOnce({
      kind: "conflict",
      run_id: "run-existing",
    });
    const response = await POST(postRequest(validBody), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "run_already_active",
      run_id: "run-existing",
    });
  });

  it("returns 422 for stale structural eligibility and validates the body", async () => {
    mockRequestRun.mockResolvedValueOnce({
      kind: "rejected",
      reason: "issue_status_not_todo",
    });
    expect((await POST(postRequest(validBody), context())).status).toBe(422);
    expect(
      (await POST(postRequest({ ...validBody, request_id: "bad" }), context()))
        .status,
    ).toBe(400);
  });
});
