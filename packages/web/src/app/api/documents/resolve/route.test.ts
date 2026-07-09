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

const { mockResolveDocumentTitles, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockResolveDocumentTitles: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbResolveDocumentTitles: mockResolveDocumentTitles,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { POST } from "./route";

const URI = "akb://v/coll/research/doc/report.md";
const RESOLVED = { uri: URI, title: "Research Report", resource_type: "doc" };

function authedHeaders(): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${VALID_JWT}`,
    "content-type": "application/json",
  };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/documents/resolve", () => {
  it("resolves document titles through the core akb adapter", async () => {
    const adapter = { request: vi.fn() };
    mockCreateAkbAdapter.mockReturnValue(adapter);
    mockResolveDocumentTitles.mockResolvedValue([RESOLVED]);

    const res = await POST(
      new Request("http://localhost/api/documents/resolve?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ uris: [URI] }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documents: [RESOLVED] });
    expect(mockResolveDocumentTitles).toHaveBeenCalledWith({
      adapter,
      vault: "v",
      uris: [URI],
    });
  });

  it("400s without a vault param", async () => {
    const res = await POST(
      new Request("http://localhost/api/documents/resolve", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ uris: [URI] }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockResolveDocumentTitles).not.toHaveBeenCalled();
  });

  it("400s when a URI is not an akb document", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });

    const res = await POST(
      new Request("http://localhost/api/documents/resolve?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ uris: ["akb://v/table/pipeline"] }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockResolveDocumentTitles).not.toHaveBeenCalled();
  });
});
