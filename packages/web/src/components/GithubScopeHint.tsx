import { cn } from "@/lib/utils";

/**
 * Single source of truth for the GitHub PAT scope guidance shown wherever a
 * person pastes a monitored-repo token (onboarding "Connect GitHub" step and
 * Settings › Preferences). REEF-236.
 *
 * The monitored-repo adapter is read-only (activity scan, code search, file
 * reads, repo labels), so least-privilege is `public_repo` for public repos and
 * `repo` for private ones — the root AGENTS.md scope rule. Keeping the copy in
 * one component stops the two surfaces from drifting: before this they
 * disagreed (onboarding said `repo` only, Preferences gave no scope guidance at
 * all and neither linked to GitHub's token page).
 *
 * The deep link presets the broader `repo` scope so private-repo users can save
 * in one click; the copy tells public-only users they can narrow it to
 * `public_repo`. We deliberately say "stays in this browser only" rather than
 * "never sent to reef's server": the token is never persisted server-side, but
 * it does transit reef's BFF as a per-request bearer header on the way to
 * GitHub (the onboarding verify call and every repo read), so the stronger
 * claim would be inaccurate.
 */
export function GithubScopeHint({ className }: { className?: string }) {
  return (
    <p
      className={cn("text-sm text-muted-foreground", className)}
      data-testid="github-scope-hint"
    >
      reef reads activity from your monitored repositories on your behalf —{" "}
      <span className="font-medium text-foreground/90">read-only</span>. Use{" "}
      <code>public_repo</code> for public repos, or <code>repo</code> for
      private ones. The token stays in this browser only.{" "}
      <a
        href="https://github.com/settings/tokens/new?scopes=repo&description=reef"
        target="_blank"
        rel="noreferrer"
        className="text-brand underline underline-offset-2 hover:text-brand/80"
      >
        Create a token ↗
      </a>
    </p>
  );
}
