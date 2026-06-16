import type {
  AgentArtifact,
  AgentArtifactType,
  AgentError,
  AgentRunEvent,
  AgentRunRequest,
  AgentRunStatus,
} from "@reef/core";

export type AgentRunPhase =
  | "idle"
  | "running"
  | "completed"
  | "empty"
  | "error"
  | "cancelled";

export type AgentRunFailureKind = "runtime" | "stream" | "http" | "cancelled";

export interface AgentRunFailure {
  kind: AgentRunFailureKind;
  message: string;
  code: string;
  recoverable: boolean;
  status?: number;
  details: Record<string, unknown>;
}

export interface AgentRunStageState {
  stage_id: string;
  name: string;
  status: "running" | "completed" | "error";
  output: Record<string, unknown> | null;
  error: AgentError | null;
  updated_at: string;
}

export interface AgentRunToolState {
  tool_call_id: string;
  tool_name: string;
  status: "called" | "completed" | "error";
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: AgentError | null;
  updated_at: string;
}

export interface AgentRunPartialArtifactState {
  artifact_id: string;
  artifact_type: AgentArtifactType;
  deltas: Record<string, unknown>[];
  updated_at: string;
}

export interface AgentRunProgressState {
  stages: Record<string, AgentRunStageState>;
  tools: Record<string, AgentRunToolState>;
}

export interface AgentRunState {
  phase: AgentRunPhase;
  run_status: AgentRunStatus | null;
  run_id: string | null;
  task_id: AgentRunRequest["task_id"] | string | null;
  seq: number;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  text: string;
  events: AgentRunEvent[];
  progress: AgentRunProgressState;
  partial_artifacts: Record<string, AgentRunPartialArtifactState>;
  artifacts: Record<string, AgentArtifact>;
  artifact_order: string[];
  artifact_ids: string[];
  error: AgentRunFailure | null;
}

export type AgentRunReducerAction =
  | { type: "reset"; task_id?: AgentRunState["task_id"] }
  | { type: "event"; event: AgentRunEvent }
  | { type: "stream_error"; error: AgentRunFailure }
  | { type: "http_error"; error: AgentRunFailure }
  | { type: "cancelled"; reason?: string };

export type AgentRunFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
