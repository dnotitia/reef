import { resolveServerGitHubAppConfig } from "@/lib/github/serverAppConfig";
import { isServerGitHubPatConfigured } from "@/lib/github/serverPat";

/**
 * GET /api/github/status
 *
 * Deployment-status read for the server-managed GitHub credential, mirroring
 * `/api/ai/status`. Returns whether this deployment can read GitHub without a
 * per-user browser PAT, plus the non-secret App id for diagnostics. The
 * private key, App JWT, server PAT, and minted tokens do not leave the server
 * (REEF-238 AC2), so this surfaces the boolean capability and the App id — not
 * the credential itself.
 *
 * `isConfigured` is true when EITHER a GitHub App (`REEF_GITHUB_APP_*`) or the
 * dev/CI server PAT fallback (`REEF_GITHUB_PAT`) is configured (REEF-290). The
 * repo picker gates on it so a deployment with any server-managed credential
 * can list and save monitored repos without each browser user supplying a PAT
 * (REEF-239 AC1/AC2). `appId` stays App-specific — it is null when only the
 * server PAT is set, since it is a diagnostic and not the gate.
 */
export function GET(): Response {
  const appStatus = resolveServerGitHubAppConfig().status;
  return Response.json({
    isConfigured: appStatus.isConfigured || isServerGitHubPatConfigured(),
    appId: appStatus.appId,
  });
}
