import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const APP_ENV_KEYS = [
  "REEF_GITHUB_APP_ID",
  "REEF_GITHUB_APP_INSTALLATION_ID",
  "REEF_GITHUB_APP_PRIVATE_KEY",
] as const;

function clearAppEnv() {
  for (const key of APP_ENV_KEYS) delete process.env[key];
}

describe("GET /api/github/status", () => {
  beforeEach(clearAppEnv);
  afterEach(clearAppEnv);

  it("reports not configured (and no app id) when the App env is absent", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ isConfigured: false, appId: null });
  });

  it("reports configured with the non-secret app id when the App env is complete", async () => {
    process.env.REEF_GITHUB_APP_ID = "123456";
    process.env.REEF_GITHUB_APP_INSTALLATION_ID = "789";
    process.env.REEF_GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----";

    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ isConfigured: true, appId: "123456" });
  });

  it("never leaks the private key in the status payload", async () => {
    process.env.REEF_GITHUB_APP_ID = "123456";
    process.env.REEF_GITHUB_APP_INSTALLATION_ID = "789";
    process.env.REEF_GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\nsuper-secret-key\n-----END RSA PRIVATE KEY-----";

    const res = GET();
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("PRIVATE KEY");
  });
});
