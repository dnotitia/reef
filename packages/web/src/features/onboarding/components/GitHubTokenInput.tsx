"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { getGitHubToken, setGitHubToken } from "@/lib/storage/credentials";
import { type SubmitEvent, useEffect, useState } from "react";

interface GitHubTokenInputProps {
  /** Fires after a PAT is verified and persisted. */
  onSaved?: () => void;
}

/**
 * PAT input that mirrors the previous wizard-step-0 behavior: verify via
 * `GET /api/repos` (which the BFF forwards with the candidate token) before
 * persisting to Dexie, so an invalid PAT does not lands in storage. Used as a
 * collapsible tile inside `OnboardingPanel`.
 */
export function GitHubTokenInput({ onSaved }: GitHubTokenInputProps) {
  const [tokenCheckLoading, setTokenCheckLoading] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadToken() {
      try {
        const token = await getGitHubToken();
        if (!cancelled) setHasToken(!!token);
      } finally {
        if (!cancelled) setTokenCheckLoading(false);
      }
    }
    void loadToken();
    return () => {
      cancelled = true;
    };
  }, []);

  if (tokenCheckLoading) {
    return (
      <div className="flex flex-col gap-3" data-testid="github-token-input">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }

  if (hasToken && !editing) {
    return (
      <div className="flex flex-col gap-3" data-testid="github-token-input">
        <p className="text-sm text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-status-done mr-2" />
          GitHub token saved in this browser ✓
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          data-testid="github-token-replace-btn"
          className="w-fit rounded-md border border-border bg-elevated px-4 py-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
        >
          Replace token
        </button>
      </div>
    );
  }

  async function handleSave(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setError("Paste a Personal Access Token to continue.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/repos", {
        headers: { Authorization: `Bearer ${trimmed}` },
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? "GitHub rejected that token. Check it has `repo` scope and hasn't expired."
            : "Couldn't verify the token. Check your connection and try again.",
        );
        return;
      }
      const ok = await setGitHubToken(trimmed);
      if (!ok) {
        setError(
          "Local storage unavailable. Check that browser storage isn't blocked.",
        );
        return;
      }
      setTokenInput("");
      setHasToken(true);
      setEditing(false);
      onSaved?.();
    } catch {
      setError("Failed to save the token. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="github-token-input">
      <p className="text-sm text-muted-foreground">
        reef reads activity from your monitored repositories on your behalf.
        Paste a Personal Access Token with at least <code>repo</code> scope. The
        token stays in this browser only.
      </p>

      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="ghp_..."
          aria-label="GitHub Personal Access Token"
          data-testid="onboarding-token-input"
          className="rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          data-testid="onboarding-save-token-btn"
          className="w-fit rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-foreground/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Token"}
        </button>
      </form>
    </div>
  );
}
