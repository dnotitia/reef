"use client";

import { FieldSuggestion } from "@/features/ai/components/FieldSuggestion";
import {
  CollapsibleLineDiff,
  InlineWordDiff,
} from "@/features/ai/components/TextDiff";
import { useInlineEnrichment } from "@/features/ai/hooks/useInlineEnrichment";
import {
  type EnrichmentFormApi,
  formatCurrentValue,
  formatSuggestedValue,
} from "@/features/ai/lib/enrichmentFieldDescriptors";
import type {
  EnrichmentField,
  EnrichmentRepoContext,
  EnrichmentRequest,
  EnrichmentSuggestion,
  IssueCreateFields,
  ReferenceSuggestion,
} from "@reef/core";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { issueEnrichmentRun } from "@/features/ai/runtime/taskRequests";
import { agentRunFailureFromUnknown } from "@/features/ai/runtime/streamClient";
import { useAgentRun } from "@/features/ai/runtime/useAgentRun";

const FIELD_LABEL_CLASS = "type-caption font-medium text-muted-foreground";

export function useNewIssueEnrichment({
  vault,
  prefix,
  repoContext,
  title,
  body,
  estimatePoints,
  formApi,
  buildCreateFields,
  setSubmitError,
  setReferenceCandidates,
}: {
  vault: string | null | undefined;
  prefix: string;
  repoContext?: EnrichmentRepoContext;
  title: string;
  body: string;
  estimatePoints: string;
  formApi: EnrichmentFormApi;
  buildCreateFields: (input?: { fallbackTitle?: string }) => IssueCreateFields;
  setSubmitError: (message: string | null) => void;
  setReferenceCandidates: (references: ReferenceSuggestion[]) => void;
}) {
  const enrichment = useInlineEnrichment(formApi);
  const ingestEnrichment = enrichment.ingest;
  const { start, cancel } = useAgentRun();
  const activeRequest = useRef<symbol | null>(null);
  const [result, setResult] = useState<{
    suggestions: EnrichmentSuggestion[];
    references: ReferenceSuggestion[];
  } | null>(null);
  const [error, setError] = useState<(Error & { status?: number }) | null>(
    null,
  );
  const [isPending, setIsPending] = useState(false);

  const runEnrichment = useCallback(
    async (request: EnrichmentRequest) => {
      const token = Symbol("issue-enrichment");
      activeRequest.current = token;
      setIsPending(true);
      setError(null);
      setResult(null);
      try {
        const finalState = await start(issueEnrichmentRun(request));
        if (activeRequest.current !== token) return;
        if (finalState.phase === "error") {
          throw new Error(
            finalState.error?.message ?? "AI enrichment is unavailable.",
          );
        }
        if (finalState.phase === "cancelled") return;
        const artifact = finalState.artifact_order
          .map((id) => finalState.artifacts[id])
          .find((candidate) => candidate?.type === "field_suggestion");
        const next = artifact
          ? {
              suggestions: [...artifact.payload.suggestions],
              references: [...artifact.payload.references],
            }
          : { suggestions: [], references: [] };
        setResult(next);
        ingestEnrichment(next.suggestions);
        setReferenceCandidates(next.references);
      } catch (cause) {
        if (activeRequest.current !== token) return;
        const failure = agentRunFailureFromUnknown(cause);
        const nextError = new Error(failure.message) as Error & {
          status?: number;
        };
        if (failure.status !== undefined) nextError.status = failure.status;
        setError(nextError);
      } finally {
        if (activeRequest.current === token) {
          activeRequest.current = null;
          setIsPending(false);
        }
      }
    },
    [ingestEnrichment, setReferenceCandidates, start],
  );

  const resetRun = useCallback(() => {
    activeRequest.current = null;
    cancel();
    setIsPending(false);
    setError(null);
    setResult(null);
  }, [cancel]);

  const enrichRun = {
    data: result,
    error,
    isPending,
    isSuccess: result !== null,
    mutate: (request: EnrichmentRequest) => void runEnrichment(request),
    reset: resetRun,
  };

  function buildEnrichmentRequest(): EnrichmentRequest | null {
    if (!vault) return null;
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
    const enrichmentRequest = buildEnrichmentRequest();
    if (!enrichmentRequest) {
      setSubmitError(
        "Configure a workspace in Settings before requesting AI suggestions.",
      );
      return;
    }
    setSubmitError(null);
    enrichment.reset();
    enrichRun.mutate(enrichmentRequest);
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

  const enrichError = enrichRun.error ?? undefined;
  const enrichIsEmpty =
    enrichRun.isSuccess &&
    (enrichRun.data?.suggestions.length ?? 0) === 0 &&
    (enrichRun.data?.references.length ?? 0) === 0;
  const showEnrichmentBar =
    enrichRun.isPending ||
    Boolean(enrichError) ||
    enrichIsEmpty ||
    enrichment.counts.pending > 0 ||
    enrichment.counts.accepted > 0;

  return {
    enrichment,
    enrichRun,
    enrichError,
    enrichIsEmpty,
    showEnrichmentBar,
    buildEnrichmentRequest,
    handleAcceptAll,
    handleEnrichClick,
    renderEnrichable,
    renderFieldLabel,
  };
}
