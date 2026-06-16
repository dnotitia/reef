import type {
  ActivityScanAgentInput,
  AgentRunRequest,
  EnrichmentRequest,
  WorkspaceChatAgentInput,
} from "@reef/core";

export function chatWorkspaceRun(
  input: WorkspaceChatAgentInput,
): AgentRunRequest {
  return { task_id: "chat.workspace", input };
}

export function issueEnrichmentRun(input: EnrichmentRequest): AgentRunRequest {
  return { task_id: "issue.enrichment", input };
}

export function activityScanRun(
  input: ActivityScanAgentInput,
): AgentRunRequest {
  return { task_id: "activity.scan", input };
}
