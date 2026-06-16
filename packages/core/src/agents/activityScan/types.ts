import type { CodeSignal } from "../../models/status";
import type {
  AutoIssueUserPromptRequest,
  CommitDetail,
  PrDetail,
} from "../../schemas/ai/prompts";
import type { IssueCreateFields } from "../../schemas/issues/metadata";

export const MAX_DRAFT_STEPS = 6;
export const MAX_LINK_STEPS = 5;
export const SEMANTIC_LINK_CONFIDENCE_THRESHOLD = 0.82;

export const RECENT_COMMITS_QUERY = `
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

export const RECENT_PRS_QUERY = `
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

export interface CommitNode {
  oid: string;
  message: string;
  authoredDate: string;
  committedDate: string;
  author: { name: string; user: { login: string } | null } | null;
  changedFilesIfAvailable: number | null;
  associatedPullRequests: { nodes: Array<{ number: number }> };
}

export interface RecentCommitsResult {
  repository: {
    defaultBranchRef: {
      target: {
        history: {
          nodes: CommitNode[];
        };
      };
    } | null;
  };
}

export interface PrNode {
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

export interface RecentPrsResult {
  repository: {
    pullRequests: {
      nodes: PrNode[];
    };
  };
}

export const AUTO_ISSUE_LLM_RESPONSE_FIELDS = [
  "title",
  "issue_type",
  "priority",
  "assigned_to",
  "requester",
  "reporter",
  "start_date",
  "due_date",
  "milestone_id",
  "sprint_id",
  "release_id",
  "estimate_points",
  "severity",
  "parent_id",
  "depends_on",
  "blocks",
  "related_to",
  "labels",
] as const satisfies readonly (keyof IssueCreateFields)[];

type AutoIssueLlmCreateFields = Pick<
  IssueCreateFields,
  (typeof AUTO_ISSUE_LLM_RESPONSE_FIELDS)[number]
>;

type NonNullAutoIssueLlmCreateFields = {
  [TKey in keyof AutoIssueLlmCreateFields]: Exclude<
    AutoIssueLlmCreateFields[TKey],
    null
  >;
};

export interface LlmDraftResponse
  extends Partial<NonNullAutoIssueLlmCreateFields> {
  title: string;
  content: string;
  reasoning: string;
  confidence: number;
}

export interface NormalisedActivity {
  type: "commit" | "pr";
  ref: string;
  actor: string;
  repo: string;
  issueRef: string | null;
  link: {
    source: "explicit" | "semantic";
    confidence?: number;
    rationale?: string;
  } | null;
  draftPromptRequest: AutoIssueUserPromptRequest;
  noteInput: {
    pr?: PrDetail;
    commit?: CommitDetail;
  };
}
