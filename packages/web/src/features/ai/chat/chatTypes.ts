/**
 * Render model for the Ask AI chat (REEF-361). The chat runs on the agent-run
 * kit (`/api/agents/runs`, `chat.workspace`), whose `AgentRunState` is a single
 * run. `useWorkspaceChat` folds a multi-turn conversation on top of it and
 * projects each turn into these presentational shapes, so `ChatSurface` stays
 * free of agent-run internals.
 */

/** One tool the assistant invoked, surfaced as a transparency step (AC2). */
export interface ChatToolStep {
  toolCallId: string;
  /** The `snake_case` core tool name, e.g. `search_issues`. */
  toolName: string;
  status: "running" | "completed" | "error";
  /** Summarized call arguments; not the full result payload. */
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
}

/** A workspace document the assistant cited via `search_documents` (AC4). */
export interface ChatDocumentCitation {
  uri: string;
  title: string | null;
  collection: string | null;
  docType: string | null;
}

export interface ChatUserTurn {
  id: string;
  role: "user";
  text: string;
}

export interface ChatAssistantTurn {
  id: string;
  role: "assistant";
  /** The streamed / final Markdown answer. */
  text: string;
  toolSteps: ChatToolStep[];
  citations: ChatDocumentCitation[];
  /**
   * Issue ids this turn's own tools proved real (search_issues / read_issue).
   * Unioned with the loaded issue list so the answer can deep-link the issues it
   * just grounded on even when they are not in the board cache (AC3).
   */
  referencedIssueIds: string[];
  /** True while the run is still streaming this turn. */
  streaming: boolean;
  errorMessage: string | null;
}

export type ChatTurn = ChatUserTurn | ChatAssistantTurn;
