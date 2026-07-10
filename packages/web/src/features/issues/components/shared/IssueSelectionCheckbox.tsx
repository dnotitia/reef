"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

interface IssueSelectionCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  disabled?: boolean;
  className?: string;
  onChange: () => void;
  testId?: string;
}

export function IssueSelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  disabled = false,
  className,
  onChange,
  testId,
}: IssueSelectionCheckboxProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      aria-checked={indeterminate ? "mixed" : checked}
      data-testid={testId}
      className={cn(
        "size-4 shrink-0 cursor-pointer accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        onChange();
      }}
    />
  );
}
