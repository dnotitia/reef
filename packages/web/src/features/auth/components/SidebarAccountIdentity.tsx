"use client";

import { PersonAvatar } from "@/components/fields/PersonAvatar";
import { computeInitials } from "@/components/fields/personIdentity";
import type { AkbMeProfile } from "@reef/core";

export interface AccountIdentity {
  readonly name: string;
  readonly email: string | null;
  readonly secondary: string | null;
  readonly initials: string;
  readonly login: string | null;
}

export function deriveIdentity(
  profile: AkbMeProfile | null | undefined,
): AccountIdentity {
  const username = profile?.username?.trim() || null;
  const name = profile?.display_name?.trim() || username || "Account";
  const email = profile?.email?.trim() || null;
  const secondary = email ?? (username && username !== name ? username : null);

  return {
    name,
    email,
    secondary,
    initials: computeInitials(name),
    login: username,
  };
}

interface AccountAvatarProps {
  readonly name: string;
  readonly login: string | null;
  readonly large?: boolean;
}

export function AccountAvatar({ name, login, large }: AccountAvatarProps) {
  return (
    <PersonAvatar
      identityKey={login ?? name}
      name={name}
      tone="brand"
      size={large ? "lg" : "md"}
      decorative
    />
  );
}
