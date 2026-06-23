import { useGithubAppAvailable } from "@/features/settings/hooks/useGithubAppAvailable";
import { apiFetch, throwHttpError } from "@/lib/apiClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Wire shape for one row of the `/api/repos` response. `id` is GitHub's stable
 * numeric repo id — what reef stores as `github_id` in the `monitored_repos`
 * table so that rename/transfer doesn't orphan a row.
 */
export interface RepoListItem {
  full_name: string;
  id: number;
}

/**
 * TanStack Query hook to list the authenticated user's GitHub repositories.
 *
 * Query key: ['repos', 'installation', 'list'] — versioned to the
 *   deployment-managed GitHub App source so older browser-PAT snapshots under
 *   ['repos', 'list'] does not be rehydrated after REEF-244.
 *
 * staleTime: 5 minutes. The user's repo set rarely changes within a session,
 *   so this trades freshness for instant revisit. Use queryClient.invalidate
 *   to force a refetch after the user creates / forks / deletes a repo
 *   elsewhere.
 *
 * ETag awareness: the route handler at /api/repos forwards If-None-Match to
 * GitHub and returns 304 when the listing is unchanged. On 304 we keep the
 * previously-cached data (via queryClient.getQueryData) so the queryFn does
 * not throw and TanStack Query continues to report success.
 *
 * GitHub credentials are deployment-managed. The browser does not provides a
 * GitHub token.
 */
const REPOS_KEY = ["repos", "installation", "list"] as const;
// v2: response shape changed from string[] to {full_name, id}[] when github_id
// was added to monitored_repos. Bump the storage key so older clients drop
// their string cache instead of trying to interpret it as objects.
// v3 (REEF-244): credential source changed from browser PAT to the deployment
// GitHub App installation, so old PAT-scoped ETags should not gate the first
// post-upgrade repo-list fetch.
const REPOS_ETAG_STORAGE_KEY = "reef:etag:repos:installation:list:v3";

function readStoredEtag(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REPOS_ETAG_STORAGE_KEY);
  } catch {
    // Private mode / quota / disabled → behave as if no ETag is stored.
    return null;
  }
}

function writeStoredEtag(etag: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (etag) window.localStorage.setItem(REPOS_ETAG_STORAGE_KEY, etag);
    else window.localStorage.removeItem(REPOS_ETAG_STORAGE_KEY);
  } catch {
    // Storage write failed — non-fatal, just lose the optimization.
  }
}

export function useRepos() {
  const queryClient = useQueryClient();
  const { isAvailable: appAvailable } = useGithubAppAvailable();

  return useQuery({
    queryKey: REPOS_KEY,
    enabled: appAvailable,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RepoListItem[]> => {
      const etag = readStoredEtag();

      const fetchFresh = async (): Promise<RepoListItem[]> => {
        // Unconditional fetch — used both for the cold path and as the
        // recovery path when a 304 arrives without any cached body to
        // serve (see below).
        const res = await apiFetch("/api/repos");
        if (!res.ok) {
          await throwHttpError(res, `Failed to fetch repos: ${res.status}`);
        }
        writeStoredEtag(res.headers.get("ETag"));
        const body = (await res.json()) as { repos: RepoListItem[] };
        return body.repos;
      };

      if (!etag) return fetchFresh();

      const headers = new Headers({ "If-None-Match": etag });
      const res = await apiFetch("/api/repos", { headers });

      if (res.status === 304) {
        const cached = queryClient.getQueryData<RepoListItem[]>(REPOS_KEY);
        if (cached) return cached;
        // 304 with no cached body — the persisted snapshot was evicted
        // (maxAge / buster / manual clear) but the ETag key survived.
        // Returning [] here would pin the picker to "no repos" for the
        // whole staleTime window. Drop the stale ETag and re-request
        // unconditionally to recover.
        writeStoredEtag(null);
        return fetchFresh();
      }

      if (!res.ok) {
        await throwHttpError(res, `Failed to fetch repos: ${res.status}`);
      }

      writeStoredEtag(res.headers.get("ETag"));
      const body = (await res.json()) as { repos: RepoListItem[] };
      return body.repos;
    },
  });
}
