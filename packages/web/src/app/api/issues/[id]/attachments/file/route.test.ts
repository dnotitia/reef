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

const { mockDownloadAttachmentByFileUri, mockCreateAdapter } = vi.hoisted(
  () => ({
    mockDownloadAttachmentByFileUri: vi.fn(),
    mockCreateAdapter: vi.fn(),
  }),
);

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbDownloadIssueAttachmentByFileUri: mockDownloadAttachmentByFileUri,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../../../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function params(id = "REEF-001") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockDownloadAttachmentByFileUri.mockResolvedValue({
    attachment: { filename: "screen.png" },
    body: new Uint8Array([1, 2, 3]).buffer,
    contentType: "image/png",
    filename: "screen.png",
    sizeBytes: 3,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/issues/[id]/attachments/file", () => {
  it("streams an issue-owned AKB file URI for inline rendering", async () => {
    const fileUri = "akb://reef-test/issues/file/file-1";
    const res = await GET(
      new Request(
        `http://localhost/api/issues/REEF-001/attachments/file?vault=v&uri=${encodeURIComponent(
          fileUri,
        )}`,
        { headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(res.headers.get("content-disposition")).toContain("inline;");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mockDownloadAttachmentByFileUri).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "v",
      reefId: "REEF-001",
      fileUri,
    });
  });

  it("415s non-image file types instead of serving them inline", async () => {
    mockDownloadAttachmentByFileUri.mockResolvedValue({
      attachment: { filename: "payload.html" },
      body: new TextEncoder().encode("<script>alert(1)</script>").buffer,
      contentType: "text/html",
      filename: "payload.html",
      sizeBytes: 25,
    });
    const fileUri = "akb://reef-test/issues/file/file-2";

    const res = await GET(
      new Request(
        `http://localhost/api/issues/REEF-001/attachments/file?vault=v&uri=${encodeURIComponent(
          fileUri,
        )}`,
        { headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(415);
  });

  it("downloads non-image file URI attachments when requested explicitly", async () => {
    mockDownloadAttachmentByFileUri.mockResolvedValue({
      attachment: { filename: "notes.txt" },
      body: new TextEncoder().encode("hello").buffer,
      contentType: "text/plain; charset=utf-8",
      filename: "notes.txt",
      sizeBytes: 5,
    });
    const fileUri = "akb://reef-test/issues/file/file-2";

    const res = await GET(
      new Request(
        `http://localhost/api/issues/REEF-001/attachments/file?vault=v&uri=${encodeURIComponent(
          fileUri,
        )}&download=1`,
        { headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("415s SVG images because they can carry active content", async () => {
    mockDownloadAttachmentByFileUri.mockResolvedValue({
      attachment: { filename: "payload.svg" },
      body: new TextEncoder().encode("<svg><script /></svg>").buffer,
      contentType: "image/svg+xml",
      filename: "payload.svg",
      sizeBytes: 21,
    });
    const fileUri = "akb://reef-test/issues/file/file-3";

    const res = await GET(
      new Request(
        `http://localhost/api/issues/REEF-001/attachments/file?vault=v&uri=${encodeURIComponent(
          fileUri,
        )}`,
        { headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(415);
  });

  it("400s without a file uri", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/issues/REEF-001/attachments/file?vault=v",
        {
          headers: authedHeaders(),
        },
      ),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockDownloadAttachmentByFileUri).not.toHaveBeenCalled();
  });
});
