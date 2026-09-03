import * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<"input">;

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full rounded-md border border-border bg-surface-elevated px-2.5 py-1 type-control text-foreground transition-colors duration-150",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground",
        "focus:outline-none focus:border-brand-focus focus:ring-2 focus:ring-inset focus:ring-brand-focus",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };
