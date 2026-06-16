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

const { mockSearchDocuments, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockSearchDocuments: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbSearchDocuments: mockSearchDocuments,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/documents/search", () => {
  it("projects akb search hits onto the document picker shape", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockSearchDocuments.mockResolvedValue([
      {
        uri: "akb://v/coll/overview/doc/spec.md",
        title: "Server Spec",
        collection: "overview",
        doc_type: "spec",
        summary: "A spec",
        matched_section: "## Goal",
        score: 0.5,
        source_type: "document",
        tags: [],
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/documents/search?vault=v&q=spec", {
        headers: authedHeaders(),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      documents: [
        {
          uri: "akb://v/coll/overview/doc/spec.md",
          title: "Server Spec",
          collection: "overview",
          doc_type: "spec",
          summary: "A spec",
          matched_section: "## Goal",
        },
      ],
    });
    expect(mockSearchDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "v", query: "spec" }),
    );
  });

  it("short-circuits an empty query without calling akb", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });

    const res = await GET(
      new Request("http://localhost/api/documents/search?vault=v&q=%20", {
        headers: authedHeaders(),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documents: [] });
    expect(mockSearchDocuments).not.toHaveBeenCalled();
  });

  it("400s without a vault param", async () => {
    const res = await GET(
      new Request("http://localhost/api/documents/search?q=spec", {
        headers: authedHeaders(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("filters out non-document hits (tables/files)", async () => {
    mockCreateAkbAdapter.mockReturnValue({ request: vi.fn() });
    mockSearchDocuments.mockResolvedValue([
      {
        uri: "akb://v/coll/x/doc/spec.md",
        title: "Doc",
        source_type: "document",
        tags: [],
      },
      {
        uri: "akb://v/table/pipeline",
        title: "Pipeline",
        source_type: "table",
        tags: [],
      },
      { uri: "akb://v/file/abc", title: "File", source_type: "file", tags: [] },
    ]);

    const res = await GET(
      new Request("http://localhost/api/documents/search?vault=v&q=spec", {
        headers: authedHeaders(),
      }),
    );

    const body = (await res.json()) as { documents: Array<{ uri: string }> };
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].uri).toBe("akb://v/coll/x/doc/spec.md");
  });
});
