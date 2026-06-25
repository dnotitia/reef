import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Accessible on/off toggle (`role="switch"`). A plain button rather than a
 * checkbox so it carries `aria-checked` and the design system's focus ring; the
 * caller owns the bound boolean and the localized accessible name (pass
 * `aria-label` or `aria-labelledby`).
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        data-slot="switch"
        data-state={checked ? "checked" : "unchecked"}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand" : "bg-border",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-150",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };
export type { SwitchProps };
