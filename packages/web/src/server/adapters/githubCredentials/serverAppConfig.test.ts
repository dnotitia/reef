// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ServerGitHubAppConfigError,
  getRequiredServerGitHubAppConfig,
  isServerGitHubAppConfigured,
  resolveServerGitHubAppConfig,
} from "./serverAppConfig";

describe("server GitHub App config", () => {
  const completeEnv = {
    NODE_ENV: "test",
    REEF_GITHUB_APP_ID: "123456",
    REEF_GITHUB_APP_INSTALLATION_ID: "789",
    REEF_GITHUB_APP_PRIVATE_KEY:
      "-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----",
  } satisfies NodeJS.ProcessEnv;

  it("resolves complete env into a config and public status", () => {
    const result = resolveServerGitHubAppConfig(completeEnv);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.config).toEqual({
      app_id: "123456",
      installation_id: "789",
      // literal \n escapes are restored to real newlines.
      private_key:
        "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    });
    expect(result.status).toEqual({ isConfigured: true, appId: "123456" });
  });

  it("reports unconfigured when no GitHub App env is set", () => {
    const result = resolveServerGitHubAppConfig({ NODE_ENV: "test" });

    expect(result.ok).toBe(false);
    expect(result.status).toEqual({ isConfigured: false, appId: null });
    expect(isServerGitHubAppConfigured({ NODE_ENV: "test" })).toBe(false);
  });

  it("treats a partially-configured deployment as unconfigured", () => {
    const result = resolveServerGitHubAppConfig({
      ...completeEnv,
      REEF_GITHUB_APP_PRIVATE_KEY: "",
    });

    expect(result.ok).toBe(false);
    expect(result.status.isConfigured).toBe(false);
  });

  it("reports configured for complete env", () => {
    expect(isServerGitHubAppConfigured(completeEnv)).toBe(true);
  });

  it("throws ServerGitHubAppConfigError when required config is missing", () => {
    expect(() =>
      getRequiredServerGitHubAppConfig({
        ...completeEnv,
        REEF_GITHUB_APP_INSTALLATION_ID: "",
      }),
    ).toThrow(ServerGitHubAppConfigError);
  });
});
