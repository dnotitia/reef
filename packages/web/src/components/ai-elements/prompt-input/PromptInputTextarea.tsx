"use client";

import { InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { ComponentProps, KeyboardEventHandler } from "react";
import { useCallback, useState } from "react";

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

export function PromptInputTextarea({
  onKeyDown,
  className,
  ...props
}: PromptInputTextareaProps) {
  const [isComposing, setIsComposing] = useState(false);
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event);
      if (
        event.defaultPrevented ||
        event.key !== "Enter" ||
        event.shiftKey ||
        isComposing ||
        event.nativeEvent.isComposing
      ) {
        return;
      }
      event.preventDefault();
      const submit = event.currentTarget.form?.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (!submit?.disabled) event.currentTarget.form?.requestSubmit();
    },
    [isComposing, onKeyDown],
  );

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
}
