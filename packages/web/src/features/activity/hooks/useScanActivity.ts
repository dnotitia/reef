"use client";

import { useAiAvailable } from "@/features/settings/hooks/useAiAvailable";
import { useHasGithubToken } from "@/features/settings/hooks/useHasGithubToken";
import { ensureProjectConfig } from "@/features/settings/hooks/useProjectConfig";
import { apiFetch } from "@/lib/apiClient";
import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import {
  getLastScanAt,
  setLastScanAt,
  shouldAutoScan,
} from "@/lib/storage/lastScan";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
          "Reconnect GitHub in Settings to scan for activity.",
        );
      }
      if (res.status === 503) {
        throw new MissingCredentialsError(
          "AI is not configured for this deployment.",
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
          toast.success(scanToastMessage(result));
        } else {
          toast("No new activity since the last scan.");
        }
      } else if (totalAdded > 0) {
        toast.success(scanToastMessage(result));
      }
      options?.onSuccess?.(result);
    },
    onError: (err, variables) => {
      if (variables.source !== "manual") return;
      if (isMissingCredentialsError(err)) {
        toast.error(err.message);
        return;
      }
      toast.error(
        err instanceof Error ? err.message : "Failed to scan for new activity.",
      );
    },
  });
}

function scanToastMessage(result: ScanActivityResult): string {
  const parts: string[] = [];
  if (result.addedDrafts > 0) {
    parts.push(
      `${result.addedDrafts} draft${result.addedDrafts === 1 ? "" : "s"}`,
    );
  }
  if (result.addedStatusChanges > 0) {
    parts.push(
      `${result.addedStatusChanges} status change${
        result.addedStatusChanges === 1 ? "" : "s"
      }`,
    );
  }
  return `${parts.join(" + ")} from recent activity`;
}

/**
 * Fires the auto on-mount scan run, gated by AI availability + a configured
 * GitHub token + cooldown. `{vault}::{repo}` keyed ref prevents React 19
 * StrictMode double-invocation and re-fires when workspace switches even if
 * both vaults monitor the same GitHub repo.
 *
 * The token gate (REEF-159) suppresses the scan when GitHub is unconfigured —
 * the scan route requires a token and would otherwise return 401 on every
 * trigger. (A vault with no monitored repos is already suppressed upstream by
 * `useActivityRepo` returning `repo: ""`; this additionally covers the
 * "repo configured, token missing" case.)
 *
 * `hasToken` is a presence boolean, so replacing an *invalid* token with a valid
 * one is a true→true no-op that would not re-run the trigger effect, and the
 * `firedFor` key would still suppress the retry. Subscribing to
 * `AUTH_CHANGED_EVENT` (broadcast on any token set/clear) resets the fired key
 * and bumps a revision so a reconnected token resumes the scan without a
 * remount (REEF-159 AC3).
 */
export function useScanAutoTrigger(
  vault: string,
  repo: string,
  mutate: (input: ScanActivityInput) => void,
): void {
  const { isAvailable } = useAiAvailable();
  const { hasToken } = useHasGithubToken();
  const firedFor = useRef<string | null>(null);
  const [authRevision, setAuthRevision] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      // A credential change re-arms the trigger: drop the fired key and force a
      // re-evaluation, since token *replacement* leaves `hasToken` unchanged.
      firedFor.current = null;
      setAuthRevision((n) => n + 1);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handler);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: authRevision is a re-arm signal, not read in the body — listing it makes a credential change re-evaluate the trigger even when hasToken is unchanged (invalid→valid token replacement).
  useEffect(() => {
    if (!vault || !repo || !isAvailable || !hasToken) return;
    const triggerKey = `${vault}::${repo}`;
    if (firedFor.current === triggerKey) return;
    firedFor.current = triggerKey;

    void (async () => {
      const shouldRun = await shouldAutoScan(repo);
      if (!shouldRun) return;
      mutate({ vault, repo, source: "auto" });
    })();
  }, [vault, repo, isAvailable, hasToken, mutate, authRevision]);
}
