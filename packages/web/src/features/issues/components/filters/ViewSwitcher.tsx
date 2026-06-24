"use client";

import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { cn } from "@/lib/utils";
import { CircleDashed, Columns3, GanttChart, List } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { ISSUE_VIEW_MODES, type IssueViewMode } from "../../lib/viewMode";

// Icons are static; the human-readable labels are resolved per-locale inside the
// component via `useTranslations` (REEF-298).
const VIEW_ICONS: Record<IssueViewMode, typeof Columns3> = {
  board: Columns3,
  list: List,
  timeline: GanttChart,
  // The dashed circle echoes the backlog status glyph (REEF-109).
  backlog: CircleDashed,
};

interface ViewSwitcherProps {
  activeView: IssueViewMode;
}

/**
 * Segmented control that swaps between the Board / List / Timeline / Backlog
 * renderings of the issue collection. Writes the choice to the `?view=` param
 * on the canonical `/issues` route while preserving any existing filter/search
 * params so the active filter scope carries across views.
 *
 * Modeled as a group of toggle buttons (`aria-pressed`) rather than a tablist:
 * each click is a route navigation, and the rendered body is not an ARIA
 * tabpanel owned by this control.
 *
 * The four views are static imports sharing one `useIssueList` query key, so the
 * data is effectively ready on switch — the perceived lag is a pure render/nav
 * artifact (REEF-265). Wrapping `router.push` in a React transition makes the
 * navigation non-blocking: the App Router suppresses the route `loading.tsx`
 * fallback and keeps the current view mounted while the next one is prepared
 * concurrently, so there is no board-skeleton flicker and the heavy unmount of
 * Timeline/List does not block the click. `isPending` surfaces that in-flight
 * state as `aria-busy` plus a faint dim on the group; the buttons stay enabled
 * so a fast re-click interrupts and redirects the pending transition.
 */
export function ViewSwitcher({ activeView }: ViewSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("issues.filters");
  const viewLabels: Record<IssueViewMode, string> = {
    board: t("view.board"),
    list: t("view.list"),
    timeline: t("view.timeline"),
    backlog: t("view.backlog"),
  };

  const selectView = useCallback(
    (view: IssueViewMode) => {
      if (view === activeView) return;
      const next = new URLSearchParams(searchParams);
      next.set("view", view);
      // Non-blocking navigation: keep the current view on screen and let the
      // next one render concurrently instead of a synchronous, fallback-flashing
      // swap. The `?view=` URL still updates so deep links / back-forward work.
      startTransition(() => {
        router.push(`/issues?${next.toString()}`, { scroll: false });
      });
    },
    [activeView, router, searchParams],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a header toggle group is not a form <fieldset>; role="group" + aria-label is the right semantics here.
    <div
      role="group"
      aria-label={t("issueView")}
      aria-busy={isPending}
      data-testid="view-switcher"
      className={cn(
        SEGMENTED_CONTROL_TRACK,
        // Faint pending feedback while the transition is in flight. The opacity
        // change still applies under reduced motion (the busy state stays
        // visible); its easing is gated on motion-safe so nothing animates
        // for users who opt out (REEF-265 AC2/AC4).
        "motion-safe:transition-opacity motion-safe:duration-150",
        isPending && "cursor-progress opacity-60",
      )}
    >
      {ISSUE_VIEW_MODES.map((view) => {
        const Icon = VIEW_ICONS[view];
        const label = viewLabels[view];
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
              SEGMENTED_CONTROL_ITEM,
              isActive
                ? SEGMENTED_CONTROL_ITEM_ACTIVE
                : SEGMENTED_CONTROL_ITEM_INACTIVE,
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
