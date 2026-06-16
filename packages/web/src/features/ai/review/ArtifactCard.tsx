"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentArtifact } from "@reef/core";
import type { ReactNode } from "react";
import { ArtifactMetadata } from "./ArtifactMetadata";
import { type ReviewAction, ReviewActions } from "./ReviewActions";

export interface ArtifactCardProps {
  artifact: AgentArtifact;
  actions?: ReviewAction[];
  children?: ReactNode;
  className?: string;
}

const typeLabel = {
  chat_message: "Chat",
  field_suggestion: "Field suggestion",
  issue_create_proposal: "Issue draft",
  issue_update_proposal: "Issue update",
  status_change_proposal: "Status change",
} satisfies Record<AgentArtifact["type"], string>;

export function ArtifactCard({
  artifact,
  actions = [],
  children,
  className,
}: ArtifactCardProps) {
  return (
    <article
      data-testid="artifact-card"
      data-artifact-type={artifact.type}
      className={cn(
        "min-w-0 rounded-md border border-ai-border bg-ai-subtle/50 p-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className="border-ai-border bg-background/70 px-2 py-0.5 text-[11px] text-ai-subtle-foreground">
              {typeLabel[artifact.type]}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {artifact.status}
            </span>
          </div>
          {artifact.title && (
            <h3 className="mt-1 min-w-0 break-words text-sm font-medium text-foreground">
              {artifact.title}
            </h3>
          )}
        </div>
        <ReviewActions actions={actions} compact />
      </div>

      <ArtifactMetadata
        className="mt-2"
        confidence={artifact.confidence}
        reasoning={artifact.reasoning}
        evidence={artifact.evidence}
        warnings={artifact.warnings}
      />

      {children && <div className="mt-3 min-w-0">{children}</div>}
    </article>
  );
}
