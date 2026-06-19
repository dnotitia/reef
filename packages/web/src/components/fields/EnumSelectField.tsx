"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { ReactNode } from "react";

/**
 * Presentational wrapper for an enum `<Select>`: trigger + value + option list
 * (with an optional leading "none" item). It owns the repeated Radix
 * scaffolding (REEF-018 dedup of the inline enum selects). The caller keeps
 * field-specific concerns — value, commit logic in `onValueChange`, and how
 * each option renders via `renderItem` (plain label, status icon, priority dot,
 * …). Generic over the option value type so `renderItem` stays type-safe.
 *
 * The trigger value slot enforces a single-line contract (`select.tsx`:
 * `line-clamp-1` + `flex items-center`), so an option renderer that stacks two
 * lines (label + hint) squishes in the trigger. A caller with such a multi-line
 * `renderItem` passes a compact, trigger-only `renderValue` for the selected
 * value while keeping the rich `renderItem` for the dropdown options — the same
 * split the `<Combobox>`/`AssigneeCombobox` primitive draws between `renderValue`
 * and option `content` (REEF-272). When omitted, the trigger falls back to
 * `renderItem`, so every single-line caller renders unchanged.
 */
interface EnumSelectFieldProps<V extends string> {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly V[];
  renderItem: (value: V) => ReactNode;
  /** Trigger-only display for the selected value. Falls back to `renderItem`. */
  renderValue?: (value: V) => ReactNode;
  placeholder?: string;
  /** Optional leading item for the unset state (e.g. NO_SELECTION → "No priority"). */
  noneOption?: { value: string; label: ReactNode };
  testId?: string;
  ariaLabelledby?: string;
  id?: string;
  disabled?: boolean;
}

export function EnumSelectField<V extends string>({
  value,
  onValueChange,
  options,
  renderItem,
  renderValue,
  placeholder,
  noneOption,
  testId,
  ariaLabelledby,
  id,
  disabled,
}: EnumSelectFieldProps<V>) {
  const renderTrigger = renderValue ?? renderItem;
  const selectedOption = options.find((option) => option === value);
  const selectedContent =
    selectedOption !== undefined
      ? renderTrigger(selectedOption)
      : noneOption?.value === value
        ? noneOption.label
        : placeholder;
  const hasSelectedValue =
    selectedOption !== undefined || noneOption?.value === value;

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        data-testid={testId}
        data-placeholder={hasSelectedValue ? undefined : ""}
        aria-labelledby={ariaLabelledby}
      >
        <span data-slot="select-value">{selectedContent}</span>
      </SelectTrigger>
      <SelectContent>
        {noneOption && (
          <SelectItem value={noneOption.value}>{noneOption.label}</SelectItem>
        )}
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {renderItem(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
