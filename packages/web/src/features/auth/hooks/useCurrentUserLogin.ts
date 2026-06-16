"use client";

import { useCurrentUser } from "./useCurrentUser";

/**
 * The signed-in user's akb login (username), or null when logged out.
 *
 * This is the identity key issue rows store in `assigned_to` / `requester` /
 * `reporter` — the vault-members adapter maps a member's akb username straight
 * to `login` — so comparing it against an avatar's `identityKey` tells a people
 * surface whether it is rendering the current user. That comparison feeds the
 * brand "this is you" avatar tone (`personToneFor`). Reuses the shared
 * `useCurrentUser` query, so every caller dedupes to one `/auth/me` fetch.
 */
export function useCurrentUserLogin(): string | null {
  const { data } = useCurrentUser();
  return data?.username?.trim() || null;
}
