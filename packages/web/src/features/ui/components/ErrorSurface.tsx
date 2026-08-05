import { ReefMark } from "@/components/ui/reef-mark";
import type { ReactNode } from "react";

interface ErrorSurfaceProps {
  code?: string;
  title: string;
  description: string;
  actions: ReactNode;
}

/**
 * Shared presentation for route-level failures that render outside the
 * authenticated dashboard shell. Copy and recovery behavior stay with the
 * owning Next.js boundary; this component owns the Reef visual structure.
 */
export function ErrorSurface({
  code,
  title,
  description,
  actions,
}: ErrorSurfaceProps) {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center bg-background px-6 py-12 text-foreground">
      <section
        aria-labelledby="error-surface-title"
        aria-describedby="error-surface-description"
        className="flex w-full max-w-md flex-col rounded-xl border border-border bg-elevated p-6 sm:p-8"
      >
        <div className="flex items-center gap-2.5 border-b border-border-subtle pb-5">
          <ReefMark className="size-8" decorative />
          <span
            className="font-display text-[15px] font-semibold tracking-tight"
            translate="no"
          >
            reef{/* i18n-exempt: product wordmark */}
          </span>
        </div>

        <div className="flex flex-col gap-3 pt-6">
          {code ? (
            <p className="font-mono text-xs font-medium tracking-[0.16em] text-brand">
              {code}
            </p>
          ) : null}
          <h1
            id="error-surface-title"
            className="text-balance font-display text-2xl font-semibold tracking-tight text-foreground"
          >
            {title}
          </h1>
          <p
            id="error-surface-description"
            className="max-w-sm text-pretty text-sm leading-6 text-muted-foreground"
          >
            {description}
          </p>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-2">{actions}</div>
      </section>
    </main>
  );
}
