"use client";

import { useProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import { DEFAULT_CONFIG } from "@reef/core";
import { useMemo } from "react";

export function useResolvedAutoHideWindows(vault: string): {
  completed: number;
  canceled: number;
} {
  const { data } = useProjectConfig(vault);
  const completed =
    data?.config.stale_hide_completed_days ??
    DEFAULT_CONFIG.stale_hide_completed_days;
  const canceled =
    data?.config.stale_hide_canceled_days ??
    DEFAULT_CONFIG.stale_hide_canceled_days;

  return useMemo(() => ({ completed, canceled }), [completed, canceled]);
}
