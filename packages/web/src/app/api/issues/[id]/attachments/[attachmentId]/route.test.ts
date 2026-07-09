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

const { mockDownloadAttachment, mockCreateAdapter } = vi.hoisted(() => ({
  mockDownloadAttachment: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbDownloadIssueAttachment: mockDownloadAttachment,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../../../../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function params(id = "REEF-001", attachmentId = "att-1") {
  return { params: Promise.resolve({ id, attachmentId }) };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockDownloadAttachment.mockResolvedValue({
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

describe("GET /api/issues/[id]/attachments/[attachmentId]", () => {
  it("streams the attachment by id with download disposition", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/issues/REEF-001/attachments/att-1?vault=v",
        { headers: authedHeaders() },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mockDownloadAttachment).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "v",
      reefId: "REEF-001",
      attachmentId: "att-1",
    });
  });

  it("400s without a vault param", async () => {
    const res = await GET(
      new Request("http://localhost/api/issues/REEF-001/attachments/att-1", {
        headers: authedHeaders(),
      }),
      params(),
    );
    expect(res.status).toBe(400);
    expect(mockDownloadAttachment).not.toHaveBeenCalled();
  });
});
