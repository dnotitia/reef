// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveMarkdownTarget, mockCreateAkbAdapter } = vi.hoisted(() => ({
  mockResolveMarkdownTarget: vi.fn(),
  mockCreateAkbAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbResolveMarkdownTarget: mockResolveMarkdownTarget,
    createAkbAdapter: mockCreateAkbAdapter,
  };
});

import { jsonAuthedHeaders as authedHeaders } from "../../../__test-helpers__/jwt";
import { POST } from "./route";

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/markdown/targets/resolve", () => {
  it("returns the core access decision for one canonical target", async () => {
    const adapter = { request: vi.fn() };
    mockCreateAkbAdapter.mockReturnValue(adapter);
    const target = "akb://v/coll/research/doc/report.md";
    const result = { target, kind: "document", status: "available" };
    mockResolveMarkdownTarget.mockResolvedValue(result);

    const response = await POST(
      new Request("http://localhost/api/markdown/targets/resolve?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({ target }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mockResolveMarkdownTarget).toHaveBeenCalledWith({
      adapter,
      vault: "v",
      target,
    });
  });

  it("rejects unknown request fields before invoking the AKB resolver", async () => {
    const response = await POST(
      new Request("http://localhost/api/markdown/targets/resolve?vault=v", {
        method: "POST",
        headers: authedHeaders(),
        body: JSON.stringify({
          target: "akb://v/coll/research/doc/report.md",
          extra: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockResolveMarkdownTarget).not.toHaveBeenCalled();
  });
});
