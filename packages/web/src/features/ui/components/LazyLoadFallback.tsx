"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";

interface LazyLoadFallbackProps {
  error?: Error | null;
  retry?: () => void;
  surface: "dialog" | "view";
  testId: string;
  onDismiss?: () => void;
}

/**
 * Small, retryable fallback for code-split surfaces. The dynamic loader owns
 * the retry callback, so a failed chunk can be requested again without
 * rebuilding the surrounding shell or losing its current route state.
 */
export function LazyLoadFallback({
  error,
  retry,
  surface,
  testId,
  onDismiss,
}: LazyLoadFallbackProps) {
  const common = useTranslations("common");
  const failed = Boolean(error);

  return (
    <div
      data-testid={testId}
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      aria-busy={!failed}
      className={
        surface === "dialog"
          ? "fixed inset-x-4 top-20 z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-4 text-sm text-foreground shadow-xl"
          : "flex min-h-32 min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-4 text-sm text-muted-foreground"
      }
    >
      {failed ? (
        <p>{common("loadError")}</p>
      ) : (
        <>
          <Skeleton aria-hidden="true" className="h-8 w-full" />
          <span className="sr-only">{common("loading")}</span>
        </>
      )}
      {failed && retry ? (
        <Button type="button" size="sm" onClick={retry}>
          {common("retry")}
        </Button>
      ) : null}
      {surface === "dialog" && onDismiss ? (
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          {common("close")}
        </Button>
      ) : null}
    </div>
  );
}
