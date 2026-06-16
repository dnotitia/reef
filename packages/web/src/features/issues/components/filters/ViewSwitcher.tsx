"use client";

import { cn } from "@/lib/utils";
import { CircleDashed, Columns3, GanttChart, List } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { ISSUE_VIEW_MODES, type IssueViewMode } from "../../lib/viewMode";

const VIEW_META: Record<
  IssueViewMode,
  { label: string; icon: typeof Columns3 }
> = {
  board: { label: "Board", icon: Columns3 },
  list: { label: "List", icon: List },
  timeline: { label: "Timeline", icon: GanttChart },
  // The dashed circle echoes the backlog status glyph (REEF-109).
  backlog: { label: "Backlog", icon: CircleDashed },
};

interface ViewSwitcherProps {
  activeView: IssueViewMode;
}

/**
 * Segmented control that swaps between the Board / List / Timeline renderings
 * of the same issue collection. Writes the choice to the `?view=` param on the
 * canonical `/issues` route while preserving any existing filter/search params
 * so the active filter scope carries across views.
 *
 * Modeled as a group of toggle buttons (`aria-pressed`) rather than a tablist:
 * each click is a route navigation, and the rendered body is not an ARIA
 * tabpanel owned by this control.
 */
export function ViewSwitcher({ activeView }: ViewSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectView = useCallback(
    (view: IssueViewMode) => {
      if (view === activeView) return;
      const next = new URLSearchParams(searchParams);
      next.set("view", view);
      router.push(`/issues?${next.toString()}`, { scroll: false });
    },
    [activeView, router, searchParams],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a header toggle group is not a form <fieldset>; role="group" + aria-label is the right semantics here.
    <div
      role="group"
      aria-label="Issue view"
      data-testid="view-switcher"
      className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-elevated p-0.5"
    >
      {ISSUE_VIEW_MODES.map((view) => {
        const { label, icon: Icon } = VIEW_META[view];
        const isActive = view === activeView;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={isActive}
            aria-label={label}
            title={label}
            data-testid={`view-switcher-${view}`}
            onClick={() => selectView(view)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] font-medium transition-colors duration-150",
              isActive
                ? "bg-surface-hover text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
