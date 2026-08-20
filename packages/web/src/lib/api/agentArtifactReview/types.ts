import type { AgentArtifact, AkbAdapter } from "@reef/core";

export class AgentArtifactCommandError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentArtifactCommandError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface AgentArtifactReviewContext {
  adapter: AkbAdapter;
  vault: string;
  actor: string;
}

export interface ApproveAgentArtifactParams extends AgentArtifactReviewContext {
  artifact: AgentArtifact;
  prefix?: string | null;
}

export interface EditAgentArtifactParams {
  artifact: AgentArtifact;
  patch: Record<string, unknown>;
}

export interface DismissAgentArtifactParams {
  artifact: AgentArtifact;
}

export interface AgentArtifactCommandResult {
  artifact: AgentArtifact;
  issueId?: string;
  commit_hash?: string;
}
