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

const { mockDownloadResourceFile, mockCreateAdapter } = vi.hoisted(() => ({
  mockDownloadResourceFile: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbDownloadResourceFile: mockDownloadResourceFile,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { GET } from "./route";

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function requestFor(fileUri: string, queryVault = "reef-test"): Request {
  const query = new URLSearchParams({ vault: queryVault, uri: fileUri });
  return new Request(`http://localhost/api/files?${query}`, {
    headers: authedHeaders(),
  });
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockDownloadResourceFile.mockResolvedValue({
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

describe("GET /api/files", () => {
  it("streams an AKB file resource for inline rendering", async () => {
    const fileUri = "akb://reef-test/coll/incident/file/file-1";
    const response = await GET(requestFor(fileUri));

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mockDownloadResourceFile).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "reef-test",
      fileUri,
    });
  });

  it("requires an explicit download for non-image resources", async () => {
    mockDownloadResourceFile.mockResolvedValue({
      body: new TextEncoder().encode("hello").buffer,
      contentType: "text/plain; charset=utf-8",
      filename: "notes.txt",
      sizeBytes: 5,
    });
    const fileUri = "akb://reef-test/coll/incident/file/file-2";

    const inlineResponse = await GET(requestFor(fileUri));
    const downloadResponse = await GET(
      new Request(
        `http://localhost/api/files?${new URLSearchParams({
          vault: "reef-test",
          uri: fileUri,
          download: "1",
        })}`,
        { headers: authedHeaders() },
      ),
    );

    expect(inlineResponse.status).toBe(415);
    expect(downloadResponse.status).toBe(200);
    expect(await downloadResponse.text()).toBe("hello");
    expect(downloadResponse.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(downloadResponse.headers.get("content-disposition")).toContain(
      "attachment;",
    );
  });

  it("rejects malformed and cross-vault file URIs before AKB access", async () => {
    const invalid = await GET(requestFor("https://example.test/file"));
    const crossVault = await GET(
      requestFor("akb://other/coll/incident/file/file-1"),
    );

    expect(invalid.status).toBe(400);
    expect(crossVault.status).toBe(400);
    expect(mockDownloadResourceFile).not.toHaveBeenCalled();
  });
});
