"use client";

import { signOutOfWorkspace } from "@/features/auth/signOut.actions";
import { navigateToSignOutTarget } from "@/features/auth/signOutNavigation";
import { PreferencesSection } from "@/features/preferences/components/PreferencesSection";
import { SettingsGroup } from "@/features/settings/components/SettingsGroup";
import {
  clearGitHubToken,
  getGitHubToken,
  setGitHubToken,
} from "@/lib/storage/credentials";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type TokenStatus = "unknown" | "configured" | "not-configured";

/**
 * Settings › Preferences (REEF-183) — browser-local, per-person settings: the
 * monitored-repo GitHub PAT, workspace sign-out, and appearance. None of this is
 * workspace-scoped, so this tab deliberately does NOT mount the Active Workspace
 * selector (AC2).
 *
 * Auth model post-akb pivot:
 *  - The akb workspace session lives in an httpOnly cookie (`__reef_session`).
 *    "Sign out" calls `POST /api/auth/akb/logout` to clear it.
 *  - The GitHub Personal Access Token is browser-local (IndexedDB) and is
 *    used to call monitored repositories on the user's behalf. There is
 *    no OAuth flow — the user pastes a PAT directly.
 *  - "Disconnect" performs both: clears the GitHub PAT and signs out of the
 *    akb session via `signOutOfWorkspace` — so it runs the SAME akb-scoped
 *    cleanup as the sidebar account menu (REEF-068), not just a bare logout
 *    POST. Then redirects to /login.
 */
export default function PreferencesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<TokenStatus>("unknown");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [tokenInput, setTokenInput] = useState("");

  useEffect(() => {
    getGitHubToken()
      .then((token) => {
        setStatus(token ? "configured" : "not-configured");
      })
      .catch(() => {
        setStatus("not-configured");
      });
  }, []);

  async function handleDisconnect() {
    try {
      // Clear the GitHub PAT (person-scoped), then run the shared akb sign-out
      // — POST /logout + the akb-scoped browser-state wipe — so this Settings
      // path does not bypass the REEF-068 cleanup the sidebar menu performs.
      await clearGitHubToken();
      const result = await signOutOfWorkspace();
      if (result.redirectUrl) {
        navigateToSignOutTarget(result.redirectUrl);
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setMessage("Failed to disconnect. Please try again.");
    }
  }

  async function handlePatSave(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setMessage("Token cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const ok = await setGitHubToken(tokenInput.trim());
      if (ok) {
        setTokenInput("");
        setStatus("configured");
        setMessage("Token saved.");
      } else {
        setMessage(
          "Local storage unavailable. Check browser settings (storage may be blocked or cleared).",
        );
      }
    } catch {
      setMessage("Failed to save token. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsGroup
      title="Your preferences"
      description="Stored in this browser only — for you."
      testId="settings-group-personal"
    >
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          GitHub Access Token
        </h3>
        <p className="text-xs text-muted-foreground">
          Used to read activity from your monitored repositories. The token
          stays in this browser only and is never sent to reef&apos;s server.
        </p>

        {status === "unknown" && (
          <p className="text-sm text-muted-foreground">
            Checking token status…
          </p>
        )}

        {status === "configured" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-status-done mr-2"
              />
              GitHub token saved in this browser.
            </p>
            <button
              type="button"
              onClick={handleDisconnect}
              data-testid="disconnect-btn"
              className="w-fit rounded-md border border-border bg-elevated px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover"
            >
              Disconnect & sign out
            </button>
          </div>
        )}

        {status === "not-configured" && (
          <form onSubmit={handlePatSave} className="flex flex-col gap-3">
            <input
              id="github-token-input"
              type="password"
              name="github-token"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              disabled={saving}
              placeholder="ghp_…"
              aria-label="GitHub Personal Access Token"
              className="rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                data-testid="save-token-btn"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                )}
                {saving ? "Saving…" : "Save Token"}
              </button>
            </div>
          </form>
        )}

        {message && (
          <p role="alert" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </section>

      {/* Appearance owns its own section heading + description, so it is
          rendered directly here — no wrapper heading, which would duplicate
          "Appearance" (REEF-151). */}
      <PreferencesSection />
    </SettingsGroup>
  );
}
