import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
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
  default: "bg-foreground text-surface-page hover:bg-foreground/90",
  brand: "bg-brand-fill text-brand-on-fill hover:opacity-90",
  destructive: "bg-destructive-fill text-destructive-on-fill hover:opacity-90",
  outline:
    "border border-border bg-surface-elevated text-foreground hover:bg-surface-hover",
  secondary: "bg-secondary text-secondary-foreground hover:bg-surface-hover",
  ghost: "text-foreground hover:bg-surface-hover",
  link: "text-brand-text underline-offset-4 hover:underline",
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
      asChild = false,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-slot="button"
        className={cn(
          "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-1 disabled:pointer-events-none disabled:opacity-50",
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
