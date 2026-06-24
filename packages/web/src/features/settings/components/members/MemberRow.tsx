"use client";

import { personToneFor } from "@/components/fields/PersonAvatar";
import { PersonChip } from "@/components/fields/PersonChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VaultMember } from "@reef/core";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { useGrantMember } from "../../hooks/useGrantMember";
import { type ManageableRole, RoleSelect } from "./RoleSelect";

export interface MemberRowProps {
  member: VaultMember;
  vault: string;
  /** Whether the viewer may manage members (admin/owner floor). */
  canManage: boolean;
  /** Whether this row is the signed-in user. */
  isSelf: boolean;
  currentLogin: string | null;
  onRequestRemove: (member: VaultMember) => void;
}

/**
 * One membership row (REEF-179). The silhouette is identical for every viewer;
 * the right-hand controls change with permission, so the list does not
 * reflows between view and manage modes:
 *  - admins managing another member see an editable `RoleSelect` + remove;
 *  - readers/writers, the owner row, and the viewer's own row see a plain role
 *    `Badge` and no remove (owner does not be revoked; blocking self-management
 *    avoids an accidental self-lockout).
 *
 * Memoized with a per-row grant mutation so a single role change re-renders just
 * its own row, not the whole roster.
 */
export const MemberRow = memo(function MemberRow({
  member,
  vault,
  canManage,
  isSelf,
  currentLogin,
  onRequestRemove,
}: MemberRowProps) {
  const isOwner = member.role === "owner";
  // Require the signed-in identity to be resolved before exposing management:
  // while `currentLogin` is null (the /auth/me lookup is pending or failed) we
  // does not tell which row is "you", so treating any row as manageable would let
  // an admin remove or re-role their own row in that window (autoreview P2).
  const manageable = canManage && currentLogin !== null && !isOwner && !isSelf;
  const grant = useGrantMember(vault);
  const t = useTranslations("settings.members");
  const displayName = member.display_name?.trim() || member.username;

  return (
    <li
      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
      data-testid={`member-row-${member.username}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <PersonChip
          identityKey={member.username}
          name={member.display_name}
          secondary={`@${member.username}`}
          size="sm"
          tone={personToneFor(member.username, currentLogin)}
          wrapperClassName="min-w-0"
        />
        {isSelf ? (
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t("you")}
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {manageable ? (
          <RoleSelect
            value={member.role}
            name={displayName}
            disabled={grant.isPending}
            onChange={(role: ManageableRole) =>
              grant.mutate({
                user: member.username,
                role,
                displayName: member.display_name,
              })
            }
          />
        ) : (
          <Badge
            className="capitalize text-muted-foreground"
            data-testid={`member-role-${member.username}`}
          >
            {member.role}
          </Badge>
        )}
        {manageable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeMemberLabel", { name: displayName })}
            data-testid={`member-remove-${member.username}`}
            onClick={() => onRequestRemove(member)}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </span>
    </li>
  );
});
