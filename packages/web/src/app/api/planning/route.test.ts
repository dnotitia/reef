// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const {
  mockAkbCreateSprint,
  mockAkbDeleteSprint,
  mockAkbListPlanningCatalog,
  mockAkbUpdateSprint,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockAkbCreateSprint: vi.fn(),
  mockAkbDeleteSprint: vi.fn(),
  mockAkbListPlanningCatalog: vi.fn(),
  mockAkbUpdateSprint: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbCreateSprint: mockAkbCreateSprint,
    akbDeleteSprint: mockAkbDeleteSprint,
    akbListPlanningCatalog: mockAkbListPlanningCatalog,
    akbUpdateSprint: mockAkbUpdateSprint,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError, ConflictError, SchemaValidationError } from "@reef/core";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET } from "./route";
import {
  DELETE as DELETE_SPRINT,
  PUT as PUT_SPRINT,
} from "./sprints/[id]/route";
import { POST as POST_SPRINT } from "./sprints/route";

const SPRINT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sprint 12",
  status: "planned" as const,
  start_date: "2026-05-01",
  end_date: "2026-05-14",
  goal: "Stabilize onboarding",
  capacity_points: 40,
};

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

const params = (id: string) =>
  ({ params: Promise.resolve({ id }) }) as { params: Promise<{ id: string }> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/planning", () => {
  it("returns 400 when vault param is missing", async () => {
    const req = new Request("http://localhost/api/planning", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns the planning catalog on happy path", async () => {
    const catalog = {
      sprints: [SPRINT],
      milestones: [],
      releases: [],
    };
    mockAkbListPlanningCatalog.mockResolvedValueOnce(catalog);
    const req = new Request("http://localhost/api/planning?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(catalog);
    expect(mockAkbListPlanningCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme" }),
    );
  });

  it("translates AuthError to 401", async () => {
    mockAkbListPlanningCatalog.mockRejectedValueOnce(new AuthError({}));
    const req = new Request("http://localhost/api/planning?vault=reef-acme", {
      headers: authedHeaders(),
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/planning/sprints", () => {
  it("rejects client-provided ids on create", async () => {
    const req = new Request("http://localhost/api/planning/sprints", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify({ vault: "reef-acme", item: SPRINT }),
    });
    const res = await POST_SPRINT(req);
    expect(res.status).toBe(400);
    expect(mockAkbCreateSprint).not.toHaveBeenCalled();
  });

  it("creates a sprint and returns 201", async () => {
    mockAkbCreateSprint.mockResolvedValueOnce(SPRINT);
    const req = new Request("http://localhost/api/planning/sprints", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify({
        vault: "reef-acme",
        item: {
          name: "Sprint 12",
          status: "planned",
          start_date: "2026-05-01",
          end_date: "2026-05-14",
          goal: "Stabilize onboarding",
          capacity_points: 40,
        },
      }),
    });
    const res = await POST_SPRINT(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ item: SPRINT });
    expect(mockAkbCreateSprint).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-acme",
        item: expect.not.objectContaining({ id: expect.any(String) }),
      }),
    );
  });
});

describe("PUT /api/planning/sprints/[id]", () => {
  it("returns 400 for malformed ids", async () => {
    const req = new Request("http://localhost/api/planning/sprints/bad-id", {
      method: "PUT",
      headers: authedHeaders(),
      body: JSON.stringify({ vault: "reef-acme", item: SPRINT }),
    });
    const res = await PUT_SPRINT(req, params("bad-id"));
    expect(res.status).toBe(400);
  });

  it("translates body/id mismatch validation to 422", async () => {
    mockAkbUpdateSprint.mockRejectedValueOnce(
      new SchemaValidationError({
        issues: ["sprint id in body must match URL id"],
      }),
    );
    const req = new Request(
      `http://localhost/api/planning/sprints/${SPRINT.id}`,
      {
        method: "PUT",
        headers: authedHeaders(),
        body: JSON.stringify({
          vault: "reef-acme",
          item: {
            ...SPRINT,
            id: "22222222-2222-4222-8222-222222222222",
          },
        }),
      },
    );
    const res = await PUT_SPRINT(req, params(SPRINT.id));
    expect(res.status).toBe(422);
  });

  it("updates a sprint and returns the item", async () => {
    mockAkbUpdateSprint.mockResolvedValueOnce({
      ...SPRINT,
      status: "active",
    });
    const req = new Request(
      `http://localhost/api/planning/sprints/${SPRINT.id}`,
      {
        method: "PUT",
        headers: authedHeaders(),
        body: JSON.stringify({
          vault: "reef-acme",
          item: { ...SPRINT, status: "active" },
        }),
      },
    );
    const res = await PUT_SPRINT(req, params(SPRINT.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      item: { ...SPRINT, status: "active" },
    });
  });
});

describe("DELETE /api/planning/sprints/[id]", () => {
  it("returns 400 when vault param is missing", async () => {
    const req = new Request(
      `http://localhost/api/planning/sprints/${SPRINT.id}`,
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE_SPRINT(req, params(SPRINT.id));
    expect(res.status).toBe(400);
  });

  it("deletes a sprint and returns 204", async () => {
    mockAkbDeleteSprint.mockResolvedValueOnce(undefined);
    const req = new Request(
      `http://localhost/api/planning/sprints/${SPRINT.id}?vault=reef-acme`,
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE_SPRINT(req, params(SPRINT.id));
    expect(res.status).toBe(204);
  });

  it("returns 409 when an issue still references the sprint", async () => {
    mockAkbDeleteSprint.mockRejectedValueOnce(new ConflictError({}));
    const req = new Request(
      `http://localhost/api/planning/sprints/${SPRINT.id}?vault=reef-acme`,
      { method: "DELETE", headers: authedHeaders() },
    );
    const res = await DELETE_SPRINT(req, params(SPRINT.id));
    expect(res.status).toBe(409);
  });
});
