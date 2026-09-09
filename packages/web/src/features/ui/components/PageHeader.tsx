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
  /** Optional secondary control rendered next to the page title. */
  titleAdjacent?: React.ReactNode;
  /** Right-aligned action slot — buttons, toggles, etc. */
  actions?: React.ReactNode;
  /**
   * Non-interactive header chrome for a loading surface. Unlike `actions`, this
   * stays visible during route/data pending so fixed labels do not blink. The
   * loading caller must provide inert presentation (not controls with client
   * handlers).
   */
  staticTitleAdjacent?: React.ReactNode;
  /** Non-interactive counterpart to `actions` for loading surfaces. */
  staticActions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  titleAdjacent,
  actions,
  staticTitleAdjacent,
  staticActions,
  className,
}: PageHeaderProps) {
  const mounted = useHydrated();

  const renderedDescription = mounted ? (description ?? "") : "";
  const renderedTitleAdjacent =
    staticTitleAdjacent ?? (mounted ? titleAdjacent : null);
  const renderedActions = staticActions ?? (mounted ? actions : null);
  const hasTitleAdjacent = renderedTitleAdjacent != null;
  // A string subtitle is a bare identifier, so opt the whole span out of
  // translation. A node subtitle owns its own translate boundaries (see the
  // `description` prop doc), so leave the span translatable.
  const identifierOnly = typeof renderedDescription === "string";

  return (
    <header
      data-slot="page-header"
      className={cn(
        "sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-surface-page/80 px-6 backdrop-blur-md",
        hasTitleAdjacent && "flex-wrap",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-baseline gap-3",
          hasTitleAdjacent &&
            "flex-wrap max-[767px]:w-full max-[767px]:items-center",
        )}
      >
        <h1 className="type-page-title text-foreground">{title}</h1>
        {hasTitleAdjacent && (
          <div
            data-slot="page-header-title-adjacent"
            className="flex shrink-0 items-center"
          >
            {renderedTitleAdjacent}
          </div>
        )}
        <span
          className="type-caption truncate text-muted-foreground"
          translate={identifierOnly ? "no" : undefined}
          aria-hidden={!renderedDescription}
        >
          {renderedDescription}
        </span>
      </div>
      {renderedActions && (
        <div
          data-slot="page-header-actions"
          className={cn(
            "flex max-w-full shrink-0 flex-wrap items-center gap-2",
            hasTitleAdjacent && "max-[767px]:w-full max-[767px]:justify-end",
          )}
        >
          {renderedActions}
        </div>
      )}
    </header>
  );
}
