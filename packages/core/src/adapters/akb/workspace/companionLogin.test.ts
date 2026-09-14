import { describe, expect, it, vi } from "vitest";
import { AkbApiError } from "../../../errors";
import { completeCompanionLogin } from "./companionLogin";
const body = {
  provider_alias: "entra",
  nonce: "N".repeat(43),
};
describe("companion login adapter", () => {
  it("keeps login credentials in headers and validates the user response", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ user: { id: "existing-user", username: "alice" } });
    expect(
      await completeCompanionLogin({
        adapter: { request },
        request: body,
        idToken: "id-token",
        assertion: "assertion",
      }),
    ).toEqual({ user: { id: "existing-user", username: "alice" } });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/auth/sso/companion/complete",
      {
        method: "POST",
        body,
        rawHeaders: {
          "X-AKB-ID-Token": "id-token",
          "X-AKB-Login-Assertion": "assertion",
        },
        resource: "session",
      },
    );
  });
  it("does not return malformed upstream profiles", async () => {
    await expect(
      completeCompanionLogin({
        adapter: {
          request: vi
            .fn()
            .mockResolvedValue({ user: { email: "a@example.com" } }),
        },
        request: body,
        idToken: "id",
        assertion: "proof",
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
  });
});
