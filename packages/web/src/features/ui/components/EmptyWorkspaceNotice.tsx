import Link from "next/link";

/**
 * EmptyWorkspaceNotice — the single shared "no active workspace" empty state.
 *
 * Issues, Planning, Activity, My Work, and Reports all gate on "no vault
 * selected" and used to render this prompt three different ways: two copy
 * variants ("Configure" / "Pick"), two link styles, and three containers
 * (REEF-259). This owns the one canonical copy, one brand link, and a
 * self-centering layout so each caller renders it as the body beneath its
 * `PageHeader`.
 *
 * It is the app-level "no workspace at all" gate, deliberately distinct from
 * the section-level dashed-card empty states (`EmptyState` / `CenteredNotice`)
 * that mean "this section has no rows yet" — so the lighter, centered prompt is
 * the canonical treatment rather than a boxed card.
 *
 * The Settings link is a Next `Link` (client navigation) rather than a raw
 * `<a>`, keeping it consistent with the in-app navigation REEF-262 unifies.
 */
export function EmptyWorkspaceNotice() {
  return (
    <div
      data-testid="empty-workspace-notice"
      className="flex flex-1 items-center justify-center px-6 py-12"
    >
      <p className="text-sm text-muted-foreground">
        Pick a workspace in{" "}
        <Link href="/settings" className="text-brand underline">
          Settings
        </Link>{" "}
        to get started.
      </p>
    </div>
  );
}
