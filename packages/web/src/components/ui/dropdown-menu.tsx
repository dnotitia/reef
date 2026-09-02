"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useOverlayOpenRegistration } from "./overlayDismiss";

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue>({
  open: false,
  setOpen: () => undefined,
});

type DropdownMenuRootProps = React.ComponentProps<
  typeof DropdownMenuPrimitive.Root
> & {
  className?: string;
};

function DropdownMenu({
  children,
  className,
  defaultOpen = false,
  modal = false,
  onOpenChange,
  open: controlledOpen,
  ...props
}: DropdownMenuRootProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  // Keep the surrounding Sheet/Dialog from consuming Escape before the menu's
  // own Radix layer closes. Outside a parent overlay this registration is a
  // no-op, so standalone menus keep their normal dismissal behavior.
  useOverlayOpenRegistration(open);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <DropdownMenuPrimitive.Root
        {...props}
        defaultOpen={undefined}
        modal={modal}
        open={open}
        onOpenChange={setOpen}
      >
        <div className={cn("relative inline-block", className)}>{children}</div>
      </DropdownMenuPrimitive.Root>
    </DropdownMenuContext.Provider>
  );
}

const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(function DropdownMenuTrigger({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      className={cn("inline-flex items-center", className)}
      {...props}
    />
  );
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent(
  {
    align = "start",
    children,
    className,
    collisionPadding = 8,
    loop = true,
    side = "bottom",
    sideOffset = 4,
    ...props
  },
  ref,
) {
  const { open } = React.useContext(DropdownMenuContext);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const composedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  React.useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      const content = contentRef.current;
      if (!content || content.dataset.state !== "open") return;
      const item = content.querySelector<HTMLElement>(
        '[data-selected="true"]:not([data-disabled]), [aria-checked="true"]:not([data-disabled]), [aria-current="true"]:not([data-disabled]), [role^="menuitem"]:not([data-disabled])',
      );
      item?.focus({ preventScroll: true });
    });
  }, [open]);

  return (
    <DropdownMenuPrimitive.Content
      ref={composedRef}
      align={align}
      collisionPadding={collisionPadding}
      loop={loop}
      side={side}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-[calc(100vw-1rem)] min-w-[180px] rounded-md border border-border bg-surface-popover p-1 text-foreground shadow-lg shadow-foreground/5 outline-none",
        "data-[state=open]:motion-safe:animate-in data-[state=open]:motion-safe:fade-in-0 data-[state=open]:motion-safe:zoom-in-95 motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Content>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

type DropdownMenuItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
> & {
  /** Optional leading slot shared by action and selection rows. */
  leading?: React.ReactNode;
  /** Optional trailing state/action slot shared by menu rows. */
  trailing?: React.ReactNode;
  /** Keep the menu open after this item is selected. */
  keepOpen?: boolean;
  /** Apply the destructive action treatment. */
  destructive?: boolean;
  /** Add a visible and machine-readable selected marker. */
  selected?: boolean;
};

const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps
>(function DropdownMenuItem(
  {
    children,
    className,
    destructive,
    keepOpen = false,
    leading,
    onSelect,
    selected,
    trailing,
    "aria-current": ariaCurrent,
    ...props
  },
  ref,
) {
  const content =
    leading !== undefined || trailing !== undefined ? (
      <>
        {leading !== undefined ? (
          <span className="flex shrink-0 items-center" aria-hidden="true">
            {leading}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">{children}</span>
        {trailing !== undefined ? (
          <span className="flex shrink-0 items-center">{trailing}</span>
        ) : null}
      </>
    ) : (
      children
    );

  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      aria-current={ariaCurrent ?? (selected ? "true" : undefined)}
      data-selected={selected || undefined}
      {...props}
      onSelect={(event) => {
        if (keepOpen) event.preventDefault();
        onSelect?.(event);
      }}
      className={cn(
        "flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left type-control text-foreground outline-none transition-colors duration-150",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground focus-visible:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "data-[selected=true]:font-medium",
        destructive &&
          "text-destructive-text data-[highlighted]:bg-destructive-fill/10 data-[highlighted]:text-destructive-text",
        className,
      )}
    >
      {content}
    </DropdownMenuPrimitive.Item>
  );
});
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

type DropdownMenuCheckboxItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.CheckboxItem
> & {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  keepOpen?: boolean;
};

const DropdownMenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuCheckboxItemProps
>(function DropdownMenuCheckboxItem(
  {
    checked = false,
    children,
    className,
    keepOpen = false,
    leading,
    onSelect,
    trailing,
    ...props
  },
  ref,
) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      checked={checked}
      {...props}
      onSelect={(event) => {
        if (keepOpen) event.preventDefault();
        onSelect?.(event);
      }}
      className={cn(
        "relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-left type-control text-foreground outline-none transition-colors duration-150",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground focus-visible:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "data-[state=checked]:font-medium",
        className,
      )}
    >
      {leading !== undefined ? (
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
      {trailing !== undefined ? (
        <span className="flex shrink-0 items-center">{trailing}</span>
      ) : null}
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center text-brand-text">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
});
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;

function DropdownMenuGroup(
  props: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>,
) {
  return <DropdownMenuPrimitive.Group {...props} />;
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "type-card-metadata px-2 py-1 font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border-subtle", className)}
      {...props}
    />
  );
}

type DropdownMenuRadioItemProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioItem
> & {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  keepOpen?: boolean;
};

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuRadioItemProps
>(function DropdownMenuRadioItem(
  {
    children,
    className,
    keepOpen = false,
    leading,
    onSelect,
    trailing,
    ...props
  },
  ref,
) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      {...props}
      onSelect={(event) => {
        if (keepOpen) event.preventDefault();
        onSelect?.(event);
      }}
      className={cn(
        "relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-left type-control text-foreground outline-none transition-colors duration-150",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground focus-visible:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      {leading !== undefined ? (
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
      {trailing !== undefined ? (
        <span className="flex shrink-0 items-center">{trailing}</span>
      ) : null}
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center text-brand-text">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.RadioItem>
  );
});
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

function DropdownMenuItemIndicator(
  props: React.ComponentPropsWithoutRef<
    typeof DropdownMenuPrimitive.ItemIndicator
  >,
) {
  return <DropdownMenuPrimitive.ItemIndicator {...props} />;
}

function DropdownMenuSub(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>,
) {
  return <DropdownMenuPrimitive.Sub {...props} />;
}

type DropdownMenuSubTriggerProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubTrigger
> & { leading?: React.ReactNode };

const DropdownMenuSubTrigger = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSubTriggerProps
>(function DropdownMenuSubTrigger(
  { children, className, leading, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        "flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left type-control text-foreground outline-none transition-colors duration-150",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground focus-visible:bg-surface-hover",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {leading !== undefined ? (
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRight aria-hidden="true" className="ml-auto size-3.5" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, loop = true, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      loop={loop}
      sideOffset={4}
      collisionPadding={8}
      className={cn(
        "z-50 max-w-[calc(100vw-1rem)] min-w-[13rem] rounded-md border border-border bg-surface-popover p-1 text-foreground shadow-lg shadow-foreground/5 outline-none",
        "data-[state=open]:motion-safe:animate-in data-[state=open]:motion-safe:fade-in-0 data-[state=open]:motion-safe:zoom-in-95 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
});
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

function useDropdownMenu(): DropdownMenuContextValue {
  return React.useContext(DropdownMenuContext);
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useDropdownMenu,
};
