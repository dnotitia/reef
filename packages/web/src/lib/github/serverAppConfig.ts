import { type GitHubAppConfig, GitHubAppConfigSchema } from "@reef/core";

/**
 * Deployment-managed GitHub App credential resolution.
 *
 * Mirrors `lib/llm/serverConfig.ts`: the credential is server state injected
 * from infra env (never a per-user PAT, never committed to the akb vault). When
 * configured, the server can mint a read-only installation token so
 * monitored-repo grounding does not depend on the browser PAT. When NOT
 * configured, callers fall back to the per-user PAT — the two provider paths run
 * in parallel during the migration to server-driven grounding (REEF-238 /
 * REEF-237).
 */

export interface ServerGitHubAppStatus {
  isConfigured: boolean;
  /** GitHub's App id, surfaced for status/diagnostics. Never the private key. */
  appId: string | null;
}

export class ServerGitHubAppConfigError extends Error {
  constructor(readonly issues: string[]) {
    super("server_github_app_config_invalid");
    this.name = "ServerGitHubAppConfigError";
  }
}

/**
 * Unescape a PEM private key supplied via env. Deployments commonly store the
 * multi-line PEM as a single line with literal `\n` escapes (Kubernetes
 * Secret/ConfigMap string values, `.env` files), so restore real newlines
 * before validation. An already-multiline value passes through unchanged.
 */
function normalizePrivateKey(raw: string | undefined): string {
  return (raw ?? "").replace(/\\n/g, "\n").trim();
}

export function resolveServerGitHubAppConfig(
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; config: GitHubAppConfig; status: ServerGitHubAppStatus }
  | { ok: false; status: ServerGitHubAppStatus; issues: string[] } {
  const raw = {
    app_id: env.REEF_GITHUB_APP_ID?.trim() ?? "",
    installation_id: env.REEF_GITHUB_APP_INSTALLATION_ID?.trim() ?? "",
    private_key: normalizePrivateKey(env.REEF_GITHUB_APP_PRIVATE_KEY),
  };

  const parsed = GitHubAppConfigSchema.safeParse(raw);
  const status: ServerGitHubAppStatus = {
    isConfigured: parsed.success,
    appId: raw.app_id || null,
  };

  if (!parsed.success) {
    return {
      ok: false,
      status: { ...status, isConfigured: false },
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  return {
    ok: true,
    config: parsed.data,
    status: { isConfigured: true, appId: parsed.data.app_id },
  };
}

export function getRequiredServerGitHubAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig {
  const resolved = resolveServerGitHubAppConfig(env);
  if (!resolved.ok) {
    throw new ServerGitHubAppConfigError(resolved.issues);
  }
  return resolved.config;
}

/**
 * Whether this deployment is configured to mint server-managed GitHub App
 * tokens. When false, callers fall back to the per-user browser PAT.
 */
export function isServerGitHubAppConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveServerGitHubAppConfig(env).status.isConfigured;
}
