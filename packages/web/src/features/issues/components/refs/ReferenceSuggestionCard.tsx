"use client";

import { DocumentTypeGlyph } from "@/components/fields/DocumentTypeGlyph";
import { Button } from "@/components/ui/button";
import {
  akbDocumentBreadcrumb,
  akbDocumentSlugTitle,
} from "@/lib/akb/documentUri";
import type { ReferenceSuggestion } from "@reef/core";
import { Check, X } from "lucide-react";

/**
 * An AI-proposed akb document reference (REEF-083 AC4), rendered as a candidate
 * card with the model's reasoning and Add / Dismiss actions. Accepting it adds
 * the document to the issue's `references`; the issue is linked to it on create.
 * Mirrors DocumentRefCard's structure (glyph + title + breadcrumb) so an
 * accepted card and a suggestion read as the same kind of thing.
 */
interface ReferenceSuggestionCardProps {
  suggestion: ReferenceSuggestion;
  onAdd: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}

export function ReferenceSuggestionCard({
  suggestion,
  onAdd,
  onDismiss,
  disabled = false,
}: ReferenceSuggestionCardProps) {
  const title = suggestion.title ?? akbDocumentSlugTitle(suggestion.uri);
  const breadcrumb = akbDocumentBreadcrumb(suggestion.uri);

  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-md border border-ai/30 bg-ai/5 px-2.5 py-2">
      <DocumentTypeGlyph className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={title}
        >
          {title}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={suggestion.uri}
        >
          {breadcrumb}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {suggestion.reasoning}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={disabled}
          onClick={onAdd}
        >
          <Check className="size-3.5" />
          Add
        </Button>
        <button
          type="button"
          aria-label="Dismiss suggested document"
          disabled={disabled}
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
