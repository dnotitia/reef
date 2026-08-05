"use client";

import {
  useActiveVault,
  useSetActiveVault,
} from "@/features/settings/hooks/useActiveVault";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { withVault } from "@/lib/workspaceHref";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectConfiguredWorkspace } from "../workspaceResumePolicy";

export type WorkspaceAutoResumeStatus =
  | "disabled"
  | "pending"
  | "error"
  | "empty"
  | "redirecting";

interface WorkspaceAutoResumeOptions {
  enabled?: boolean;
  redirectWhenEmpty?: boolean;
}

interface PendingResume {
  target: string;
  promise: Promise<string>;
}

export function useWorkspaceAutoResume({
  enabled = true,
  redirectWhenEmpty = false,
}: WorkspaceAutoResumeOptions = {}) {
  const router = useRouter();
  const vaultsQuery = useVaults({ enabled });
  const { vault: rememberedVault, isLoading: rememberedVaultLoading } =
    useActiveVault();
  const { mutateAsync: persistActiveVault } = useSetActiveVault();
  const [retryVersion, setRetryVersion] = useState(0);
  const [persistFailed, setPersistFailed] = useState(false);
  const pendingResumeRef = useRef<PendingResume | null>(null);
  const committedNavigationRef = useRef<string | null>(null);
  const emptyRedirectCommittedRef = useRef(false);

  const target = useMemo(
    () =>
      vaultsQuery.data
        ? selectConfiguredWorkspace(vaultsQuery.data, rememberedVault)
        : null,
    [vaultsQuery.data, rememberedVault],
  );

  const retry = useCallback(() => {
    pendingResumeRef.current = null;
    setPersistFailed(false);
    setRetryVersion((version) => version + 1);
    if (vaultsQuery.isError) void vaultsQuery.refetch();
  }, [vaultsQuery]);

  useEffect(() => {
    // Reading the retry counter deliberately restarts a failed persistence
    // attempt without coupling retry behavior to query data identity.
    void retryVersion;
    if (
      !enabled ||
      vaultsQuery.isPending ||
      vaultsQuery.isError ||
      rememberedVaultLoading ||
      !vaultsQuery.data
    ) {
      return;
    }

    if (!target) {
      if (redirectWhenEmpty && !emptyRedirectCommittedRef.current) {
        emptyRedirectCommittedRef.current = true;
        router.replace("/onboarding");
      }
      return;
    }

    if (
      !pendingResumeRef.current ||
      pendingResumeRef.current.target !== target
    ) {
      pendingResumeRef.current = {
        target,
        promise: persistActiveVault(target),
      };
    }

    const pendingResume = pendingResumeRef.current;
    let cancelled = false;
    void pendingResume.promise
      .then(() => {
        if (
          cancelled ||
          committedNavigationRef.current === pendingResume.target
        ) {
          return;
        }
        committedNavigationRef.current = pendingResume.target;
        router.replace(withVault(pendingResume.target, "/issues"));
      })
      .catch(() => {
        if (!cancelled) setPersistFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    persistActiveVault,
    redirectWhenEmpty,
    rememberedVaultLoading,
    retryVersion,
    router,
    target,
    vaultsQuery.data,
    vaultsQuery.isError,
    vaultsQuery.isPending,
  ]);

  let status: WorkspaceAutoResumeStatus;
  if (!enabled) status = "disabled";
  else if (vaultsQuery.isError || persistFailed) status = "error";
  else if (
    vaultsQuery.isPending ||
    rememberedVaultLoading ||
    !vaultsQuery.data
  ) {
    status = "pending";
  } else if (target) status = "redirecting";
  else status = "empty";

  return { status, retry };
}
