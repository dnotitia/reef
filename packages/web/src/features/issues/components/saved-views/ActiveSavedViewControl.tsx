"use client";

import {
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
} from "@/components/ui/comboboxChrome";
import { useSavedIssueViews } from "@/features/issues/hooks/queries/useSavedIssueViews";
import { useSavedIssueViewPreferences } from "@/features/issues/hooks/useSavedIssueViewPreferences";
import {
  createSavedIssueViewPayload,
  savedIssueViewIsActive,
} from "@/features/issues/lib/issueViewCodec";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { cn } from "@/lib/utils";
import { ChevronDown, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SavedViewActions } from "./SavedViewActions";

export function ActiveSavedViewControl() {
  const { vault } = useActiveVault();
  const query = useSavedIssueViews(vault);
  const preferences = useSavedIssueViewPreferences(
    vault,
    query.data,
    query.isSuccess && !query.isFetching,
  );
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const searchParams = useSearchParams();
  const t = useTranslations("issues.savedViews");
  const exactView = useMemo(
    () =>
      query.data?.find((view) =>
        savedIssueViewIsActive(view.payload, searchParams),
      ),
    [query.data, searchParams],
  );
  const [context, setContext] = useState<{
    vault: string;
    id: string;
  }>();

  useEffect(() => {
    if (!vault) {
      setContext(undefined);
      return;
    }
    if (exactView) {
      setContext({ vault, id: exactView.id });
      return;
    }
    setContext((current) => {
      if (current?.vault !== vault) return undefined;
      if (!query.data?.some((view) => view.id === current.id)) return undefined;
      return current;
    });
  }, [exactView, query.data, vault]);

  const contextView =
    exactView ??
    query.data?.find(
      (view) => context?.vault === vault && view.id === context.id,
    );
  if (!contextView || preferences.isLoading) return null;

  const changed = exactView?.id !== contextView.id;
  const payload = createSavedIssueViewPayload(
    filter,
    searchQuery,
    searchParams.get("view") ?? "board",
  );

  return (
    <SavedViewActions
      vault={vault}
      view={contextView}
      preferences={preferences}
      setDefault={preferences.setDefault}
      setFavorite={preferences.setFavorite}
      updatePayload={payload}
      triggerClassName={cn(
        CBX_TRIGGER_CHIP,
        CBX_TRIGGER_CHIP_ACTIVE,
        "size-auto max-w-[15rem] px-2.5",
      )}
      triggerLabel={t("contextLabel", {
        name: contextView.name,
        state: changed ? t("changed") : t("active"),
      })}
      triggerContent={
        <>
          <Circle
            className={cn(
              "size-1.5 shrink-0 fill-current",
              changed ? "text-priority-high" : "text-brand",
            )}
            aria-hidden="true"
          />
          <span className="truncate">{contextView.name}</span>
          <span className="text-[10px] text-muted-foreground">
            {changed ? t("changed") : t("active")}
          </span>
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </>
      }
    />
  );
}
