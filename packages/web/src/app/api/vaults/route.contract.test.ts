// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { GET } from "./route";
import { makeJwt } from "../__test-helpers__/jwt";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = makeJwt({
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
  sub: "reef-member",
});
const VAULTS = Array.from({ length: 20 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name: `reef-${String(index + 1).padStart(2, "0")}`,
  description: null,
  status: "active",
  role: "reader",
  created_at: null,
}));
const LIST_DELAY_MS = 25;
const ACTIVE_DELAY_MS = 60;

describe("GET /api/vaults active availability contract", () => {
  beforeEach(() => {
    vi.stubEnv("REEF_AUTH_MODE", "local");
    vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
    vi.stubEnv("REEF_APP_ID", APP_ID);
    vi.stubEnv("REEF_RELEASE_ID", "22222222-2222-4222-8222-222222222222");
    vi.stubEnv("REEF_RELEASE_VERSION", "0.1.0");
    vi.stubEnv("REEF_RELEASE_SOURCE_REVISION", "a".repeat(40));
    vi.stubEnv("REEF_RELEASE_IMAGE_DIGEST", `sha256:${"b".repeat(64)}`);
    vi.stubEnv("REEF_RELEASE_MANIFEST_CHECKSUM", "c".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses one member-active request per vault in parallel without loading details", async () => {
    const calls: Array<{ path: string; authorization: string | null }> = [];
    let activeInFlight = 0;
    let maxActiveInFlight = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({
          path: url.pathname,
          authorization: new Headers(init?.headers).get("authorization"),
        });

        if (url.pathname === "/api/v1/my/vaults") {
          await new Promise((resolve) => setTimeout(resolve, LIST_DELAY_MS));
          return Response.json({ vaults: VAULTS });
        }

        activeInFlight += 1;
        maxActiveInFlight = Math.max(maxActiveInFlight, activeInFlight);
        await new Promise((resolve) => setTimeout(resolve, ACTIVE_DELAY_MS));
        activeInFlight -= 1;
        return Response.json({ active: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://reef.test/api/vaults", {
        headers: { cookie: `${SESSION_COOKIE}=${SESSION}` },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      vaults: Array<{
        name: string;
        role: string;
        installation_active: boolean | null;
      }>;
    };
    expect(payload.vaults).toHaveLength(20);
    expect(payload.vaults.every((vault) => vault.installation_active)).toBe(
      true,
    );
    expect(payload.vaults.every((vault) => vault.role === "reader")).toBe(true);

    expect(calls).toHaveLength(21);
    expect(calls[0]?.path).toBe("/api/v1/my/vaults");
    expect(
      calls
        .slice(1)
        .every(({ path }) =>
          new RegExp(`/api/v1/apps/${APP_ID}/installations/[^/]+/active$`).test(
            path,
          ),
        ),
    ).toBe(true);
    expect(
      calls.every(({ authorization }) => authorization === `Bearer ${SESSION}`),
    ).toBe(true);
    expect(maxActiveInFlight).toBe(20);
  });
});
