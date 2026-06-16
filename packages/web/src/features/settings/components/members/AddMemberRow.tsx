"use client";

import { Button } from "@/components/ui/button";
import { useGrantMember } from "@/features/settings/hooks/useGrantMember";
import type { UserSearchResult, VaultMember } from "@reef/core";
import { useCallback, useMemo, useState } from "react";
import { DirectorySearchCombobox } from "./DirectorySearchCombobox";
import { type ManageableRole, RoleSelect } from "./RoleSelect";

interface AddMemberRowProps {
  vault: string;
  /** Current roster — used to dim already-members in the picker (O(1) Set). */
  roster: VaultMember[];
  currentLogin: string | null;
  /** Fired after a successful grant with the added member's display name. */
  onAdded?: (name: string) => void;
  onError?: (message: string) => void;
}

/**
 * The admin "Add a member" form (REEF-179): pick a user from the global
 * directory, choose a role, grant. Rendered on a distinct hairline surface so it
 * reads as the compose zone above the plain member list. On success the grant
 * optimistically inserts the row, the form resets, and focus is free to return
 * to the picker for a quick second add.
 */
export function AddMemberRow({
  vault,
  roster,
  currentLogin,
  onAdded,
  onError,
}: AddMemberRowProps) {
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(
    null,
  );
  const [role, setRole] = useState<ManageableRole>("writer");
  const grant = useGrantMember(vault);

  const existingKeys = useMemo(
    () => new Set(roster.map((m) => m.username)),
    [roster],
  );

  const handleAdd = useCallback(() => {
    if (!selectedUser || grant.isPending) return;
    const name = selectedUser.display_name?.trim() || selectedUser.username;
    grant.mutate(
      {
        user: selectedUser.username,
        role,
        displayName: selectedUser.display_name,
      },
      {
        onSuccess: () => {
          onAdded?.(name);
          setSelectedUser(null);
          setRole("writer");
        },
        onError: (err) => onError?.(err.message || "Couldn't add the member."),
      },
    );
  }, [grant, selectedUser, role, onAdded, onError]);

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle/40 p-3"
      data-testid="add-member-row"
    >
      <p className="text-[13px] font-medium text-foreground/90">Add a member</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <DirectorySearchCombobox
            vault={vault}
            selectedUser={selectedUser}
            onSelect={setSelectedUser}
            existingKeys={existingKeys}
            currentLogin={currentLogin}
            disabled={grant.isPending}
          />
        </div>
        <RoleSelect
          value={role}
          name="new member"
          disabled={grant.isPending}
          onChange={setRole}
        />
        <Button
          variant="brand"
          size="sm"
          disabled={!selectedUser || grant.isPending}
          onClick={handleAdd}
          data-testid="add-member-submit"
        >
          {grant.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}
