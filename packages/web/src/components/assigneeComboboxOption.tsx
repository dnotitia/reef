import { PersonAvatar, personToneFor } from "@/components/fields/PersonAvatar";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { Collaborator } from "@reef/core";

export function createAssigneeComboboxOption(
  collaborator: Collaborator,
  currentLogin: string | null,
): ComboboxOption<string> {
  const label = collaborator.name ?? collaborator.login;

  return {
    value: collaborator.login,
    label,
    keywords: collaborator.login,
    content: (
      <>
        <PersonAvatar
          identityKey={collaborator.login}
          name={collaborator.name ?? undefined}
          avatarUrl={collaborator.avatar_url}
          size="sm"
          tone={personToneFor(collaborator.login, currentLogin)}
          decorative
        />
        <span className="truncate">{label}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          @{collaborator.login}
        </span>
      </>
    ),
  };
}
