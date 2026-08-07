import { PersonOption } from "@/components/fields/PersonOption";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { Collaborator } from "@reef/core";

export function createAssigneeComboboxOption(
  collaborator: Collaborator,
  currentLogin: string | null,
): ComboboxOption<string> {
  const label = collaborator.name?.trim() || collaborator.login;

  return {
    value: collaborator.login,
    label,
    keywords: collaborator.login,
    content: (
      <PersonOption
        login={collaborator.login}
        name={collaborator.name}
        avatarUrl={collaborator.avatar_url}
        currentLogin={currentLogin}
      />
    ),
  };
}
