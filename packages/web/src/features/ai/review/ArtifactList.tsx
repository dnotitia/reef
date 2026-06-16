"use client";

import type { AgentArtifact } from "@reef/core";
import type { ReactNode } from "react";
import type { AgentRunState } from "../runtime/types";
import { ArtifactCard } from "./ArtifactCard";
import type { ReviewAction } from "./ReviewActions";

export interface ArtifactListProps {
  artifacts: AgentArtifact[];
  actionsForArtifact?: (artifact: AgentArtifact) => ReviewAction[];
  renderArtifact?: (artifact: AgentArtifact) => ReactNode;
}

export function artifactsFromRunState(state: AgentRunState): AgentArtifact[] {
  const ordered = state.artifact_order
    .map((id) => state.artifacts[id])
    .filter((artifact): artifact is AgentArtifact => Boolean(artifact));

  const orderedIds = new Set(ordered.map((artifact) => artifact.artifact_id));
  const terminalOnly = state.artifact_ids
    .filter((id) => !orderedIds.has(id))
    .map((id) => state.artifacts[id])
    .filter((artifact): artifact is AgentArtifact => Boolean(artifact));

  return [...ordered, ...terminalOnly];
}

export function ArtifactList({
  artifacts,
  actionsForArtifact,
  renderArtifact,
}: ArtifactListProps) {
  if (artifacts.length === 0) return null;

  return (
    <div data-testid="artifact-list" className="grid gap-2">
      {artifacts.map((artifact) => (
        <ArtifactCard
          key={artifact.artifact_id}
          artifact={artifact}
          actions={actionsForArtifact?.(artifact) ?? []}
        >
          {renderArtifact?.(artifact)}
        </ArtifactCard>
      ))}
    </div>
  );
}
