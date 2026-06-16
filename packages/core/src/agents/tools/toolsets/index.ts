import type { AkbAdapter } from "../../../adapters/akb";
import type { GitHubAdapter } from "../../../adapters/github";
import {
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
}

export interface RepoReadToolsetParams {
  githubAdapter: GitHubAdapter;
  repoContext?: {
    owner: string;
    repo: string;
  } | null;
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
}: WorkspaceReadToolsetParams) {
  return {
    search_issues: createSearchIssuesTool({ adapter, vault }),
    read_issue: createReadIssueTool({ adapter, vault }),
    ...(includeAssignees
      ? { list_assignees: createListAssigneesTool({ adapter, vault }) }
      : {}),
  };
}

export function createRepoReadToolset({
  githubAdapter,
  repoContext,
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

  return {
    search_code: createSearchCodeTool(githubAdapter),
    dev_read_file: createDevReadFileTool(githubAdapter),
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
