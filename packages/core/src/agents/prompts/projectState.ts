import type {
  ProjectStateSystemPromptOptions,
  ProjectStateUserPromptRequest,
} from "../../schemas/ai/prompts";

// Status sort priority: active work first, then committed (todo), then the
// uncommitted backlog, then done/closed. Keeps backlog ahead of resolved work so
// it survives the top-200 context cap when a PM asks about deferred work
// (REEF-109). Plain `Record<string, number>`, so a status rename is not caught
// by the compiler — keep the keys in sync with `StatusEnum` (REEF-139).
const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  in_review: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  closed: 5,
};

function getStatusOrder(status: string): number {
  return STATUS_ORDER[status] ?? 99;
}

/**
 * Build the system prompt for project state Q&A.
 *
 * Ported from Tauri-era `build_project_state_system_prompt(local, dev, repos)` (commit e554ed3).
 */
export function buildProjectStateSystemPrompt(
  opts: ProjectStateSystemPromptOptions,
): string {
  const hasLocalTools = opts.hasLocalTools ?? false;
  const hasDevTools = opts.hasDevTools ?? false;
  const monitoredRepos = opts.monitoredRepos ?? [];
  const hasAnyTools = hasLocalTools || hasDevTools;

  const dataInstruction = hasAnyTools
    ? "answer the question using the provided data and any available tools.\nWhen the question relates to code, implementation details, or technical specifics, " +
      "actively use the available tools to explore the repository and gather relevant context before answering."
    : "answer the question using ONLY the provided data.";

  let toolSection = "";
  if (hasLocalTools) {
    toolSection +=
      "\nLOCAL REPO EXPLORATION TOOLS:\n" +
      "You have tools for exploring the local issue management repository:\n" +
      "- read_file: Read a file's content (path)\n" +
      "- list_files: List files in a directory with optional glob filtering (path, pattern)\n" +
      "- search_content: Search for regex patterns across files (pattern, optional path)\n\n" +
      "Use these tools to examine issue files, configuration, or any text content in the repository.\n";
  }
  if (hasDevTools) {
    toolSection +=
      "\nDEV REPO EXPLORATION TOOLS:\n" +
      "You have tools for exploring monitored dev repositories via the GitHub API:\n" +
      "- dev_read_file: Read a file's content from a remote repo (owner, repo, path, optional ref)\n" +
      "- dev_list_files: List files/directories in a remote repo (owner, repo, optional path, optional ref)\n" +
      "- dev_search_code: Search code in a remote repo (owner, repo, query)\n" +
      "- dev_list_commits: List recent commits in a remote repo (owner, repo, optional branch, optional since)\n\n" +
      "Use these tools to gather codebase context that helps answer the question more accurately.\n" +
      "Only use repos listed below -- do not guess or fabricate repository names.\n";

    if (monitoredRepos.length > 0) {
      toolSection += "\nAVAILABLE MONITORED REPOS:\n";
      for (const r of monitoredRepos) {
        const branch = r.defaultBranch ?? "main";
        toolSection += `- owner: ${r.owner}, repo: ${r.name}, default_branch: ${branch}\n`;
      }
    }
  }
  if (hasAnyTools) {
    const proactiveRule =
      hasLocalTools && hasDevTools
        ? "1. When the question involves issue files, code, or implementation, USE the tools proactively."
        : hasLocalTools
          ? "1. When the question involves issue files, configuration, or repository content, USE the local repo tools proactively."
          : "1. When the question involves code, implementation details, or technical specifics, USE the dev repo tools proactively.";
    toolSection += `\nTOOL USAGE RULES:\n${proactiveRule}\n2. Continue to follow all ANTI-FABRICATION RULES when using information from tools.\n3. Combine tool-gathered information with the provided issue data to form complete answers.\n`;
  }

  const preExample = hasAnyTools ? "" : "\n";

  return `You are an AI assistant that helps product managers understand the current state of their software project.\n\nGiven the PM's question, a list of issues with their metadata, and recent progress notes,\n${dataInstruction}\n\nReturn ONLY a valid JSON object (no markdown, no commentary) with this exact schema:\n\n{\n  "answer": "<your answer in plain PM/business language>",\n  "referenced_issue_ids": ["REEF-001", "REEF-042"]\n}\n\nANTI-FABRICATION RULES (CRITICAL):\n1. NEVER invent issue IDs, statuses, assignees, or any data not present in the context.\n2. If the provided data is insufficient to answer the question, say: "I don't have enough information in the current issue data to answer this question. Please check the relevant issues manually."\n3. Only reference issue IDs from the "referenced_issue_ids" array that actually appear in the provided issue context.\n4. Do NOT speculate about timelines, blockers, or relationships not explicitly stated in the data.\n\nMULTI-TURN RULES:\n1. If prior conversation messages are provided, use them as context for follow-up questions.\n2. Maintain consistency with your previous answers.\n\nANSWER RULES:\n1. Answer in plain PM/business language -- no developer jargon.\n2. Reference specific issue IDs in your answer text where relevant (e.g., "REEF-042 is blocked by REEF-037").\n3. Include all issue IDs you mention in "referenced_issue_ids".\n4. Keep answers concise and actionable (2-5 sentences for most questions).\n5. For "who worked on X" questions, use the progress notes and assigned_to fields.\n6. For "what's blocking X" questions, use the depends_on and blocks fields (depends_on lists what an issue is waiting on; blocks lists what an issue is blocking upstream).\n7. For "when did X last change status?" questions, use the last_status_change field.\n${toolSection}${preExample}EXAMPLE RESPONSE:\n{\n  "answer": "REEF-042 (Payment module refactoring) is currently blocked by REEF-037 (Authentication module), which is still in progress and assigned to jieun. There are no other blockers for the payment module at this time.",\n  "referenced_issue_ids": ["REEF-042", "REEF-037"]\n}\n`;
}

/**
 * Build the user prompt for a project state Q&A request.
 *
 * Ported from Tauri-era `build_project_state_user_prompt(question, hasTools)` (commit e554ed3).
 */
export function buildProjectStateUserPrompt(
  req: ProjectStateUserPromptRequest,
): string {
  const hasTools = req.hasTools ?? false;
  let prompt = "";

  // PM's question
  prompt += "## PM Question\n\n";
  prompt += `${req.question}\n\n`;

  // Issue context - sorted by status priority
  prompt += `## Project Issues (${req.issueContexts.length} total, showing up to 200)\n\n`;

  const sortedIssues = [...req.issueContexts].sort(
    (a, b) => getStatusOrder(a.status) - getStatusOrder(b.status),
  );

  if (sortedIssues.length === 0) {
    prompt += "(no issues in project)\n";
  } else {
    for (const issue of sortedIssues.slice(0, 200)) {
      const assigned = issue.assigned_to ?? "unassigned";
      const labels = issue.labels?.join(", ") ?? "";
      const deps = issue.depends_on?.join(", ") ?? "";
      const blocks = issue.blocks?.join(", ") ?? "";
      const lastChange = issue.lastStatusChange ?? "unknown";
      const details = [
        `status:${issue.status}`,
        `type:${issue.issue_type ?? "task"}`,
        `assignee:${assigned}`,
        issue.requester ? `requester:${issue.requester}` : "",
        issue.start_date ? `start:${issue.start_date}` : "",
        issue.due_date ? `due:${issue.due_date}` : "",
        issue.milestone_id ? `milestone_id:${issue.milestone_id}` : "",
        issue.sprint_id ? `sprint_id:${issue.sprint_id}` : "",
        issue.release_id ? `release_id:${issue.release_id}` : "",
        issue.severity ? `severity:${issue.severity}` : "",
        issue.parent_id ? `parent:${issue.parent_id}` : "",
        `labels:[${labels}]`,
        `depends_on:[${deps}]`,
        `blocks:[${blocks}]`,
        `last_status_change:${lastChange}`,
      ].filter(Boolean);
      prompt += `- ${issue.id} | ${issue.title} | ${details.join(" | ")}\n`;
    }
    if (sortedIssues.length > 200) {
      prompt += `(... and ${sortedIssues.length - 200} more issues not shown)\n`;
    }
  }

  const source = hasTools
    ? "the data above and the tools described in your instructions (e.g., file reading, code search, commit listing)"
    : "ONLY the data above";
  prompt += `\nAnswer the PM's question using ${source}. Return only the JSON object.`;
  return prompt;
}
