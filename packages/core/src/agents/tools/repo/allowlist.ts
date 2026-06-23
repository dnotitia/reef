import { SchemaValidationError } from "../../../errors";

/** A monitored-repo reference the unbound repo tools are allowed to read. */
export interface RepoRef {
  owner: string;
  repo: string;
}

function matches(ref: RepoRef, owner: string, repo: string): boolean {
  return (
    ref.owner.toLowerCase() === owner.toLowerCase() &&
    ref.repo.toLowerCase() === repo.toLowerCase()
  );
}

/**
 * Guard the unbound `search_code` / `dev_read_file` tools to the workspace's
 * monitored repositories.
 *
 * The unbound tools take `owner`/`repo` as LLM-supplied inputs. When the GitHub
 * adapter is backed by a deployment GitHub App installation token, that token
 * can read every repository the App is installed on — far beyond the active
 * vault's `monitored_repos`. Without this guard a prompt-injected or
 * user-directed tool call could read code from another App-installed repo that
 * this workspace does not monitor (REEF-243). Enforcing the allowlist mirrors
 * the monitored-repo verification enrichment already applies to its bound
 * `repoContext`.
 *
 * Throws a `SchemaValidationError` (surfaced back to the agent loop, never to
 * the user) when the requested repo is not monitored, so the model can retry
 * against an in-scope repo instead of silently reading out-of-bounds code.
 */
export function assertRepoAllowed(
  allowedRepos: RepoRef[],
  owner: string,
  repo: string,
): void {
  if (allowedRepos.some((ref) => matches(ref, owner, repo))) {
    return;
  }
  throw new SchemaValidationError({
    field: "repo",
    issues: [
      "This tool may only read a repository configured in the workspace's monitored repositories.",
    ],
  });
}
