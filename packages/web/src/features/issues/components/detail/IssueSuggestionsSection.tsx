"use client";

import { Button } from "@/components/ui/button";
import type { ActivityStatusChangeSuggestion, Status } from "@reef/core";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActivityItemCard } from "../../../activity/components/ActivityItemCard";
import { useActivityFeed } from "../../../activity/hooks/useActivityFeed";
import { useActivitySuggestionReview } from "../../../activity/hooks/useActivitySuggestionReview";
import type { ActivityFeedItem } from "../../../activity/types";
import { ISSUE_SECTION_HEADER_CLASS } from "../shared/IssueFormSection";

type StatusChangeItem = Extract<ActivityFeedItem, { type: "ai_status_change" }>;

interface IssueSuggestionsSectionProps {
  issueId: string;
  vault: string;
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function IssueSuggestionsSection({
  issueId,
  vault,
}: IssueSuggestionsSectionProps) {
  const t = useTranslations("issues.detail");
  const common = useTranslations("common");
  const searchParams = useSearchParams();
  const suggestionFromUrl = searchParams.get("suggestion");
  const { items, isLoading, isError, refreshInbox } = useActivityFeed(vault);
  const { updateSuggestion, dismissSuggestion, approveSuggestion } =
    useActivitySuggestionReview(vault);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const targetCardRef = useRef<HTMLLIElement | null>(null);
  const focusedTargetRef = useRef<string | null>(null);

  const statusChangeItems = items.filter(
    (item): item is StatusChangeItem =>
      item.type === "ai_status_change" && item.issueId === issueId,
  );
  const targetSuggestionId = statusChangeItems.some(
    (item) => item.id === suggestionFromUrl,
  )
    ? suggestionFromUrl
    : null;
  const targetKey = targetSuggestionId
    ? `${issueId}:${targetSuggestionId}`
    : null;
  const setTargetCardRef = (node: HTMLLIElement | null) => {
    targetCardRef.current = node;
  };

  useEffect(() => {
    const target = targetCardRef.current;
    if (!target || !targetKey || focusedTargetRef.current === targetKey) return;

    const frame = window.requestAnimationFrame(() => {
      if (targetCardRef.current !== target) return;
      focusedTargetRef.current = targetKey;
      target.focus({ preventScroll: true });
      const prefersReducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false;
      target.scrollIntoView?.({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [targetKey]);

  const handleApprove = async (suggestion: ActivityStatusChangeSuggestion) => {
    setActionError(null);
    setApprovingId(suggestion.id);
    try {
      await approveSuggestion(suggestion.id);
    } catch (error) {
      setActionError(actionErrorMessage(error, t("suggestionsActionError")));
    } finally {
      setApprovingId(null);
    }
  };

  const handleSave = async (suggestionId: string, toStatus: Status) => {
    const item = statusChangeItems.find(
      (candidate) => candidate.id === suggestionId,
    );
    if (!item) return;

    setActionError(null);
    try {
      await updateSuggestion(suggestionId, {
        update: {
          ...item.statusChange.proposal.update,
          patch: {
            ...item.statusChange.proposal.update.patch,
            status: toStatus,
          },
        },
      });
    } catch (error) {
      setActionError(actionErrorMessage(error, t("suggestionsActionError")));
      throw error;
    }
  };

  const handleDismiss = (suggestionId: string) => {
    setActionError(null);
    void dismissSuggestion(suggestionId).catch((error: unknown) => {
      setActionError(actionErrorMessage(error, t("suggestionsActionError")));
    });
  };

  if (isLoading) {
    return (
      <section
        aria-labelledby="issue-detail-suggestions-heading"
        className="flex min-w-0 flex-col gap-3"
        data-testid="issue-detail-suggestions-loading"
      >
        <h3
          id="issue-detail-suggestions-heading"
          className={ISSUE_SECTION_HEADER_CLASS}
        >
          {t("suggestionsHeading")}
        </h3>
        <output aria-live="polite" className="text-xs text-muted-foreground">
          {t("suggestionsLoading")}
        </output>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        aria-labelledby="issue-detail-suggestions-heading"
        className="flex min-w-0 flex-col gap-3"
        data-testid="issue-detail-suggestions-error"
      >
        <h3
          id="issue-detail-suggestions-heading"
          className={ISSUE_SECTION_HEADER_CLASS}
        >
          {t("suggestionsHeading")}
        </h3>
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <span>{t("suggestionsLoadError")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refreshInbox()}
          >
            {common("retry")}
          </Button>
        </div>
      </section>
    );
  }

  if (statusChangeItems.length === 0) return null;

  return (
    <section
      aria-labelledby="issue-detail-suggestions-heading"
      className="flex min-w-0 flex-col gap-3"
      data-testid="issue-detail-suggestions"
    >
      <h3
        id="issue-detail-suggestions-heading"
        className={ISSUE_SECTION_HEADER_CLASS}
      >
        {t("suggestionsHeading")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("suggestionsDescription")}
      </p>
      {actionError ? (
        <div
          role="alert"
          data-testid="issue-detail-suggestions-action-error"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
        >
          {actionError}
        </div>
      ) : null}
      <ul className="flex min-w-0 flex-col gap-3">
        {statusChangeItems.map((item) => {
          const isTarget = item.id === targetSuggestionId;
          return (
            <li
              key={item.id}
              ref={isTarget ? setTargetCardRef : undefined}
              id={`issue-suggestion-${item.id}`}
              tabIndex={isTarget ? -1 : undefined}
              aria-label={
                isTarget
                  ? t("suggestionFocusTarget", { id: item.id })
                  : undefined
              }
              data-testid="issue-detail-suggestion-card"
              data-suggestion-id={item.id}
              className="scroll-mt-6 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <ActivityItemCard
                item={item}
                onApproveStatusChange={handleApprove}
                onDismissStatusChange={handleDismiss}
                onSaveStatusChange={handleSave}
                isApproving={approvingId === item.id}
                vault={vault}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
