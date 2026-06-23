/**
 * Deployment-managed GitHub PAT resolution — the dev/CI fallback credential.
 *
 * Mirrors `serverAppConfig.ts`: the token is server state injected from infra
 * env (not a per-user browser PAT, not committed to the akb vault). It exists
 * for local development and CI, where a full GitHub App is not configured but a
 * real read scoped GitHub I/O path is still needed for grounding, the activity
 * scan, and the monitored-repo picker (REEF-290).
 *
 * Credential precedence is App → server PAT: the App is the production path,
 * and the server PAT is an interim/dev tier that is **disabled unless
 * `REEF_GITHUB_PAT` is set**. Because it is unset by default, this tier does not
 * silently becomes a deployment's production credential (REEF-290 AC3).
 *
 * Use a fine-grained, read scoped PAT scoped like the App installation
 * (`contents:read`, `metadata:read`, `pull_requests:read`). Like the App
 * private key it is a deployment secret: does not log it, place it on a span, or
 * put it in an LLM prompt/response.
 */
export function resolveServerGitHubPat(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const token = env.REEF_GITHUB_PAT?.trim();
  return token ? token : null;
}

/**
 * Whether this deployment carries a server-managed GitHub PAT fallback. When
 * true, callers can read GitHub without a browser PAT even though no GitHub App
 * is configured — the dev/CI stand-in for the App path.
 */
export function isServerGitHubPatConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveServerGitHubPat(env) !== null;
}
