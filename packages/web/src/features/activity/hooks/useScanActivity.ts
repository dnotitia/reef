"use client";

import { useAiAvailable } from "@/features/settings/hooks/useAiAvailable";
import { useGithubAppAvailable } from "@/features/settings/hooks/useGithubAppAvailable";
import { ensureProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import { apiFetch } from "@/lib/apiClient";
import {
  getLastScanAt,
  setLastScanAt,
  shouldAutoScan,
} from "@/lib/storage/lastScan";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface ScanActivityInput {
  /** akb vault that owns the `_reef/config` document this scan reads from. */
  vault: string;
  /** GitHub `owner/repo` full name. Pass `""` to suppress: mutation throws. */
  repo: string;
  /** Manual = toast outcome; Auto = silent on no-op. */
  source: "manual" | "auto";
}

interface ScanActivityResult {
  addedDrafts: number;
  addedStatusChanges: number;
  scannedAt: string;
}

/** Setup-incomplete state — surfaced separately so auto path can suppress it. */
class MissingCredentialsError extends Error {
  readonly kind = "missing_credentials" as const;
  constructor(message: string) {
    super(message);
    this.name = "MissingCredentialsError";
  }
}

function isMissingCredentialsError(
  err: unknown,
): err is MissingCredentialsError {
  return (
    err instanceof Error &&
    (err as { kind?: string }).kind === "missing_credentials"
  );
}

/**
 * Calls `POST /api/activity/scan`, which persists new suggestions in AKB.
 *
 * Replaces `useDetectUntrackedActivity` (untracked). The unified scan
 * additionally detects tracked-activity status changes. The browser keeps just
 * the scan watermark locally; pending suggestion state now lives in the AKB
 * activity inbox.
 */
export function useScanActivity(options?: {
  onSuccess?: (result: ScanActivityResult) => void;
}) {
  const queryClient = useQueryClient();
  const t = useTranslations("toasts");
  // Build the manual-scan summary toast from localized count parts (REEF-299).
  // Korean has no plural category, so the `{count, plural, ...}` catalog entries
  // resolve to a single form; English keeps one/other.
  const summarize = (result: ScanActivityResult): string => {
    const parts: string[] = [];
    if (result.addedDrafts > 0) {
      parts.push(t("scanDrafts", { count: result.addedDrafts }));
    }
    if (result.addedStatusChanges > 0) {
      parts.push(t("scanStatusChanges", { count: result.addedStatusChanges }));
    }
    return t("scanSummary", { parts: parts.join(" + ") });
  };

  return useMutation({
    mutationFn: async ({
      vault,
      repo,
    }: ScanActivityInput): Promise<ScanActivityResult> => {
      if (!vault) {
        throw new Error("Missing vault. Select a workspace in Settings.");
      }
      const parts = repo.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Invalid repo "${repo}". Expected "owner/name".`);
      }
      const [owner, repoName] = parts;

      const [since, projectConfig] = await Promise.all([
        getLastScanAt(repo),
        ensureProjectConfig(queryClient, vault),
      ]);

      const res = await apiFetch("/api/activity/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          repo: repoName,
          vault,
          ...(since ? { since } : {}),
          projectPrefix: projectConfig.config.project_prefix,
        }),
      });

      if (res.status === 401) {
        throw new MissingCredentialsError(
          "Sign in again to scan for activity.",
        );
      }
      if (res.status === 503) {
        throw new MissingCredentialsError(
          "GitHub App or AI is not configured for this deployment.",
        );
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Scan failed (HTTP ${res.status}).`);
      }

      const result = (await res.json()) as ScanActivityResult;
      await setLastScanAt(repo, result.scannedAt);

      return result;
    },
    onSuccess: (result, variables) => {
      const totalAdded = result.addedDrafts + result.addedStatusChanges;
      if (variables.source === "manual") {
        if (totalAdded > 0) {
          toast.success(summarize(result));
        } else {
          toast(t("noNewActivity"));
        }
      } else if (totalAdded > 0) {
        toast.success(summarize(result));
      }
      options?.onSuccess?.(result);
    },
    onError: (err, variables) => {
      if (variables.source !== "manual") return;
      if (isMissingCredentialsError(err)) {
        toast.error(err.message);
        return;
      }
      toast.error(err instanceof Error ? err.message : t("scanError"));
    },
  });
}

/**
 * Fires the auto on-mount scan run, gated by AI availability, GitHub App
 * availability, and cooldown. `{vault}::{repo}` keyed ref prevents React 19
 * StrictMode double-invocation and re-fires when workspace switches even if
 * both vaults monitor the same GitHub repo.
 */
export function useScanAutoTrigger(
  vault: string,
  repo: string,
  mutate: (input: ScanActivityInput) => void,
): void {
  const { isAvailable } = useAiAvailable();
  const { isAvailable: githubAppAvailable } = useGithubAppAvailable();
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!vault || !repo || !isAvailable || !githubAppAvailable) return;
    const triggerKey = `${vault}::${repo}`;
    if (firedFor.current === triggerKey) return;
    firedFor.current = triggerKey;

    void (async () => {
      const shouldRun = await shouldAutoScan(repo);
      if (!shouldRun) return;
      mutate({ vault, repo, source: "auto" });
    })();
  }, [vault, repo, isAvailable, githubAppAvailable, mutate]);
}
