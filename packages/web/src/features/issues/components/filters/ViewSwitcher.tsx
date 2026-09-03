"use client";

import {
  SEGMENTED_CONTROL_ITEM,
  SEGMENTED_CONTROL_ITEM_ACTIVE,
  SEGMENTED_CONTROL_ITEM_INACTIVE,
  SEGMENTED_CONTROL_TRACK,
} from "@/components/segmentedControl";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { Columns3, GanttChart, List } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import {
  ISSUE_LAYOUTS,
  type IssueLayout,
  type IssueScope,
} from "../../lib/viewMode";

const LAYOUT_ICONS: Record<IssueLayout, typeof Columns3> = {
  board: Columns3,
  list: List,
  timeline: GanttChart,
};

interface ViewSwitcherProps {
  activeLayout: IssueLayout;
  scope: IssueScope;
  basePath?: string;
  hideTimeline?: boolean;
  includeScope?: boolean;
}

/** Layout-only control. Scope is deliberately owned by ScopeSwitcher. */
export function ViewSwitcher({
  activeLayout,
  scope,
  basePath = "/issues",
  hideTimeline = false,
  includeScope = true,
}: ViewSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { vault } = useActiveVault();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("issues.filters");
  const layouts =
    scope === "backlog" || hideTimeline
      ? ISSUE_LAYOUTS.filter((layout) => layout !== "timeline")
      : ISSUE_LAYOUTS;

  const selectLayout = useCallback(
    (layout: IssueLayout) => {
      if (layout === activeLayout) return;
      const next = new URLSearchParams(searchParams);
      if (includeScope) next.set("scope", scope);
      else next.delete("scope");
      next.set("view", layout);
      startTransition(() => {
        router.push(withVault(vault, `${basePath}?${next.toString()}`), {
          scroll: false,
        });
      });
    },
    [activeLayout, basePath, includeScope, router, scope, searchParams, vault],
  );

  return (
    <div
      role="group"
      aria-label={t("issueView")}
      aria-busy={isPending}
      data-testid="view-switcher"
      className={cn(
        SEGMENTED_CONTROL_TRACK,
        "motion-safe:transition-opacity motion-safe:duration-150",
        isPending && "cursor-progress opacity-60",
      )}
    >
      {layouts.map((layout) => {
        const Icon = LAYOUT_ICONS[layout];
        const label = t(`view.${layout}`);
        const isActive = layout === activeLayout;
        return (
          <button
            key={layout}
            type="button"
            aria-pressed={isActive}
            aria-label={label}
            title={label}
            data-testid={`view-switcher-${layout}`}
            onClick={() => selectLayout(layout)}
            className={cn(
              SEGMENTED_CONTROL_ITEM,
              "whitespace-nowrap",
              isActive
                ? SEGMENTED_CONTROL_ITEM_ACTIVE
                : SEGMENTED_CONTROL_ITEM_INACTIVE,
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
