"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUpdateIssueSubscription } from "@/features/issues/hooks/mutations/useUpdateIssueSubscription";
import { useIssueSubscription } from "@/features/issues/hooks/queries/useIssueSubscription";
import type { IssueSubscriptionAction } from "@/features/issues/lib/issueSubscription.actions";
import type { EffectiveSubscriptionState } from "@reef/core";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { toast } from "sonner";

const stateKeys = {
  unwatched: "watch",
  watching: "watching",
  muted: "muted",
} as const;

export function IssueSubscriptionControl({
  issueId,
  vault,
}: {
  issueId: string;
  vault: string;
}) {
  const t = useTranslations("issues.subscription");
  const query = useIssueSubscription(issueId, vault);
  const mutation = useUpdateIssueSubscription();
  const inFlightRef = useRef(false);
  const state: EffectiveSubscriptionState = query.data ?? "unwatched";
  const stateLabel = t(stateKeys[state]);
  const pending = query.isPending || mutation.isPending;

  async function selectAction(action: IssueSubscriptionAction) {
    if (inFlightRef.current || mutation.isPending) return;
    inFlightRef.current = true;
    try {
      await mutation.mutateAsync({ issueId, vault, action });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("updateError"));
    } finally {
      inFlightRef.current = false;
    }
  }

  function itemDisabled(action: IssueSubscriptionAction): boolean {
    return (
      pending ||
      (action === "watch" && state === "watching") ||
      (action === "mute" && state === "muted")
    );
  }

  function itemProps(action: IssueSubscriptionAction) {
    const disabled = itemDisabled(action);
    return {
      "aria-disabled": disabled,
      className: disabled ? "pointer-events-none opacity-50" : undefined,
      onSelect: () => {
        if (!disabled) void selectAction(action);
      },
      tabIndex: disabled ? -1 : 0,
    };
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="issue-subscription-trigger"
        aria-busy={pending}
        aria-label={t("controlLabel", { state: stateLabel })}
        disabled={pending}
        className="h-7 gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === "muted" ? (
          <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Eye aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        <span>{stateLabel}</span>
        <ChevronDown aria-hidden="true" className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 min-w-40">
        <DropdownMenuItem {...itemProps("watch")}>
          <Eye aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("watch")}
        </DropdownMenuItem>
        <DropdownMenuItem {...itemProps("mute")}>
          <EyeOff aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("mute")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
