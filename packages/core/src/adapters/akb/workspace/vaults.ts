import { z } from "zod";
import type { Collaborator } from "../../../schemas/workspace/collaborator";
import { withSpan } from "../core/shared";
import type {
  CreateVaultParams,
  CreateVaultResult,
  GrantVaultMemberParams,
  GrantVaultMemberResult,
  ListVaultMembersParams,
  ListVaultMembersResult,
  ListVaultsParams,
  ListVaultsResult,
  RevokeVaultMemberParams,
  SearchUsersParams,
  SearchUsersResult,
} from "../core/types";

export const VaultMemberSchema = z.object({
  username: z.string(),
  display_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  role: z.string(),
  since: z.string().nullable().optional(),
});

export type VaultMember = z.infer<typeof VaultMemberSchema>;

const VaultMembersResponseSchema = z.object({
  members: z.array(VaultMemberSchema).default([]),
});

/**
 * A user in the global akb directory — what `GET /api/v1/users/search` returns.
 * Distinct from {@link VaultMemberSchema}: it carries no `role` (the user is not
 * yet scoped to any vault) and no avatar (akb has none). Backs the "add a
 * member" picker, which searches the whole directory rather than current
 * members (REEF-179).
 */
export const UserSearchResultSchema = z.object({
  username: z.string(),
  display_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

export type UserSearchResult = z.infer<typeof UserSearchResultSchema>;

const UserSearchResponseSchema = z.object({
  users: z.array(UserSearchResultSchema).default([]),
});

/**
 * akb's grant endpoint echoes the applied grant (`{vault, user, role,
 * granted}`) rather than a full member projection — the caller already holds
 * the display name from its search/roster, so it re-uses that for the optimistic
 * row instead of reading it back here.
 */
const GrantAccessResponseSchema = z.object({
  vault: z.string(),
  user: z.string(),
  role: z.string(),
  granted: z.boolean().optional(),
});

export const VaultSummarySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  has_reef_config: z.boolean().optional(),
});

export type VaultSummary = z.infer<typeof VaultSummarySchema>;

export const EnrichedVaultSummarySchema = VaultSummarySchema.extend({
  has_reef_config: z.boolean(),
});

export type EnrichedVaultSummary = z.infer<typeof EnrichedVaultSummarySchema>;

const VaultListResponseSchema = z.object({
  vaults: z.array(VaultSummarySchema).default([]),
});

const CreateVaultResponseSchema = z.object({
  vault_id: z.string().min(1),
  name: z.string().min(1),
  template: z.string().nullable().optional(),
  public_access: z.string().nullable().optional(),
});

type CreateVaultResponse = z.infer<typeof CreateVaultResponseSchema>;

export async function listVaultMembers(
  params: ListVaultMembersParams,
): Promise<ListVaultMembersResult> {
  const { adapter, vault } = params;
  return withSpan("akb.list_vault_members", { vault }, async (span) => {
    const payload = await adapter.request(
      `/api/v1/vaults/${encodeURIComponent(vault)}/members`,
      { resource: `vault ${vault}` },
    );
    const parsed = VaultMembersResponseSchema.parse(payload);
    span.setAttribute("member_count", parsed.members.length);
    return { members: parsed.members };
  });
}

/**
 * Grant (or, since akb upserts, change) a user's role on a vault. akb requires
 * the caller to be admin/owner and rejects `role: "owner"` — owner is set just
 * through ownership transfer, which is out of scope here (REEF-179). A grant on
 * an existing member is the role-change path (AC3).
 */
export async function grantVaultMember(
  params: GrantVaultMemberParams,
): Promise<GrantVaultMemberResult> {
  const { adapter, vault, user, role } = params;
  return withSpan("akb.grant_vault_member", { vault }, async (span) => {
    const payload = await adapter.request(
      `/api/v1/vaults/${encodeURIComponent(vault)}/grant`,
      { method: "POST", body: { user, role }, resource: `vault ${vault}` },
    );
    const parsed = GrantAccessResponseSchema.parse(payload);
    span.setAttribute("role", parsed.role);
    return { vault: parsed.vault, user: parsed.user, role: parsed.role };
  });
}

/**
 * Revoke a user's access to a vault. akb requires admin/owner and refuses to
 * revoke the owner (surfaced as a 403 → AuthError); the UI keeps the owner row
 * un-removable so the request is does not issued on the normal path (REEF-179).
 */
export async function revokeVaultMember(
  params: RevokeVaultMemberParams,
): Promise<void> {
  const { adapter, vault, user } = params;
  return withSpan("akb.revoke_vault_member", { vault }, async () => {
    await adapter.request(
      `/api/v1/vaults/${encodeURIComponent(vault)}/revoke`,
      { method: "POST", body: { user }, resource: `vault ${vault}` },
    );
  });
}

/**
 * Search the global akb user directory (any authenticated user may call it).
 * This is deliberately NOT the vault-members lookup — the add-member picker should
 * find users who are not yet members, so it queries the whole directory and
 * filters out current members in the UI (REEF-179).
 */
export async function searchUsers(
  params: SearchUsersParams,
): Promise<SearchUsersResult> {
  const { adapter, query, limit } = params;
  return withSpan("akb.search_users", {}, async (span) => {
    const payload = await adapter.request("/api/v1/users/search", {
      query: { q: query?.trim() || undefined, limit: limit ?? undefined },
      resource: "users",
    });
    const parsed = UserSearchResponseSchema.parse(payload);
    span.setAttribute("result_count", parsed.users.length);
    return { users: parsed.users };
  });
}

/**
 * Filter vault members by `username`/`display_name` substring (case
 * insensitive). Shared by the chat tool and `/api/vault-members` so both
 * surfaces apply identical filter semantics.
 */
export function filterVaultMembers(
  members: readonly VaultMember[],
  query: string,
): VaultMember[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [...members];
  return members.filter((m) => {
    if (m.username.toLowerCase().includes(trimmed)) return true;
    return (m.display_name?.toLowerCase() ?? "").includes(trimmed);
  });
}

/**
 * Map an akb `VaultMember` to the existing `Collaborator` wire shape so the
 * AssigneeCombobox UI does not need a new type. akb has no avatars today —
 * `avatar_url` is consistently `null`.
 */
export function vaultMemberToCollaborator(member: VaultMember): Collaborator {
  return {
    login: member.username,
    name: member.display_name ?? member.username,
    avatar_url: null,
  };
}

export async function listVaults(
  params: ListVaultsParams,
): Promise<ListVaultsResult> {
  const { adapter } = params;
  return withSpan("akb.list_vaults", {}, async (span) => {
    const payload = await adapter.request("/api/v1/my/vaults", {
      resource: "vaults",
    });
    const parsed = VaultListResponseSchema.parse(payload);
    span.setAttribute("vault_count", parsed.vaults.length);
    return { vaults: parsed.vaults };
  });
}

export async function createVault(
  params: CreateVaultParams,
): Promise<CreateVaultResult> {
  const { adapter, name, description } = params;
  return withSpan("akb.create_vault", { vault: name }, async (span) => {
    const payload = await adapter.request("/api/v1/vaults", {
      method: "POST",
      query: {
        name,
        description: description || undefined,
        public_access: "none",
      },
      resource: `vault ${name}`,
    });
    const parsed: CreateVaultResponse =
      CreateVaultResponseSchema.parse(payload);
    span.setAttribute("vault_id", parsed.vault_id);
    return {
      vault_id: parsed.vault_id,
      name: parsed.name,
      template: parsed.template ?? null,
      public_access: parsed.public_access ?? null,
    };
  });
}
