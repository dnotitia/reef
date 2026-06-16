import type { ReactNode } from "react";
import { AccessBadge, type AccessLevel } from "./AccessBadge";

interface SettingsGroupProps {
  title: string;
  /** One-line description of who the group's settings belong to. */
  description: string;
  /**
   * Optional permission badge for the group header. Omit while the viewer's
   * role is still resolving so a wrong "View just" does not flashes for an admin.
   */
  access?: AccessLevel;
  /**
   * Optional scope subject shown beside the title — the workspace these
   * settings belong to. It binds the group back to the Active Workspace
   * selector above so a reader can see *which* workspace these values apply to
   * (REEF-174). Omit (or pass empty) for groups that aren't workspace-scoped,
   * such as personal preferences or deployment.
   */
  scopeName?: string;
  children: ReactNode;
  testId?: string;
}

/**
 * REEF-020 group tier above the existing flat section stack. Makes the
 * ownership model legible — what's team-shared vs personal vs operator-managed
 * — using just a heading, a one-line blurb, a permission badge, and a hairline.
 * The per-setting `<section>`s (with their uppercase headings) compose inside.
 */
export function SettingsGroup({
  title,
  description,
  access,
  scopeName,
  children,
  testId,
}: SettingsGroupProps) {
  return (
    <section className="flex flex-col gap-6" data-testid={testId}>
      <div className="flex flex-col gap-1 border-b border-border-subtle pb-3">
        <div className="flex items-center justify-between gap-3">
          {/* The scope name lives in a sibling span, not inside the <h2>, so the
              heading's accessible name stays exactly the title. */}
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="shrink-0 font-display text-[15px] font-semibold text-foreground">
              {title}
            </h2>
            {scopeName ? (
              <span
                translate="no"
                data-testid="settings-group-scope"
                className="min-w-0 truncate font-display text-[13px] font-medium text-brand"
              >
                {scopeName}
              </span>
            ) : null}
          </div>
          {access ? <AccessBadge level={access} /> : null}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-8">{children}</div>
    </section>
  );
}
