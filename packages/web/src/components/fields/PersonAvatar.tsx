import { cn } from "@/lib/utils";
import { memo } from "react";
import { AVATAR_BRAND, AVATAR_FG, AVATAR_TONES } from "./fieldKit";
import { resolveIdentity } from "./personIdentity";

/**
 * PersonAvatar — the shared people leaf (REEF-093). One of three renders:
 * a real `avatar_url` image, a name-colored monogram (the akb default, since
 * akb collaborators have no avatar image), or a dashed ghost when no one is
 * assigned. Color and glyph both derive from `identityKey` (the login) so a
 * person looks identical on every surface. No `"use client"`: it is pure and
 * stays out of the client bundle when a Server Component renders it.
 */

export type PersonAvatarSize = "xs" | "sm" | "md" | "lg";
export type PersonTone = "identity" | "brand";

/**
 * Pick a person's tone: the brand tint marks the signed-in user ("this is
 * you"), and everyone else keeps their hashed identity color. Centralized here
 * so every people surface — board cards, list rows, the assignee picker, the
 * sidebar account — derives the signal one way. Pure: the caller passes the
 * current login (from `useCurrentUserLogin`), keeping this leaf React-free.
 * Both arguments are the akb login — the identifier issue rows store in
 * `assigned_to`, which the vault-members adapter maps from a member's username.
 */
export function personToneFor(
  identityKey: string | null | undefined,
  currentLogin: string | null | undefined,
): PersonTone {
  const key = identityKey?.trim();
  const me = currentLogin?.trim();
  return key && me && key === me ? "brand" : "identity";
}

// xs board · sm list/picker · md sidebar-expanded · lg sidebar-collapsed.
const SIZE_CLASS: Record<PersonAvatarSize, string> = {
  xs: "size-4 rounded text-[8.5px]",
  sm: "size-5 rounded-[5px] text-[10px]",
  md: "size-7 rounded-md text-[11px]",
  lg: "size-9 rounded-md text-[12px]",
};

const FILLED_BASE =
  "inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold leading-none ring-1 ring-border";

const GHOST_BASE =
  "inline-flex shrink-0 items-center justify-center border border-dashed border-border bg-transparent";

export interface PersonAvatarProps {
  /** Stable identity key (login) — the single source of color and glyph. */
  identityKey: string | null | undefined;
  /** Display name; used for the accessible label / tooltip, not the glyph. */
  name?: string | null;
  /** Real avatar image; rendered over the tint when present (rare on akb). */
  avatarUrl?: string | null;
  size?: PersonAvatarSize;
  /** "brand" keeps the current user teal; "identity" hashes the key to a tone. */
  tone?: PersonTone;
  /** Hide from the a11y tree when an adjacent label already names the person. */
  decorative?: boolean;
  className?: string;
}

export const PersonAvatar = memo(function PersonAvatar({
  identityKey,
  name,
  avatarUrl,
  size = "sm",
  tone = "identity",
  decorative = false,
  className,
}: PersonAvatarProps) {
  const key = identityKey?.trim() ?? "";
  const label = name?.trim() || identityKey?.trim() || "Unassigned";
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": label } as const);

  // No assignee — a dashed ghost, does not the old solid gray dot.
  if (!key) {
    return (
      <span {...a11y} className={cn(GHOST_BASE, SIZE_CLASS[size], className)} />
    );
  }

  const { initials, hash } = resolveIdentity(key);
  const tint =
    tone === "brand"
      ? AVATAR_BRAND
      : cn(AVATAR_TONES[hash % AVATAR_TONES.length], AVATAR_FG);

  return (
    <span
      {...a11y}
      title={label}
      className={cn(FILLED_BASE, SIZE_CLASS[size], tint, className)}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
});
