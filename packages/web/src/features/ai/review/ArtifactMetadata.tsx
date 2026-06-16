"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentArtifactEvidence } from "@reef/core";
import { AlertTriangle, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { isSafeWebUrl } from "./evidenceLinks";

export interface ArtifactMetadataProps {
  confidence?: number | null;
  reasoning?: string | null;
  evidence?: AgentArtifactEvidence[];
  warnings?: string[];
  provenance?: ReactNode;
  evidenceLabel?: string;
  compact?: boolean;
  className?: string;
}

export function ArtifactMetadata({
  confidence,
  reasoning,
  evidence = [],
  warnings = [],
  provenance,
  evidenceLabel,
  compact = false,
  className,
}: ArtifactMetadataProps) {
  const visibleEvidence = evidence.filter(
    (item) => item.label || item.ref || item.url,
  );

  if (
    confidence == null &&
    !reasoning &&
    visibleEvidence.length === 0 &&
    warnings.length === 0 &&
    !provenance
  ) {
    return null;
  }

  return (
    <div
      data-testid="artifact-metadata"
      className={cn(
        "flex min-w-0 flex-col gap-2 text-xs text-muted-foreground",
        compact && "gap-1.5 text-[11px]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {typeof confidence === "number" && (
          <ConfidenceBadge confidence={confidence} compact={compact} />
        )}
        {visibleEvidence.length > 0 && (
          <Badge className="gap-1 border-ai-border bg-background/70 px-2 py-0 text-[11px] text-muted-foreground">
            <Link2 className="h-3 w-3" aria-hidden="true" />
            {evidenceLabel ??
              `${visibleEvidence.length} evidence item${
                visibleEvidence.length === 1 ? "" : "s"
              }`}
          </Badge>
        )}
        {provenance}
      </div>

      {reasoning && (
        <p
          data-testid="artifact-reasoning"
          className={cn(
            "min-w-0 whitespace-pre-wrap break-words italic leading-snug",
            compact && "line-clamp-2",
          )}
        >
          {reasoning}
        </p>
      )}

      {visibleEvidence.length > 0 && !compact && (
        <ul
          data-testid="artifact-evidence"
          className="flex min-w-0 flex-wrap gap-1.5"
        >
          {visibleEvidence.map((item, index) => {
            const label = item.label ?? item.ref ?? item.url;
            const safeUrl = isSafeWebUrl(item.url) ? item.url : null;

            return (
              <li
                key={`${item.type}-${item.ref ?? item.label ?? index}`}
                className="min-w-0 max-w-full truncate rounded-full bg-background/70 px-2 py-0.5"
              >
                {safeUrl ? (
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground hover:underline"
                  >
                    {label}
                  </a>
                ) : (
                  label
                )}
              </li>
            );
          })}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul data-testid="artifact-warnings" className="grid gap-1">
          {warnings.map((warning) => (
            <li
              key={warning}
              className="flex min-w-0 items-start gap-1.5 text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words">{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
