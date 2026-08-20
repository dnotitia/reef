"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useOverlayOpenRegistration } from "./overlayDismiss";

function TooltipProvider({
  delayDuration = 0,
  skipDelayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

function Tooltip({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] =
    React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  // Keep a surrounding Sheet/Dialog open while this child tooltip consumes
  // Escape. Radix's own layer handles the close; this bridge is needed because
  // the parent overlay listens in the capture phase.
  useOverlayOpenRegistration(open);

  return (
    <TooltipPrimitive.Root
      {...props}
      open={open}
      onOpenChange={handleOpenChange}
    />
  );
}

type TooltipTriggerProps = Omit<
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>,
  "aria-describedby"
> & {
  "aria-describedby"?: string | null;
};

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  TooltipTriggerProps
>(function TooltipTrigger(
  { className, "aria-describedby": ariaDescribedBy, ...props },
  ref,
) {
  const triggerProps =
    ariaDescribedBy === undefined
      ? props
      : {
          ...props,
          // Radix's internal value must remain unset when the trigger is not
          // eligible for a tooltip; preserve null at runtime while keeping
          // the primitive's DOM prop type string-compatible.
          "aria-describedby": ariaDescribedBy as unknown as
            | string
            | undefined,
        };
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      className={cn("outline-none", className)}
      {...triggerProps}
    />
  );
});
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent(
  {
    align = "center",
    className,
    collisionPadding = 8,
    side = "top",
    sideOffset = 6,
    ...props
  },
  ref,
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        align={align}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "pointer-events-none z-[110] max-w-[calc(100vw-1rem)] break-words rounded-md border border-border bg-surface-popover px-2.5 py-1.5 text-xs text-foreground shadow-md shadow-foreground/10",
          "data-[state=open]:motion-safe:animate-in data-[state=open]:motion-safe:fade-in-0 data-[state=open]:motion-safe:zoom-in-95 motion-reduce:animate-none",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const TooltipArrow = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Arrow>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Arrow>
>(function TooltipArrow({ className, ...props }, ref) {
  return (
    <TooltipPrimitive.Arrow
      ref={ref}
      className={cn("fill-popover", className)}
      {...props}
    />
  );
});
TooltipArrow.displayName = TooltipPrimitive.Arrow.displayName;

export {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
};
