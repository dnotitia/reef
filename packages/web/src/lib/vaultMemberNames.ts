import type { VaultMember } from "@reef/core";

type VaultMemberName = Pick<VaultMember, "username" | "display_name">;

/** Current roster label, falling back to the stable username when blank. */
export function vaultMemberDisplayName(member: VaultMemberName): string {
  return member.display_name?.trim() || member.username;
}

/** Resolve a stable username against the current vault roster. */
export function resolveVaultMemberName(
  username: string | null | undefined,
  members: readonly VaultMemberName[],
): string | null {
  if (!username) return null;
  const member = members.find((candidate) => candidate.username === username);
  return member ? vaultMemberDisplayName(member) : username;
}
