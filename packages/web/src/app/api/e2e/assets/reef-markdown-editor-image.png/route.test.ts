// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const WEB_ASSET_PATH = "/api/e2e/assets/reef-markdown-editor-image.png";
const FIXTURE_ASSET_PATH = "/__e2e/assets/reef-markdown-editor-image.png";

const fixtureBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fetchMock = vi.fn<typeof fetch>();

describe("GET /api/e2e/assets/reef-markdown-editor-image.png", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("serves only the fixed fixture asset through the web origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REEF_E2E_MOCK_URL", "http://127.0.0.1:9136");
    fetchMock.mockResolvedValue(
      new Response(fixtureBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(`https://reef.test${WEB_ASSET_PATH}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixtureBytes);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(`http://127.0.0.1:9136${FIXTURE_ASSET_PATH}`),
      { cache: "no-store" },
    );
  });

  it("rejects arbitrary targets and path traversal before upstream access", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REEF_E2E_MOCK_URL", "http://127.0.0.1:9136");
    vi.stubGlobal("fetch", fetchMock);

    for (const path of [
      `${WEB_ASSET_PATH}?target=http://169.254.169.254/`,
      "/api/e2e/assets/reef-markdown-editor-image.png/../secret",
      "/api/e2e/assets/other.png",
    ]) {
      const response = await GET(new Request(`https://reef.test${path}`));
      expect(response.status).toBe(404);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays disabled outside dev and for non-loopback fixture origins", async () => {
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REEF_E2E_MOCK_URL", "http://127.0.0.1:9136");
    expect(
      (await GET(new Request(`https://reef.test${WEB_ASSET_PATH}`))).status,
    ).toBe(404);

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REEF_E2E_MOCK_URL", "https://fixture.example.test");
    expect(
      (await GET(new Request(`https://reef.test${WEB_ASSET_PATH}`))).status,
    ).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
