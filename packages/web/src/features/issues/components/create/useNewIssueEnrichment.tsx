"use client";

import { FieldSuggestion } from "@/features/ai/components/FieldSuggestion";
import {
  CollapsibleLineDiff,
  InlineWordDiff,
} from "@/features/ai/components/TextDiff";
import {
  type EnrichIssueError,
  useEnrichIssue,
} from "@/features/ai/hooks/useEnrichIssue";
import { useInlineEnrichment } from "@/features/ai/hooks/useInlineEnrichment";
import {
  type EnrichmentFormApi,
  formatCurrentValue,
  formatSuggestedValue,
} from "@/features/ai/lib/enrichmentFieldDescriptors";
import type {
  EnrichmentField,
  EnrichmentRequest,
  EnrichmentSuggestion,
  IssueCreateFields,
  ReferenceSuggestion,
} from "@reef/core";
import { type ReactNode, useState } from "react";

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

export function useNewIssueEnrichment({
  vault,
  prefix,
  scanRepo,
  title,
  body,
  estimatePoints,
  formApi,
  buildCreateFields,
  setSubmitError,
  setReferenceCandidates,
  isAiAvailable,
  isAiAvailabilityLoading,
  aiUnavailableMessage,
}: {
  vault: string | null | undefined;
  prefix: string;
  scanRepo: string;
  title: string;
  body: string;
  estimatePoints: string;
  formApi: EnrichmentFormApi;
  buildCreateFields: (input?: { fallbackTitle?: string }) => IssueCreateFields;
  setSubmitError: (message: string | null) => void;
  setReferenceCandidates: (references: ReferenceSuggestion[]) => void;
  isAiAvailable: boolean;
  isAiAvailabilityLoading: boolean;
  aiUnavailableMessage: string;
}) {
  const enrichment = useInlineEnrichment(formApi);
  const ingestEnrichment = enrichment.ingest;
  const [localError, setLocalError] = useState<string | null>(null);
  const enrichMutation = useEnrichIssue({
    onSuccess: (result) => {
      setLocalError(null);
      ingestEnrichment(result.suggestions);
      setReferenceCandidates(result.references);
    },
  });

  function buildEnrichmentRequest(): EnrichmentRequest | null {
    if (!vault) return null;
    const parts = scanRepo.split("/");
    const repoContext =
      parts.length === 2 && parts[0] && parts[1]
        ? { owner: parts[0], repo: parts[1] }
        : undefined;
    return {
      issueId: `${prefix}-PENDING`,
      vault,
      draft: {
        fields: buildCreateFields({ fallbackTitle: "(untitled)" }),
        content: body,
      },
      ...(repoContext ? { repoContext } : {}),
    };
  }

  function canRequestAi(): boolean {
    if (isAiAvailabilityLoading || isAiAvailable) return true;
    setSubmitError(null);
    enrichMutation.reset();
    setLocalError(aiUnavailableMessage);
    return false;
  }

  function mutateEnrichment(
    enrichmentRequest: EnrichmentRequest,
    options: { resetSuggestions: boolean },
  ) {
    setLocalError(null);
    if (options.resetSuggestions) enrichment.reset();
    enrichMutation.mutate(enrichmentRequest);
  }

  function handleEnrichClick() {
    if (!title.trim()) {
      setSubmitError(
        "Add a title before requesting AI suggestions — the prompt needs context.",
      );
      return;
    }
    if (estimatePoints.trim() && Number.isNaN(Number(estimatePoints.trim()))) {
      setSubmitError(
        "Estimate must be a number before requesting AI suggestions.",
      );
      return;
    }
    if (!canRequestAi()) return;
    const enrichmentRequest = buildEnrichmentRequest();
    if (!enrichmentRequest) {
      setSubmitError(
        "Configure a workspace in Settings before requesting AI suggestions.",
      );
      return;
    }
    setSubmitError(null);
    mutateEnrichment(enrichmentRequest, { resetSuggestions: true });
  }

  function handleRetry() {
    if (!canRequestAi()) return;
    const enrichmentRequest = buildEnrichmentRequest();
    if (enrichmentRequest) {
      mutateEnrichment(enrichmentRequest, { resetSuggestions: false });
    }
  }

  function resetEnrichmentNotice() {
    setLocalError(null);
    enrichMutation.reset();
  }

  function handleAcceptAll() {
    // No success toast: accepted suggestions are immediately reflected in the
    // form fields and the EnrichmentReviewBar's accepted count.
    enrichment.acceptAll();
  }

  function renderEnrichable(
    field: EnrichmentField,
    control: ReactNode,
  ): ReactNode {
    const entry = enrichment.getEntry(field);
    if (!entry || entry.status !== "pending") return control;
    return (
      <FieldSuggestion
        field={field}
        entry={entry}
        currentDisplay={formatCurrentValue(formApi, field)}
        suggestedDisplay={formatSuggestedValue(entry.suggestion)}
        diff={diffForSuggestion(entry.suggestion)}
        onAccept={() => enrichment.accept(field)}
        onDismiss={() => enrichment.dismiss(field)}
      />
    );
  }

  function renderFieldLabel(
    field: EnrichmentField,
    htmlFor: string,
    text: string,
  ): ReactNode {
    const pending = enrichment.getEntry(field)?.status === "pending";
    return pending ? (
      <span className={FIELD_LABEL_CLASS}>{text}</span>
    ) : (
      <label className={FIELD_LABEL_CLASS} htmlFor={htmlFor}>
        {text}
      </label>
    );
  }

  function diffForSuggestion(suggestion: EnrichmentSuggestion): ReactNode {
    if (suggestion.field === "title") {
      return <InlineWordDiff before={title} after={suggestion.value} />;
    }
    if (suggestion.field === "content") {
      return (
        <CollapsibleLineDiff
          before={body}
          after={suggestion.value}
          fieldTestId="body"
        />
      );
    }
    return undefined;
  }

  const enrichError = enrichMutation.error as EnrichIssueError | undefined;
  const enrichErrorMessage = localError ?? enrichError?.message;
  const enrichIsEmpty =
    enrichMutation.isSuccess &&
    (enrichMutation.data?.suggestions.length ?? 0) === 0 &&
    (enrichMutation.data?.references.length ?? 0) === 0;
  const showEnrichmentBar =
    enrichMutation.isPending ||
    Boolean(enrichErrorMessage) ||
    enrichIsEmpty ||
    enrichment.counts.pending > 0 ||
    enrichment.counts.accepted > 0;

  return {
    enrichment,
    enrichMutation,
    enrichError,
    enrichErrorMessage,
    enrichIsEmpty,
    showEnrichmentBar,
    buildEnrichmentRequest,
    handleAcceptAll,
    handleEnrichClick,
    handleRetry,
    resetEnrichmentNotice,
    renderEnrichable,
    renderFieldLabel,
  };
}
