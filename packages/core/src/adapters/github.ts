import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import {
  type ListRecentActivityParams,
  type ListRecentActivityResult,
  listRecentActivity,
} from "./github/activity.js";
import {
  type ListAuthenticatedRepositoriesParams,
  type ListAuthenticatedRepositoriesResult,
  listAuthenticatedRepositories,
} from "./github/authenticatedRepos.js";
import {
  type ListInstallationRepositoriesParams,
  type ListInstallationRepositoriesResult,
  listInstallationRepositories,
} from "./github/installationRepos.js";
import {
  type GitHubCodeSearchResult,
  type GitHubFileContent,
  type ListRepoLabelsParams,
  type ReadGitHubFileParams,
  type RepoLabel,
  type SearchGitHubCodeParams,
  listRepoLabels,
  readFile,
  searchCode,
} from "./github/repoReads.js";
import { stripTrailingSlashes } from "./url.js";

export type {
  GitHubAuthenticatedRepository,
  ListAuthenticatedRepositoriesParams,
  ListAuthenticatedRepositoriesResult,
} from "./github/authenticatedRepos.js";
export type {
  ListInstallationRepositoriesParams,
  ListInstallationRepositoriesResult,
} from "./github/installationRepos.js";
export type {
  GitHubCommitNode,
  GitHubPullRequestNode,
  ListRecentActivityParams,
  ListRecentActivityResult,
} from "./github/activity.js";
export type {
  GitHubCodeSearchResult,
  GitHubFileContent,
  ListRepoLabelsParams,
  ReadGitHubFileParams,
  RepoLabel,
  SearchGitHubCodeParams,
} from "./github/repoReads.js";

export interface GitHubAdapter {
  listAuthenticatedRepositories: (
    params?: ListAuthenticatedRepositoriesParams,
  ) => Promise<ListAuthenticatedRepositoriesResult>;
  listInstallationRepositories: (
    params?: ListInstallationRepositoriesParams,
  ) => Promise<ListInstallationRepositoriesResult>;
  listRecentActivity: (
    params: ListRecentActivityParams,
  ) => Promise<ListRecentActivityResult>;
  searchCode: (
    params: SearchGitHubCodeParams,
  ) => Promise<GitHubCodeSearchResult[]>;
  readFile: (params: ReadGitHubFileParams) => Promise<GitHubFileContent>;
  listRepoLabels: (params: ListRepoLabelsParams) => Promise<RepoLabel[]>;
}

export interface CreateGitHubAdapterParams {
  token: string;
  /**
   * Optional API base URL for hermetic tests. Production callers omit this and
   * use Octokit's default github.com endpoints.
   */
  baseUrl?: string;
}

export function createGitHubAdapter({
  token,
  baseUrl = process.env.REEF_GITHUB_API_BASE_URL,
}: CreateGitHubAdapterParams): GitHubAdapter {
  const normalizedBaseUrl = baseUrl ? stripTrailingSlashes(baseUrl) : undefined;
  const rest = new Octokit({
    auth: token,
    ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
  });
  const graphqlClient = graphql.defaults({
    ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
    headers: {
      authorization: `token ${token}`,
    },
  });
  return {
    listAuthenticatedRepositories: (params) =>
      listAuthenticatedRepositories({ rest, ...params }),
    listInstallationRepositories: (params) =>
      listInstallationRepositories({ rest, ...params }),
    listRecentActivity: (params) =>
      listRecentActivity({ graphqlClient, ...params }),
    searchCode: (params) => searchCode({ rest, ...params }),
    readFile: (params) => readFile({ rest, ...params }),
    listRepoLabels: (params) => listRepoLabels({ rest, ...params }),
  };
}

export interface ListLabelsForRepoParams {
  adapter: GitHubAdapter;
  owner: string;
  repo: string;
}

/**
 * Lists labels defined on a repository.
 *
 * Retained as the stable helper used by enrichment while the adapter owns the
 * underlying GitHub read and error normalization.
 */
export async function listLabelsForRepo({
  adapter,
  owner,
  repo,
}: ListLabelsForRepoParams): Promise<RepoLabel[]> {
  return adapter.listRepoLabels({ owner, repo });
}
