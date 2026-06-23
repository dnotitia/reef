// @vitest-environment node
import type { GitHubAppConfig } from "@reef/core";
import { vi } from "vitest";
import type { ServerGitHubAppStatus } from "./serverAppConfig";

export type ServerAppConfig =
  | {
      readonly ok: true;
      readonly config: GitHubAppConfig;
      readonly status: ServerGitHubAppStatus & {
        readonly isConfigured: true;
        readonly appId: string;
      };
    }
  | {
      readonly ok: false;
      readonly status: ServerGitHubAppStatus & {
        readonly isConfigured: false;
        readonly appId: string | null;
      };
      readonly issues: readonly string[];
    };

export const NOT_CONFIGURED: ServerAppConfig = {
  ok: false,
  status: { isConfigured: false, appId: null },
  issues: ["app_id is required"],
};

export const APP_CONFIG = {
  ok: true,
  config: {
    app_id: "123456",
    installation_id: "789",
    private_key:
      "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----",
  },
  status: { isConfigured: true, appId: "123456" },
} satisfies ServerAppConfig;

const serverCredentialState = vi.hoisted<{
  currentAppConfig: ServerAppConfig;
  currentServerPat: string | null;
}>(() => ({
  currentAppConfig: {
    ok: false,
    status: { isConfigured: false, appId: null },
    issues: ["app_id is required"],
  },
  currentServerPat: null,
}));

vi.mock("@/lib/github/serverAppConfig", () => ({
  resolveServerGitHubAppConfig: () => serverCredentialState.currentAppConfig,
}));

vi.mock("@/lib/github/serverPat", () => ({
  resolveServerGitHubPat: () => serverCredentialState.currentServerPat,
}));

export function setServerAppConfig(config: ServerAppConfig): void {
  serverCredentialState.currentAppConfig = config;
}

export function setServerGitHubPat(token: string | null): void {
  serverCredentialState.currentServerPat = token;
}

export function resetServerGitHubCredentials(): void {
  serverCredentialState.currentAppConfig = NOT_CONFIGURED;
  serverCredentialState.currentServerPat = null;
}
