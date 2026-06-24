"use client";

import type { ReferenceSuggestion } from "@reef/core";
import { useTranslations } from "next-intl";
import { DocumentRefCard } from "../refs/DocumentRefCard";
import { ReferenceSuggestionCard } from "../refs/ReferenceSuggestionCard";

/**
 * The "Linked documents" block in the new-issue dialog (REEF-083 AC4):
 * AI-suggested akb documents to cite (candidates) plus the ones the PM has
 * accepted (confirmed). Accepted documents are passed on the create request and
 * linked as `references` relations once the issue exists. Renders nothing until
 * there is at least one candidate or confirmed document.
 */
interface EnrichmentReferencesPanelProps {
  candidates: readonly ReferenceSuggestion[];
  confirmed: readonly string[];
  onAdd: (uri: string) => void;
  onDismiss: (uri: string) => void;
  onRemove: (uri: string) => void;
  disabled?: boolean;
}

export function EnrichmentReferencesPanel({
  candidates,
  confirmed,
  onAdd,
  onDismiss,
  onRemove,
  disabled = false,
}: EnrichmentReferencesPanelProps) {
  const t = useTranslations("issues.create");
  if (candidates.length === 0 && confirmed.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t("linkedDocuments")}
      </span>

      {confirmed.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          {confirmed.map((uri) => (
            <DocumentRefCard
              key={uri}
              reference={{ uri, title: null }}
              disabled={disabled}
              onRemove={() => onRemove(uri)}
            />
          ))}
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          {candidates.map((suggestion) => (
            <ReferenceSuggestionCard
              key={suggestion.uri}
              suggestion={suggestion}
              disabled={disabled}
              onAdd={() => onAdd(suggestion.uri)}
              onDismiss={() => onDismiss(suggestion.uri)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
