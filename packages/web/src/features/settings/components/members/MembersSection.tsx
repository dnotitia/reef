"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
import { useRevokeMember } from "@/features/settings/hooks/useRevokeMember";
import { useVaultRoster } from "@/features/settings/hooks/useVaultRoster";
import type { VaultMember } from "@reef/core";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { AddMemberRow } from "./AddMemberRow";
import { MemberRow } from "./MemberRow";
import { RemoveMemberDialog } from "./RemoveMemberDialog";

/** Sort key: highest privilege first, then by display name. */
const ROLE_RANK: Record<string, number> = {
  owner: 0,
  admin: 1,
  writer: 2,
  reader: 3,
};

function byRoleThenName(a: VaultMember, b: VaultMember): number {
  const rankA = ROLE_RANK[a.role] ?? 99;
  const rankB = ROLE_RANK[b.role] ?? 99;
  if (rankA !== rankB) return rankA - rankB;
  const nameA = (a.display_name?.trim() || a.username).toLowerCase();
  const nameB = (b.display_name?.trim() || b.username).toLowerCase();
  return nameA.localeCompare(nameB);
}

interface MembersSectionProps {
  vault: string;
  /** Admin/owner floor — gates the add form, role editing, and removal. */
  canManage: boolean;
}

/**
 * Members list + management for Settings → Workspace → Members (REEF-179). The
 * roster query runs for readers too (AC1); `canManage` toggles the
 * management affordances. A single removal dialog and revoke mutation live here;
 * each row owns its own grant mutation so a role change re-renders one row.
 */
export function MembersSection({ vault, canManage }: MembersSectionProps) {
  const { data: members, isPending, isError, error } = useVaultRoster(vault);
  const currentLogin = useCurrentUserLogin();
  const revoke = useRevokeMember(vault);
  const t = useTranslations("settings.members");
  const [removeTarget, setRemoveTarget] = useState<VaultMember | null>(null);
  const [status, setStatus] = useState("");

  const requestRemove = useCallback(
    (member: VaultMember) => setRemoveTarget(member),
    [],
  );

  const confirmRemove = useCallback(() => {
    if (!removeTarget) return;
    const name = removeTarget.display_name?.trim() || removeTarget.username;
    revoke.mutate(removeTarget.username, {
      onSuccess: () => setStatus(t("removed", { name })),
      onError: (err) => setStatus(err.message || t("removeFailed")),
      onSettled: () => setRemoveTarget(null),
    });
  }, [removeTarget, revoke, t]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-2" data-testid="members-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p
        role="alert"
        className="text-sm text-destructive"
        data-testid="members-error"
      >
        {t("loadFailed")} {error.message}
      </p>
    );
  }

  // The isPending/isError early returns narrow `members` to the success-branch
  // value, but default defensively so a later refactor of those guards can not
  // dereference `undefined` (TanStack data is `VaultMember[] | undefined`).
  const roster = members ?? [];
  const sorted = roster.toSorted(byRoleThenName);

  return (
    <div className="flex flex-col gap-4" data-testid="members-section">
      {canManage ? (
        <AddMemberRow
          vault={vault}
          roster={roster}
          currentLogin={currentLogin}
          onAdded={(name) => setStatus(t("added", { name }))}
          onError={setStatus}
        />
      ) : null}

      {sorted.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="members-empty"
        >
          {t("noMembersYet")}
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
          {sorted.map((member) => (
            <MemberRow
              key={member.username}
              member={member}
              vault={vault}
              canManage={canManage}
              isSelf={!!currentLogin && member.username === currentLogin}
              currentLogin={currentLogin}
              onRequestRemove={requestRemove}
            />
          ))}
        </ul>
      )}

      <p
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
        data-testid="members-status"
      >
        {status}
      </p>

      <RemoveMemberDialog
        member={removeTarget}
        vault={vault}
        isPending={revoke.isPending}
        onConfirm={confirmRemove}
        onClose={() => {
          if (!revoke.isPending) setRemoveTarget(null);
        }}
      />
    </div>
  );
}
