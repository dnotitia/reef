import type { AkbAdapter } from "../../../adapters/akb";
import type { GitHubAdapter } from "../../../adapters/github";
import {
  type RepoRef,
  createBoundDevReadFileTool,
  createBoundSearchCodeTool,
  createDevReadFileTool,
  createSearchCodeTool,
} from "../repo";
import { suggestLabelsTool, suggestPriorityTool } from "../suggestion";
import {
  createListAssigneesTool,
  createReadIssueTool,
  createReadTemplateTool,
  createSearchDocumentsTool,
  createSearchIssuesTool,
} from "../workspace";

export interface WorkspaceReadToolsetParams {
  adapter: AkbAdapter;
  vault: string;
  includeAssignees?: boolean;
  /**
   * Include `search_documents` so answers can cite akb workspace documents
   * (REEF-361 AC4). Off by default so issue-focused read-toolset consumers
   * (e.g. the activity-scan semantic linker) are unaffected; the chat agent opts
   * in.
   */
  includeDocuments?: boolean;
}

export interface RepoReadToolsetParams {
  githubAdapter: GitHubAdapter;
  /**
   * Server-verified single repo for the bound tools (enrichment). When set, the
   * tools target just this repo and ignore `allowedRepos`.
   */
  repoContext?: {
    owner: string;
    repo: string;
  } | null;
  /**
   * The active vault's monitored repositories. Required for the unbound chat
   * tools, where the LLM supplies `owner`/`repo`: the tools reject any repo not
   * in this list so a broad GitHub App token does not ground on an out-of-scope
   * repository (REEF-243). When omitted or empty (and no `repoContext`), no repo
   * tools are returned — unbounded repo reads are does not exposed.
   */
  allowedRepos?: RepoRef[] | null;
}

export interface IssueAuthoringToolsetParams {
  adapter: AkbAdapter;
  vault: string;
  includeAssignees?: boolean;
  includeSuggestions?: boolean;
}

export function createWorkspaceReadToolset({
  adapter,
  vault,
  includeAssignees = true,
  includeDocuments = false,
}: WorkspaceReadToolsetParams) {
  return {
    search_issues: createSearchIssuesTool({ adapter, vault }),
    // `search_documents` (opt-in) lets the chat ground answers in akb workspace
    // docs and return citations the client renders as document cards (REEF-361
    // AC4). It is read-just, so it slots in alongside the issue tools.
    ...(includeDocuments
      ? { search_documents: createSearchDocumentsTool({ adapter, vault }) }
      : {}),
    read_issue: createReadIssueTool({ adapter, vault }),
    ...(includeAssignees
      ? { list_assignees: createListAssigneesTool({ adapter, vault }) }
      : {}),
  };
}

export function createRepoReadToolset({
  githubAdapter,
  repoContext,
  allowedRepos,
}: RepoReadToolsetParams) {
  if (repoContext) {
    return {
      search_code: createBoundSearchCodeTool({
        adapter: githubAdapter,
        owner: repoContext.owner,
        repo: repoContext.repo,
      }),
      dev_read_file: createBoundDevReadFileTool({
        adapter: githubAdapter,
        owner: repoContext.owner,
        repo: repoContext.repo,
      }),
    };
  }

  // Unbound tools (chat): the LLM supplies owner/repo, so every read is checked
  // against the monitored-repo allowlist. A missing/empty allowlist yields tools
  // that reject every repo — not an unbounded GitHub read. Callers that want
  // to omit repo grounding entirely should skip this toolset (see chat agent).
  return {
    search_code: createSearchCodeTool(githubAdapter, allowedRepos ?? []),
    dev_read_file: createDevReadFileTool(githubAdapter, allowedRepos ?? []),
  };
}

export function createIssueAuthoringToolset({
  adapter,
  vault,
  includeAssignees = false,
  includeSuggestions = false,
}: IssueAuthoringToolsetParams) {
  return {
    search_issues: createSearchIssuesTool({ adapter, vault }),
    search_documents: createSearchDocumentsTool({ adapter, vault }),
    read_issue: createReadIssueTool({ adapter, vault }),
    read_template: createReadTemplateTool({ adapter, vault }),
    ...(includeAssignees
      ? { list_assignees: createListAssigneesTool({ adapter, vault }) }
      : {}),
    ...(includeSuggestions
      ? {
          suggest_labels: suggestLabelsTool,
          suggest_priority: suggestPriorityTool,
        }
      : {}),
  };
}

export function createSuggestionToolset() {
  return {
    suggest_labels: suggestLabelsTool,
    suggest_priority: suggestPriorityTool,
  };
}
