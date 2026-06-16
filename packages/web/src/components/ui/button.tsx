import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant =
  | "default"
  | "brand"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon" | "icon-sm";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  brand: "bg-brand text-brand-foreground hover:opacity-90",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
  outline:
    "border border-border bg-elevated text-foreground hover:bg-surface-hover",
  secondary: "bg-secondary text-secondary-foreground hover:bg-surface-hover",
  ghost: "text-foreground hover:bg-surface-hover",
  link: "text-brand underline-offset-4 hover:underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-8 px-3 text-[13px]",
  sm: "h-7 rounded-md px-2.5 text-xs",
  lg: "h-9 rounded-md px-5 text-sm",
  icon: "h-8 w-8",
  "icon-sm": "h-7 w-7",
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      // asChild is accepted but not implemented (no Radix Slot) — enough for our usage
      asChild: _asChild,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        data-slot="button"
        className={cn(
          "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
export type { ButtonProps };
