"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  CBX_CHECK,
  CBX_OPTION_BASE,
  CBX_OPTION_HIGHLIGHT,
  CBX_OPTION_ROW,
  CBX_PANEL,
} from "./comboboxChrome";
import { useOverlayOpenRegistration } from "./overlayDismiss";

type ContextMenuRootProps = React.ComponentProps<
  typeof ContextMenuPrimitive.Root
> & {
  defaultOpen?: boolean;
};

function ContextMenu({
  children,
  defaultOpen = false,
  modal = false,
  onOpenChange,
  open: controlledOpen,
  ...props
}: ContextMenuRootProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  useOverlayOpenRegistration(open);

  return (
    <ContextMenuPrimitive.Root
      {...props}
      modal={modal}
      open={open}
      onOpenChange={setOpen}
    >
      {children}
    </ContextMenuPrimitive.Root>
  );
}

type ContextMenuTriggerProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Trigger
> & {
  /**
   * Radix's context-menu trigger also renders a Popper anchor beside its
   * child. That extra element is invalid inside a table section, so table
   * rows use a body-portal trigger while retaining their native DOM position.
   */
  portal?: boolean;
};

function isContextMenuKey(event: React.KeyboardEvent) {
  return (
    (event.key === "F10" && event.shiftKey) ||
    event.key === "ContextMenu" ||
    event.key === "Apps"
  );
}

function dispatchContextMenu(
  trigger: HTMLElement | null,
  clientX: number,
  clientY: number,
) {
  trigger?.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }),
  );
}

const ContextMenuTrigger = React.forwardRef<
  HTMLSpanElement,
  ContextMenuTriggerProps
>(function ContextMenuTrigger(
  {
    className,
    onContextMenu,
    onKeyDown,
    portal = false,
    children,
    asChild,
    ...props
  },
  ref,
) {
  const triggerRef = React.useRef<HTMLSpanElement | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    if (portal) setMounted(true);
  }, [portal]);

  if (portal) {
    const child = React.Children.only(children) as React.ReactElement<{
      className?: string;
      onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
      onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
    }>;
    const childProps = child.props;
    const childClassName = cn(childProps.className, className);

    function handleContextMenu(event: React.MouseEvent<HTMLElement>) {
      childProps.onContextMenu?.(event);
      onContextMenu?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      dispatchContextMenu(triggerRef.current, event.clientX, event.clientY);
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
      childProps.onKeyDown?.(event);
      onKeyDown?.(event);
      if (event.defaultPrevented || !isContextMenuKey(event)) return;

      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      dispatchContextMenu(
        triggerRef.current,
        Math.round(rect.left + Math.min(rect.width, 16)),
        Math.round(rect.top + Math.min(rect.height, 16)),
      );
    }

    const childWithTrigger = React.cloneElement(child, {
      ...props,
      className: childClassName,
      onContextMenu: handleContextMenu,
      onKeyDown: handleKeyDown,
    });

    return (
      <>
        {childWithTrigger}
        {mounted &&
          typeof document !== "undefined" &&
          createPortal(
            <ContextMenuPrimitive.Trigger
              ref={triggerRef}
              aria-hidden="true"
              tabIndex={-1}
              className="pointer-events-none fixed size-px overflow-hidden opacity-0"
              {...props}
            />,
            document.body,
          )}
      </>
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !isContextMenuKey(event)) return;

    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(rect.left + Math.min(rect.width, 16)),
        clientY: Math.round(rect.top + Math.min(rect.height, 16)),
      }),
    );
  }

  return (
    <ContextMenuPrimitive.Trigger
      ref={ref}
      className={cn("select-none", className)}
      asChild={asChild}
      {...props}
      {...(children === undefined ? {} : { children })}
      onKeyDown={handleKeyDown}
    />
  );
});
ContextMenuTrigger.displayName = ContextMenuPrimitive.Trigger.displayName;

type ContextMenuContentWithAutoFocusProps =
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> & {
    /** Radix forwards this FocusScope hook at runtime but omits it from the public context-menu type. */
    onOpenAutoFocus?: (event: Event) => void;
  };

const ContextMenuContentPrimitive =
  ContextMenuPrimitive.Content as unknown as React.ForwardRefExoticComponent<
    ContextMenuContentWithAutoFocusProps & React.RefAttributes<HTMLDivElement>
  >;

const ContextMenuContent = React.forwardRef<
  HTMLDivElement,
  ContextMenuContentWithAutoFocusProps
>(function ContextMenuContent(
  { children, className, loop = true, onOpenAutoFocus, ...props },
  ref,
) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const composedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  function focusInitialItem() {
    const content = contentRef.current;
    if (!content) return;
    const item = content.querySelector<HTMLElement>(
      '[data-selected="true"]:not([data-disabled]), [aria-checked="true"]:not([data-disabled]), [aria-current="true"]:not([data-disabled]), [role^="menuitem"]:not([data-disabled])',
    );
    item?.focus({ preventScroll: true });
  }

  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuContentPrimitive
        ref={composedRef}
        loop={loop}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          focusInitialItem();
        }}
        className={cn(
          "z-50 max-w-[calc(100vw-1rem)] min-w-[180px] rounded-md border border-border bg-surface-popover p-1 text-foreground shadow-lg shadow-foreground/5 outline-none",
          "data-[state=open]:motion-safe:animate-in data-[state=open]:motion-safe:fade-in-0 data-[state=open]:motion-safe:zoom-in-95 motion-reduce:animate-none",
          className,
        )}
        {...props}
      >
        {children}
      </ContextMenuContentPrimitive>
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

type ContextMenuItemProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Item
> & {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  keepOpen?: boolean;
  destructive?: boolean;
  selected?: boolean;
};

const ContextMenuItem = React.forwardRef<HTMLDivElement, ContextMenuItemProps>(
  function ContextMenuItem(
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
      <ContextMenuPrimitive.Item
        ref={ref}
        aria-current={ariaCurrent ?? (selected ? "true" : undefined)}
        data-selected={selected || undefined}
        {...props}
        onSelect={(event) => {
          if (keepOpen) event.preventDefault();
          onSelect?.(event);
        }}
        className={cn(
          "flex min-h-8 select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left type-control text-foreground outline-none transition-colors duration-150",
          "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground focus-visible:bg-surface-hover",
          "data-[disabled]:opacity-50",
          "data-[selected=true]:font-medium",
          destructive &&
            "text-destructive-text data-[highlighted]:bg-destructive-fill/10 data-[highlighted]:text-destructive-text",
          className,
        )}
      >
        {content}
      </ContextMenuPrimitive.Item>
    );
  },
);
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

function ContextMenuGroup(
  props: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Group>,
) {
  return <ContextMenuPrimitive.Group {...props} />;
}

function ContextMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(
        "type-card-metadata px-2 py-1 font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border-subtle", className)}
      {...props}
    />
  );
}

type ContextMenuRadioItemProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.RadioItem
> & {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  keepOpen?: boolean;
};

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  ContextMenuRadioItemProps
>(function ContextMenuRadioItem(
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
    <ContextMenuPrimitive.RadioItem
      ref={ref}
      {...props}
      onSelect={(event) => {
        if (keepOpen) event.preventDefault();
        onSelect?.(event);
      }}
      className={cn(
        CBX_OPTION_BASE,
        CBX_OPTION_ROW,
        CBX_OPTION_HIGHLIGHT,
        "data-[disabled]:opacity-50",
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
      <span className={CBX_CHECK}>
        <ContextMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-3.5" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
    </ContextMenuPrimitive.RadioItem>
  );
});
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

function ContextMenuSub(
  props: React.ComponentProps<typeof ContextMenuPrimitive.Sub>,
) {
  return <ContextMenuPrimitive.Sub {...props} />;
}

type ContextMenuSubTriggerProps = React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.SubTrigger
> & { leading?: React.ReactNode };

const ContextMenuSubTrigger = React.forwardRef<
  HTMLDivElement,
  ContextMenuSubTriggerProps
>(function ContextMenuSubTrigger(
  { children, className, leading, ...props },
  ref,
) {
  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
          "flex min-h-8 select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left type-control text-foreground outline-none transition-colors duration-150",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground focus-visible:bg-surface-hover",
        "data-[disabled]:opacity-50",
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
    </ContextMenuPrimitive.SubTrigger>
  );
});
ContextMenuSubTrigger.displayName =
  ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(function ContextMenuSubContent({ className, loop = true, ...props }, ref) {
  return (
    <ContextMenuPrimitive.SubContent
      ref={ref}
      loop={loop}
      sideOffset={4}
      collisionPadding={8}
      className={cn(
        "max-w-[calc(100vw-1rem)] min-w-[13rem] text-foreground",
        CBX_PANEL,
        "data-[state=open]:motion-safe:animate-in data-[state=open]:motion-safe:fade-in-0 data-[state=open]:motion-safe:zoom-in-95 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
});
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
