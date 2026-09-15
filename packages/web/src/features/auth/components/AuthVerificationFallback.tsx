"use client";

import { Button } from "@/components/ui/button";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface AuthVerificationFallbackProps {
  mode: "blocking" | "inline";
  onRetry: () => Promise<void>;
}

/** Recovery surface for an auth probe that could not confirm session state. */
export function AuthVerificationFallback({
  mode,
  onRetry,
}: AuthVerificationFallbackProps) {
  const t = useTranslations("auth.sessionVerification");
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  if (mode === "blocking") {
    return (
      <main
        data-testid="auth-verification-unavailable"
        className="flex min-h-screen items-center justify-center bg-surface-page p-6"
      >
        <section
          role="alert"
          className="w-full max-w-lg rounded-xl border border-border-subtle bg-surface-elevated p-8 shadow-sm"
        >
          <CircleAlert
            className="mb-4 h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="type-page-title">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("description")}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-6"
            data-testid="auth-verification-retry"
            busy={retrying}
            onClick={() => void handleRetry()}
          >
            <RefreshCw
              className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              aria-hidden="true"
            />
            {retrying ? t("retrying") : t("retry")}
          </Button>
        </section>
      </main>
    );
  }

  return (
    <div
      data-testid="auth-revalidation-status"
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3 sm:px-6"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CircleAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t("revalidationTitle")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("revalidationDescription")}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="auth-revalidation-retry"
        busy={retrying}
        onClick={() => void handleRetry()}
      >
        <RefreshCw
          className={retrying ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
          aria-hidden="true"
        />
        {retrying ? t("retrying") : t("retry")}
      </Button>
    </div>
  );
}
