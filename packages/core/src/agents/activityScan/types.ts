import type {
  GitHubCommitNode,
  GitHubPullRequestNode,
} from "../../adapters/github";
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

export type CommitNode = GitHubCommitNode;
export type PrNode = GitHubPullRequestNode;

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
