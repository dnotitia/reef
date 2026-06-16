import { cn } from "@/lib/utils";
import { memo } from "react";
import { PersonAvatar, type PersonAvatarProps } from "./PersonAvatar";

/**
 * PersonChip — PersonAvatar plus the person's name (REEF-093). The avatar is
 * decorative here; the visible label is the accessible name. Used wherever a
 * person needs a readable row: list rows, the picker's options, the picker
 * trigger. When there is no identity it shows the dashed ghost + a muted
 * fallback label.
 */

export interface PersonChipProps extends PersonAvatarProps {
  /** Trailing muted text, e.g. "@login". */
  secondary?: string | null;
  /** Shown (muted) when no one is assigned. */
  fallbackLabel?: string;
  /** Classes for the chip wrapper (the avatar uses `className`). */
  wrapperClassName?: string;
}

export const PersonChip = memo(function PersonChip({
  secondary,
  fallbackLabel = "—",
  wrapperClassName,
  className,
  ...avatar
}: PersonChipProps) {
  const hasIdentity = Boolean(avatar.identityKey?.trim());
  const label =
    avatar.name?.trim() || avatar.identityKey?.trim() || fallbackLabel;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        wrapperClassName,
      )}
    >
      <PersonAvatar {...avatar} decorative className={className} />
      <span
        className={cn(
          "truncate",
          hasIdentity ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {secondary ? (
        <span className="shrink-0 text-muted-foreground">{secondary}</span>
      ) : null}
    </span>
  );
});
