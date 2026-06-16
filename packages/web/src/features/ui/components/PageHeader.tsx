"use client";

import { useHydrated } from "@/lib/useHydrated";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-aligned action slot — buttons, toggles, etc. */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  const mounted = useHydrated();

  const renderedDescription = mounted ? (description ?? "") : "";

  return (
    <header
      data-slot="page-header"
      className={cn(
        "sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-background/80 px-6 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <h1
          className="font-display text-[14px] font-semibold tracking-tight text-foreground"
          style={{ letterSpacing: "-0.01em" }}
        >
          {title}
        </h1>
        <span
          className="truncate text-[12px] text-muted-foreground"
          aria-hidden={!renderedDescription}
        >
          {renderedDescription}
        </span>
      </div>
      {mounted && actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
