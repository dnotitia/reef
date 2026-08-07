import { PersonAvatar, personToneFor } from "./PersonAvatar";

export interface PersonOptionProps {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  currentLogin: string | null;
}

/**
 * Shared option body for person selectors. Selection state and combobox chrome
 * stay with the primitive; this leaf owns the person's avatar, identity tone,
 * readable name/login hierarchy, and truncation.
 */
export function PersonOption({
  login,
  name,
  avatarUrl,
  currentLogin,
}: PersonOptionProps) {
  const trimmedLogin = login.trim();
  const trimmedName = name?.trim() || null;
  const hasDistinctName = Boolean(trimmedName && trimmedName !== trimmedLogin);

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <PersonAvatar
        identityKey={trimmedLogin}
        name={trimmedName}
        avatarUrl={avatarUrl}
        size="sm"
        tone={personToneFor(trimmedLogin, currentLogin)}
        decorative
      />
      <span className="truncate">{trimmedName ?? trimmedLogin}</span>
      {hasDistinctName ? (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          @{trimmedLogin}
        </span>
      ) : null}
    </span>
  );
}
