import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const GITHUB_ENV_KEYS = [
  "REEF_GITHUB_APP_ID",
  "REEF_GITHUB_APP_INSTALLATION_ID",
  "REEF_GITHUB_APP_PRIVATE_KEY",
  "REEF_GITHUB_PAT",
] as const;

function clearGithubEnv() {
  for (const key of GITHUB_ENV_KEYS) delete process.env[key];
}

describe("GET /api/github/status", () => {
  beforeEach(clearGithubEnv);
  afterEach(clearGithubEnv);

  it("reports not configured (and no app id) when no server credential is set", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ isConfigured: false, appId: null });
  });

  it("reports configured with no app id when only the server PAT fallback is set (REEF-290)", async () => {
    process.env.REEF_GITHUB_PAT = "ghp_server_dev_pat";

    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // The picker gates on isConfigured; the server PAT should flip it so a
    // server PAT scoped deployment lists repos without a browser PAT. appId stays
    // App-specific (null here).
    expect(body).toEqual({ isConfigured: true, appId: null });
  });

  it("keeps the App id when both the App and the server PAT are set", async () => {
    process.env.REEF_GITHUB_APP_ID = "123456";
    process.env.REEF_GITHUB_APP_INSTALLATION_ID = "789";
    process.env.REEF_GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----";
    process.env.REEF_GITHUB_PAT = "ghp_server_dev_pat";

    const res = GET();
    const body = await res.json();
    expect(body).toEqual({ isConfigured: true, appId: "123456" });
  });

  it("never leaks the server PAT in the status payload", async () => {
    process.env.REEF_GITHUB_PAT = "ghp_super_secret_pat";

    const res = GET();
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain("ghp_super_secret_pat");
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
