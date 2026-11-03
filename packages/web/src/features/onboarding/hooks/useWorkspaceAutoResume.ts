"use client";

import {
  useActiveVault,
  useSetActiveVault,
} from "@/features/settings/hooks/useActiveVault";
import { useVaults } from "@/features/settings/hooks/useVaults";
import { withVault } from "@/lib/workspaceHref";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  selectConfiguredWorkspace,
  selectRememberedUnavailableWorkspace,
} from "../workspaceResumePolicy";

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
  const needsRememberedLookup =
    Boolean(rememberedVault) &&
    vaultsQuery.isSuccess &&
    !vaultsQuery.data.some((vault) => vault.installation_active === true);
  const managementQuery = useVaults({
    enabled: enabled && needsRememberedLookup,
    management: true,
  });
  const { mutateAsync: persistActiveVault } = useSetActiveVault();
  const [retryVersion, setRetryVersion] = useState(0);
  const [persistFailed, setPersistFailed] = useState(false);
  const pendingResumeRef = useRef<PendingResume | null>(null);
  const committedNavigationRef = useRef<string | null>(null);
  const emptyRedirectCommittedRef = useRef(false);
  const availabilityUnconfirmed =
    Boolean(vaultsQuery.data) &&
    !vaultsQuery.data?.some((vault) => vault.installation_active === true) &&
    Boolean(
      vaultsQuery.data?.some((vault) => vault.installation_active === null),
    );

  const target = useMemo(() => {
    if (!vaultsQuery.data) return null;
    return (
      selectConfiguredWorkspace(vaultsQuery.data, rememberedVault) ??
      selectRememberedUnavailableWorkspace(
        managementQuery.data ?? [],
        rememberedVault,
      )
    );
  }, [vaultsQuery.data, managementQuery.data, rememberedVault]);

  const retry = useCallback(() => {
    pendingResumeRef.current = null;
    setPersistFailed(false);
    setRetryVersion((version) => version + 1);
    void vaultsQuery.refetch();
    if (needsRememberedLookup) void managementQuery.refetch();
  }, [vaultsQuery, managementQuery, needsRememberedLookup]);

  useEffect(() => {
    // Reading the retry counter deliberately restarts a failed persistence
    // attempt without coupling retry behavior to query data identity.
    void retryVersion;
    if (
      !enabled ||
      vaultsQuery.isPending ||
      vaultsQuery.isError ||
      (needsRememberedLookup &&
        (managementQuery.isPending || managementQuery.isError)) ||
      rememberedVaultLoading ||
      !vaultsQuery.data
    ) {
      return;
    }

    if (!target) {
      if (availabilityUnconfirmed) return;
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
    availabilityUnconfirmed,
    persistActiveVault,
    redirectWhenEmpty,
    rememberedVaultLoading,
    retryVersion,
    router,
    target,
    vaultsQuery.data,
    vaultsQuery.isError,
    vaultsQuery.isPending,
    needsRememberedLookup,
    managementQuery.isPending,
    managementQuery.isError,
  ]);

  let status: WorkspaceAutoResumeStatus;
  if (!enabled) status = "disabled";
  else if (
    vaultsQuery.isError ||
    (needsRememberedLookup && managementQuery.isError) ||
    persistFailed
  )
    status = "error";
  else if (
    vaultsQuery.isPending ||
    (needsRememberedLookup && managementQuery.isPending) ||
    rememberedVaultLoading ||
    !vaultsQuery.data
  ) {
    status = "pending";
  } else if (target) status = "redirecting";
  else if (availabilityUnconfirmed) status = "error";
  else status = "empty";

  return { status, retry };
}
