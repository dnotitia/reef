"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useId, useRef, useState } from "react";

interface LabelChipInputProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function LabelChipInput({
  value,
  onChange,
  id,
  placeholder = "Add a label…",
  disabled = false,
  className,
  "data-testid": testId,
}: LabelChipInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  function addLabels(parts: string[]) {
    if (parts.length === 0) return;
    const next = [...value];
    const seen = new Set(next.map((l) => l.toLowerCase()));
    for (const raw of parts) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(trimmed);
    }
    if (next.length !== value.length) onChange(next);
  }

  function commitDraft() {
    if (!draft.trim()) return;
    addLabels([draft]);
    setDraft("");
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (next.includes(",")) {
      const parts = next.split(",");
      const remainder = parts.pop() ?? "";
      addLabels(parts);
      setDraft(remainder);
    } else {
      setDraft(next);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // CJK IME: don't intercept Enter while composing — the IME needs it to
    // confirm the in-flight syllable/candidate.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the inline <input> handles all keyboard input; clicking the wrapper just refocuses it
    <div
      className={cn(
        "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-border bg-elevated px-1.5 py-1 text-[13px] text-foreground transition-colors duration-150",
        "focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((label, i) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-foreground"
        >
          {label}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeAt(i);
            }}
            disabled={disabled}
            className="-mr-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed"
            aria-label={`Remove label ${label}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={inputId}
        data-testid={testId}
        type="text"
        value={draft}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        placeholder={value.length === 0 ? placeholder : undefined}
        disabled={disabled}
        // Labels are free-form tokens, not prose: suppress the browser's
        // spellcheck underline and autofill suggestions so the field reads as a
        // tag entry everywhere this control is reused.
        autoComplete="off"
        spellCheck={false}
        className="min-w-[6rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-[13px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}
