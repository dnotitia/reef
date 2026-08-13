// @vitest-environment node

import { OidcProtocolError } from "@/server/auth/oidcClient";
import { SsoSessionError } from "@/server/auth/ssoSessionService";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backchannelLogout: vi.fn(),
  getRuntime: vi.fn(),
}));

vi.mock("@/server/auth/runtime", () => ({
  getSsoAuthRuntime: mocks.getRuntime,
}));

import { POST } from "./route";

const LOGOUT_TOKEN = "signed-logout-token-sensitive";

function request(
  body = `logout_token=${encodeURIComponent(LOGOUT_TOKEN)}`,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    "https://reef.example.com/api/auth/akb/sso/backchannel-logout",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body,
    },
  );
}

describe("POST /api/auth/akb/sso/backchannel-logout", () => {
  beforeEach(() => {
    mocks.backchannelLogout.mockResolvedValue(undefined);
    mocks.getRuntime.mockResolvedValue({
      sessions: { backchannelLogout: mocks.backchannelLogout },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 for a valid token even when no indexed session exists", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(mocks.backchannelLogout).toHaveBeenCalledWith(LOGOUT_TOKEN);
    expect(JSON.stringify([...response.headers])).not.toContain(LOGOUT_TOKEN);
  });

  it.each([
    [
      "invalid token",
      new OidcProtocolError("oidc_token_invalid", "invalid"),
      400,
    ],
    [
      "replayed token",
      new OidcProtocolError("oidc_logout_token_replayed", "invalid"),
      400,
    ],
    [
      "session store outage",
      new SsoSessionError("sso_session_store_unavailable", "transient"),
      503,
    ],
  ])("returns a bounded response for %s", async (_label, error, status) => {
    mocks.backchannelLogout.mockRejectedValue(error);

    const response = await POST(request());

    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");
    expect(JSON.stringify([...response.headers])).not.toContain(LOGOUT_TOKEN);
  });

  it("rejects malformed, duplicate, and oversized form bodies before verification", async () => {
    const responses = await Promise.all([
      POST(request("not_logout_token=value")),
      POST(request("logout_token=one&logout_token=two")),
      POST(
        request("logout_token=short", {
          "Content-Length": String(512 * 1024 + 1),
        }),
      ),
      POST(request("logout_token=value", { "Content-Type": "text/plain" })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      400, 400, 413, 400,
    ]);
    expect(mocks.backchannelLogout).not.toHaveBeenCalled();
  });
});
