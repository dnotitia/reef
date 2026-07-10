"use client";

import { cn } from "@/lib/utils";
import { Check, Minus } from "lucide-react";
import { type ChangeEvent, useEffect, useRef } from "react";

interface IssueSelectionCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  disabled?: boolean;
  className?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
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
    <label
      className={cn(
        "group/checkbox relative -m-2 inline-flex size-8 shrink-0 touch-manipulation cursor-pointer items-center justify-center rounded-md focus-within:ring-2 focus-within:ring-brand/40",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-checked={indeterminate ? "mixed" : checked}
        data-testid={testId}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          event.stopPropagation();
          onChange(event);
        }}
      />
      <span
        aria-hidden="true"
        data-slot="selection-checkbox-indicator"
        className={cn(
          "pointer-events-none flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border bg-elevated transition-[border-color,background-color,color,box-shadow] duration-150",
          checked || indeterminate
            ? "border-brand bg-brand text-brand-foreground"
            : "border-input text-transparent group-hover/checkbox:border-muted-foreground/70",
        )}
      >
        {indeterminate ? (
          <Minus className="size-2.5" strokeWidth={2.75} />
        ) : checked ? (
          <Check className="size-2.5" strokeWidth={2.75} />
        ) : null}
      </span>
      <span className="sr-only">{label}</span>
    </label>
  );
}
