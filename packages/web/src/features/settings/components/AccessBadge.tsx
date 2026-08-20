import { Lock, Pencil, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";

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

const LEVELS: Record<
  AccessLevel,
  {
    Icon: typeof Lock;
    labelKey: "accessEditable" | "accessViewOnly" | "accessManaged";
  }
> = {
  editable: { Icon: Pencil, labelKey: "accessEditable" },
  "view-only": { Icon: Lock, labelKey: "accessViewOnly" },
  managed: { Icon: Settings2, labelKey: "accessManaged" },
};

export function AccessBadge({ level }: { level: AccessLevel }) {
  const t = useTranslations("settings.misc");
  const { Icon, labelKey } = LEVELS[level];
  return (
    <span
      data-testid={`access-badge-${level}`}
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {t(labelKey)}
    </span>
  );
}
