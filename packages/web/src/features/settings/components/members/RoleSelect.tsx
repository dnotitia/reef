"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Roles a member can be assigned in the UI. `owner` is excluded — akb refuses
 *  to grant it (ownership moves just via transfer, out of scope). */
export const MANAGEABLE_ROLES = ["reader", "writer", "admin"] as const;
export type ManageableRole = (typeof MANAGEABLE_ROLES)[number];

interface RoleSelectProps {
  value: string;
  /** Person/label this role applies to — folded into the accessible name. */
  name: string;
  disabled?: boolean;
  onChange: (role: ManageableRole) => void;
}

/**
 * Inline role picker for the Members list and add-member form (REEF-179). The
 * closed trigger doubles as the row's role badge — admins see an editable
 * control where readers see a plain `Badge`, so a row keeps the same silhouette
 * across permission levels. Built on the shared `Select` primitive so it matches
 * every other field control.
 */
export function RoleSelect({
  value,
  name,
  disabled,
  onChange,
}: RoleSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as ManageableRole)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="w-28 capitalize"
        aria-label={`Role for ${name}`}
        data-testid="role-select-trigger"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MANAGEABLE_ROLES.map((role) => (
          <SelectItem
            key={role}
            value={role}
            className="capitalize"
            data-testid={`role-option-${role}`}
          >
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
