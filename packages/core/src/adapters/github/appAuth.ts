import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { GitHubApiError } from "../../errors";
import type { GitHubAppConfig } from "../../schemas/workspace/config";
import { stripTrailingSlashes } from "../url";
import { getErrorStatus } from "./errors";

const tracer = trace.getTracer("@reef/core");

/**
 * Read-scoped permissions requested on every minted installation token.
 *
 * Defense in depth for the read-scoped contract (the GitHub adapter does
 * limited monitored-repo grounding — commits, pull requests, and file contents).
 * GitHub lets a token down-scope to a subset of the installation's grants, so
 * requesting these read levels yields a read-scoped token even if the deployment
 * App was granted write — the App's permission set is not the sole guardrail.
 * These are the baseline grants a grounding App should have; requesting a level
 * the installation lacks fails the mint (surfaced as a credential-free error).
 */
const READ_ONLY_GROUNDING_PERMISSIONS = {
  contents: "read",
  metadata: "read",
  pull_requests: "read",
} as const;

/**
 * Yields a short-lived GitHub token for the existing `createGitHubAdapter`.
 *
 * A provider, not a stored token: each call mints (or returns the still-valid
 * cached) installation token, so a per-request server adapter can read
 * monitored repos without a browser PAT.
 */
export type GitHubTokenProvider = () => Promise<string>;

export interface CreateGitHubAppInstallationTokenProviderParams {
  config: GitHubAppConfig;
  /**
   * Optional API base URL for hermetic tests and GitHub Enterprise.
   * Production callers omit this and use Octokit's default github.com endpoint.
   */
  baseUrl?: string;
}

/**
 * Build a token provider backed by a deployment-managed GitHub App credential.
 *
 * The App JWT is signed locally from `config.private_key`; the
 * installation-token exchange touches GitHub. `@octokit/auth-app` caches the
 * minted installation token until it nears expiry, so reusing the returned
 * provider within a request avoids re-minting.
 *
 * The minted token is down-scoped to read-scoped permissions
 * (`READ_ONLY_GROUNDING_PERMISSIONS`) so it is unable to write even if the deployment
 * App was granted broader access.
 *
 * Security (REEF-238 AC2): the private key, the App JWT, and the minted
 * installation token does not reach a log line, a span attribute, an LLM prompt,
 * or a client response. The span records the App/installation ids and the
 * token's expiry; failures are normalized to a credential-free `GitHubApiError`.
 */
export function createGitHubAppInstallationTokenProvider({
  config,
  baseUrl = process.env.REEF_GITHUB_API_BASE_URL,
}: CreateGitHubAppInstallationTokenProviderParams): GitHubTokenProvider {
  const normalizedBaseUrl = baseUrl ? stripTrailingSlashes(baseUrl) : undefined;
  const tokenRequest = normalizedBaseUrl
    ? new Octokit({ baseUrl: normalizedBaseUrl }).request
    : undefined;
  const auth = createAppAuth({
    appId: config.app_id,
    privateKey: config.private_key,
    installationId: config.installation_id,
    ...(tokenRequest ? { request: tokenRequest } : {}),
  });

  return () =>
    tracer.startActiveSpan("github.mint_installation_token", async (span) => {
      // Non-secret identifiers — not the private key, the App JWT, or
      // the minted installation token.
      span.setAttribute("github.app_id", config.app_id);
      span.setAttribute("github.installation_id", config.installation_id);
      try {
        const { token, expiresAt } = await auth({
          type: "installation",
          permissions: READ_ONLY_GROUNDING_PERMISSIONS,
        });
        span.setAttribute("github.token_expires_at", expiresAt);
        span.setStatus({ code: SpanStatusCode.OK });
        return token;
      } catch (err) {
        // Normalize before recording so neither the span nor the thrown error
        // can carry credential material from the upstream failure.
        const normalized = normalizeAppTokenError(err);
        span.recordException(normalized);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: normalized.message,
        });
        throw normalized;
      } finally {
        span.end();
      }
    });
}

/**
 * Map an installation-token failure to a credential-free `GitHubApiError`.
 *
 * The status is preserved (401/403/404/409 pass through to the same HTTP code
 * via `describeError`; anything else collapses to 502) so a PM sees consistent
 * copy, while the message stays fixed and secret-free — the upstream error's own
 * message is deliberately not echoed.
 */
function normalizeAppTokenError(err: unknown): GitHubApiError {
  return new GitHubApiError({
    status: getErrorStatus(err) ?? 502,
    message: "GitHub App installation token request failed",
  });
}
