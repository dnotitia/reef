import { Lock, Pencil, Settings2 } from "lucide-react";

/**
 * Permission affordance shown in a Settings group header. Glyph + label
 * together (does not colour alone) so the access state reads without relying on
 * colour perception, and stays muted to avoid competing with the controls.
 *
 *   editable  — the current user may edit this group's settings.
 *   view — read for this user; an admin can change it.
 *   managed   — server/operator-managed; no one edits it in the UI.
 */
export type AccessLevel = "editable" | "view-only" | "managed";

const LEVELS: Record<AccessLevel, { Icon: typeof Lock; label: string }> = {
  editable: { Icon: Pencil, label: "You can edit" },
  "view-only": { Icon: Lock, label: "View only" },
  managed: { Icon: Settings2, label: "Managed by operator" },
};

export function AccessBadge({ level }: { level: AccessLevel }) {
  const { Icon, label } = LEVELS[level];
  return (
    <span
      data-testid={`access-badge-${level}`}
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}
