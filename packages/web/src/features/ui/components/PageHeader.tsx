"use client";

import { useHydrated } from "@/lib/useHydrated";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /**
   * Header subtitle. A plain string is treated as an identifier — the active
   * workspace name on the vault-scoped pages — and the whole span is marked
   * translate="no" so machine translation leaves it intact (matching the
   * scope-name span in SettingsGroup). Pass a node when the subtitle mixes an
   * identifier with translatable prose (My Work's `@login · N open`) and wrap
   * the identifier portion in translate="no" yourself, so the prose still
   * translates (REEF-260).
   */
  description?: React.ReactNode;
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
  // A string subtitle is a bare identifier, so opt the whole span out of
  // translation. A node subtitle owns its own translate boundaries (see the
  // `description` prop doc), so leave the span translatable.
  const identifierOnly = typeof renderedDescription === "string";

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
          translate={identifierOnly ? "no" : undefined}
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
