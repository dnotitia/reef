import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("retired provider-less SSO proxy", () => {
  it("does not expose the retired AKB login endpoint", async () => {
    const response = await GET(
      new Request("https://reef.test/api/auth/akb/sso/login"),
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "provider_login_retired",
    });
  });
});
