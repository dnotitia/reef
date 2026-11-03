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
  managed_by: null,
  created_at: null,
}));
const LIST_DELAY_MS = 25;

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

  it.each([20, 50])(
    "uses one member-active list request for %i vaults",
    async (count) => {
      const calls: Array<{ path: string; authorization: string | null }> = [];
      const vaults = Array.from({ length: count }, (_, index) => ({
        ...VAULTS[index % VAULTS.length],
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name: `reef-${String(index + 1).padStart(2, "0")}`,
      }));
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          calls.push({
            path: url.pathname,
            authorization: new Headers(init?.headers).get("authorization"),
          });

          if (
            url.pathname ===
            `/api/v1/apps/${APP_ID}/installations/active/vaults`
          ) {
            await new Promise((resolve) => setTimeout(resolve, LIST_DELAY_MS));
            return Response.json({ vaults });
          }

          if (url.pathname === "/api/v1/auth/me")
            return Response.json({ username: "alice", is_admin: false });

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
      expect(payload.vaults).toHaveLength(count);
      expect(payload.vaults.every((vault) => vault.installation_active)).toBe(
        true,
      );
      expect(payload.vaults.every((vault) => vault.role === "reader")).toBe(
        true,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.path).toBe(
        `/api/v1/apps/${APP_ID}/installations/active/vaults`,
      );
      expect(
        calls.every(
          ({ authorization }) => authorization === `Bearer ${SESSION}`,
        ),
      ).toBe(true);
    },
  );
});
