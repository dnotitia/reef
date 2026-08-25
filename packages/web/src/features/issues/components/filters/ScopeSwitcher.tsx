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
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { IssueLayout, IssueScope } from "../../lib/viewMode";

interface ScopeSwitcherProps {
  activeLayout: IssueLayout;
  activeScope: IssueScope;
}

/** The work-scope control. Labels stay visible at every supported viewport. */
export function ScopeSwitcher({
  activeLayout,
  activeScope,
}: ScopeSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { vault } = useActiveVault();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("issues.filters");

  const selectScope = useCallback(
    (scope: IssueScope) => {
      if (scope === activeScope) return;
      const next = new URLSearchParams(searchParams);
      next.set("scope", scope);
      next.set(
        "view",
        scope === "backlog" && activeLayout === "timeline"
          ? "list"
          : activeLayout,
      );
      startTransition(() => {
        router.push(withVault(vault, `/issues?${next.toString()}`), {
          scroll: false,
        });
      });
    },
    [activeLayout, activeScope, router, searchParams, vault],
  );

  return (
    <div
      role="group"
      aria-label={t("scope.label")}
      aria-busy={isPending}
      data-testid="scope-switcher"
      className={cn(
        SEGMENTED_CONTROL_TRACK,
        "motion-safe:transition-opacity motion-safe:duration-150",
        isPending && "cursor-progress opacity-60",
      )}
    >
      {(["active", "backlog"] as const).map((scope) => {
        const label = t(`scope.${scope}`);
        const isActive = scope === activeScope;
        return (
          <button
            key={scope}
            type="button"
            aria-pressed={isActive}
            aria-label={label}
            title={label}
            data-testid={`scope-switcher-${scope}`}
            onClick={() => selectScope(scope)}
            className={cn(
              SEGMENTED_CONTROL_ITEM,
              "whitespace-nowrap",
              isActive
                ? SEGMENTED_CONTROL_ITEM_ACTIVE
                : SEGMENTED_CONTROL_ITEM_INACTIVE,
            )}
          >
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
