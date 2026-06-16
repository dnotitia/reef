// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telemetry", () => ({
  tracer: {
    startActiveSpan: vi.fn(
      async (
        _name: string,
        fn: (span: {
          setAttribute: () => void;
          recordException: () => void;
          setStatus: () => void;
          end: () => void;
        }) => Promise<unknown>,
      ) =>
        fn({
          setAttribute: () => {},
          recordException: () => {},
          setStatus: () => {},
          end: () => {},
        }),
    ),
  },
}));

const {
  mockListReferences,
  mockAddReference,
  mockRemoveReference,
  mockCreateAkbAdapter,
} = vi.hoisted(() => ({
  mockListReferences: vi.fn(),
  mockAddReference: vi.fn(),
  mockRemoveReference: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbListIssueReferences: mockListReferences,
    akbAddIssueReference: mockAddReference,
    akbRemoveIssueReference: mockRemoveReference,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../../__test-helpers__/jwt";
import { DELETE, GET, POST } from "./route";

const REF = {
  uri: "akb://v/coll/overview/doc/spec.md",
  title: "Spec",
  resource_type: "doc",
};

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

function params(id = "REEF-001") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/[id]/references", () => {
  it("returns the issue's references", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockListReferences.mockResolvedValue([REF]);

    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/references?vault=v", {
        headers: authedHeaders(),
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ references: [REF] });
    expect(mockListReferences).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
    );
  });

  it("400s without a vault param", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/references", {
        headers: authedHeaders(),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockListReferences).not.toHaveBeenCalled();
  });

  it("400s on a malformed issue id", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/not-an-id/references?vault=v", {
        headers: authedHeaders(),
      }),
      params("not an id"),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/issues/[id]/references", () => {
  it("adds a reference and returns the refreshed list", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockAddReference.mockResolvedValue(undefined);
    mockListReferences.mockResolvedValue([REF]);

    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/references?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ target_uri: REF.uri }),
      }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(mockAddReference).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
      REF.uri,
    );
    expect(await res.json()).toEqual({ references: [REF] });
  });

  it("400s when the target is not an akb:// URI", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });

    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/references?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ target_uri: "https://example.com" }),
      }),
      params(),
    );

    expect(res.status).toBe(400);
    expect(mockAddReference).not.toHaveBeenCalled();
  });

  it("400s a target document in a different vault", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });

    const res = await POST(
      new Request("http://localhost/api/issues/REEF-001/references?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ target_uri: "akb://other/coll/x/doc/y.md" }),
      }),
      params(),
    );

    expect(res.status).toBe(400);
    expect(mockAddReference).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/issues/[id]/references", () => {
  it("removes the reference identified by target_uri and returns the rest", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockRemoveReference.mockResolvedValue(undefined);
    mockListReferences.mockResolvedValue([]);

    const res = await DELETE(
      new Request(
        `http://localhost/api/issues/REEF-001/references?vault=v&target_uri=${encodeURIComponent(REF.uri)}`,
        { method: "DELETE", headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    expect(mockRemoveReference).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "REEF-001",
      REF.uri,
    );
    expect(await res.json()).toEqual({ references: [] });
  });

  it("400s when target_uri is missing", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/issues/REEF-001/references?vault=v", {
        method: "DELETE",
        headers: authedHeaders(),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockRemoveReference).not.toHaveBeenCalled();
  });
});
