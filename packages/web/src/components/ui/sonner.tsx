"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toast surface for mutation feedback.
 *
 * Mounted once at the root layout. Components emit toasts via
 * `import { toast } from "sonner"`:
 *
 *   toast.success("Issue REEF-042 created");
 *   toast.error(err.message);
 *
 * Theme: follows the user's OS preference via `theme="system"`. The CSS tokens
 * below pull from globals.css so light + dark stay consistent with the rest
 * of the shell. Sonner injects its own stylesheet on the client; the strict
 * CSP in `proxy.ts` allows `style-src 'self' 'unsafe-inline'` so this works
 * without a nonce.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      richColors={false}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error:
            "group-[.toaster]:!border-destructive/40 group-[.toaster]:!bg-destructive/5 group-[.toaster]:!text-destructive",
        },
      }}
      {...props}
    />
  );
}
