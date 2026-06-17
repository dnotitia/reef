import { SpanStatusCode, trace } from "@opentelemetry/api";
import { normalizeRepositoryReadError } from "./errors";

const tracer = trace.getTracer("@reef/core");

type GraphqlClient = <T>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

const RECENT_COMMITS_QUERY = `
  query RecentCommits($owner: String!, $repo: String!, $since: GitTimestamp) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(since: $since, first: 50) {
              nodes {
                oid
                message
                authoredDate
                committedDate
                author {
                  name
                  user { login }
                }
                changedFilesIfAvailable
                associatedPullRequests(first: 1) {
                  nodes { number }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const RECENT_PRS_QUERY = `
  query RecentPullRequests($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      pullRequests(states: [MERGED, OPEN], orderBy: { field: UPDATED_AT, direction: DESC }, first: 20) {
        nodes {
          number
          title
          body
          headRefName
          author { login }
          updatedAt
          createdAt
          mergedAt
          commits(last: 10) {
            nodes { commit { message } }
          }
        }
      }
    }
  }
`;

export interface GitHubCommitNode {
  oid: string;
  message: string;
  authoredDate: string;
  committedDate: string;
  author: { name: string; user: { login: string } | null } | null;
  changedFilesIfAvailable: number | null;
  associatedPullRequests: { nodes: Array<{ number: number }> };
}

interface RecentCommitsResult {
  repository: {
    defaultBranchRef: {
      target: {
        history: {
          nodes: GitHubCommitNode[];
        };
      };
    } | null;
  };
}

export interface GitHubPullRequestNode {
  number: number;
  title: string;
  body: string | null;
  headRefName: string;
  author: { login: string } | null;
  updatedAt: string;
  createdAt: string;
  mergedAt: string | null;
  commits: {
    nodes: Array<{ commit: { message: string } }>;
  };
}

interface RecentPrsResult {
  repository: {
    pullRequests: {
      nodes: GitHubPullRequestNode[];
    };
  };
}

export interface ListRecentActivityParams {
  owner: string;
  repo: string;
  since?: string | null;
}

export interface ListRecentActivityResult {
  commits: GitHubCommitNode[];
  pullRequests: GitHubPullRequestNode[];
}

export interface ListRecentActivityInternalParams
  extends ListRecentActivityParams {
  graphqlClient: GraphqlClient;
}

export async function listRecentActivity({
  graphqlClient,
  owner,
  repo,
  since,
}: ListRecentActivityInternalParams): Promise<ListRecentActivityResult> {
  return tracer.startActiveSpan("github.list_recent_activity", async (span) => {
    span.setAttribute("repo", `${owner}/${repo}`);
    span.setAttribute("since", since ?? "(first-scan)");
    try {
      const [commitsResult, prsResult] = await Promise.all([
        graphqlClient<RecentCommitsResult>(RECENT_COMMITS_QUERY, {
          owner,
          repo,
          since: since ?? null,
        }),
        graphqlClient<RecentPrsResult>(RECENT_PRS_QUERY, { owner, repo }),
      ]);

      const commits =
        commitsResult.repository.defaultBranchRef?.target?.history?.nodes ?? [];
      const pullRequests = since
        ? prsResult.repository.pullRequests.nodes.filter(
            (pr) => new Date(pr.updatedAt) >= new Date(since),
          )
        : prsResult.repository.pullRequests.nodes;

      span.setAttribute("commits.count", commits.length);
      span.setAttribute("pull_requests.count", pullRequests.length);
      span.setStatus({ code: SpanStatusCode.OK });
      return { commits, pullRequests };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw normalizeRepositoryReadError(err, "repository");
    } finally {
      span.end();
    }
  });
}
