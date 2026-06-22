import { resolveServerGitHubAppConfig } from "@/lib/github/serverAppConfig";

/**
 * GET /api/github/status
 *
 * Deployment-status read for the server-managed GitHub App, mirroring
 * `/api/ai/status`. Returns whether this deployment can mint a read-only
 * installation token for monitored-repo grounding, plus the non-secret App id
 * for diagnostics. The private key, App JWT, and any minted token never leave
 * the server (REEF-238 AC2), so this surfaces only the boolean capability and
 * the App id — never the credential itself.
 *
 * The repo picker gates on this so a workspace whose deployment has a GitHub
 * App configured can list and save monitored repos without each browser user
 * supplying a personal access token (REEF-239 AC1/AC2).
 */
export function GET(): Response {
  return Response.json(resolveServerGitHubAppConfig().status);
}
