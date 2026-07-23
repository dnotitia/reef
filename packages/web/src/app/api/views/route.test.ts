// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
  logger: { error: vi.fn() },
}));

const { mockCreateAdapter, mockGetActor, mockListViews, mockCreateView } =
  vi.hoisted(() => ({
    mockCreateAdapter: vi.fn(),
    mockGetActor: vi.fn(),
    mockListViews: vi.fn(),
    mockCreateView: vi.fn(),
  }));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    createAkbAdapter: mockCreateAdapter,
    akbGetCurrentActor: mockGetActor,
    akbListSavedIssueViews: mockListViews,
    akbCreateSavedIssueView: mockCreateView,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { ConflictError } from "@reef/core";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET, POST } from "./route";

const headers = {
  cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
  "Content-Type": "application/json",
};

describe("/api/views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    mockCreateAdapter.mockReturnValue({ request: vi.fn() });
    mockGetActor.mockResolvedValue({ actor: "alice" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("lists views for only the requested vault", async () => {
    mockListViews.mockResolvedValue([{ id: "view-1" }]);
    const response = await GET(
      new Request("http://localhost/api/views?vault=reef-acme", { headers }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ views: [{ id: "view-1" }] });
    expect(mockListViews).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme" }),
    );
  });

  it("derives owner from the authenticated AKB actor on create", async () => {
    mockCreateView.mockResolvedValue({
      view: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Todo",
      },
    });
    const response = await POST(
      new Request("http://localhost/api/views?vault=reef-acme", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Todo",
          payload: { version: 1, query: { status: ["todo"] } },
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mockCreateView).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-acme", owner: "alice" }),
    );
  });

  it("maps an AKB unique conflict to an editable duplicate-name 409", async () => {
    mockCreateView.mockRejectedValue(new ConflictError());
    const response = await POST(
      new Request("http://localhost/api/views?vault=reef-acme", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "TODO",
          payload: { version: 1, query: { status: ["todo"] } },
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A view with that name already exists.",
    });
  });

  it("rejects non-canonical payloads before the AKB write boundary", async () => {
    const response = await POST(
      new Request("http://localhost/api/views?vault=reef-acme", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Broken",
          payload: {
            version: 1,
            query: { status: ["removed-status"], unknown: ["value"] },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockCreateView).not.toHaveBeenCalled();
  });
});
