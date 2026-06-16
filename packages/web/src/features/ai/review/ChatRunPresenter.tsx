"use client";

import { cn } from "@/lib/utils";
import type { AgentArtifact } from "@reef/core";
import type { AgentRunState } from "../runtime/types";
import { ArtifactList, artifactsFromRunState } from "./ArtifactList";
import { RunStatusIndicator } from "./RunStatusIndicator";

export interface ChatRunPresenterProps {
  state: AgentRunState;
  onRetry?: () => void;
  onCancel?: () => void;
  className?: string;
}

export function ChatRunPresenter({
  state,
  onRetry,
  onCancel,
  className,
}: ChatRunPresenterProps) {
  const artifacts = artifactsFromRunState(state);

  return (
    <div
      data-testid="chat-run-presenter"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <RunStatusIndicator state={state} onRetry={onRetry} onCancel={onCancel} />
      {state.text && (
        <div
          data-testid="chat-run-text"
          className="min-w-0 whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-elevated px-3 py-2 text-sm text-foreground"
        >
          {state.text}
        </div>
      )}
      <ArtifactList artifacts={artifacts} renderArtifact={renderChatArtifact} />
    </div>
  );
}

function renderChatArtifact(artifact: AgentArtifact) {
  if (artifact.type !== "chat_message") return null;
  return (
    <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
      {artifact.payload.text}
    </p>
  );
}
