"use client";

import { Calendar } from "@/components/fields/Calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatDisplayDate,
  isValidIsoDate,
  localTodayIso,
} from "@/features/issues/lib/dateHelpers";
import { dateInputValue } from "@/features/issues/lib/metadataOptions";
import {
  computePanelPlacement,
  findScrollBoundaryRect,
} from "@/lib/panelPlacement";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface DatePickerFieldProps {
  /** Current value as `YYYY-MM-DD` (a fuller ISO timestamp is sliced). */
  value: string;
  /** Called with the new `YYYY-MM-DD`, or "" when cleared. */
  onChange: (value: string) => void;
  id?: string;
  /** Accessible label, e.g. "Start date". */
  label?: string;
  /** Trigger placeholder when empty. */
  placeholder?: string;
  disabled?: boolean;
  /** Horizontal anchoring of the panel; "end" opens leftward. */
  align?: "start" | "end" | "center";
  className?: string;
}

/**
 * Themed date picker that replaces the browser-native `<input type="date">` so
 * the calendar inherits Reef's tokens (and therefore dark mode). Built on the
 * shared Popover with no third-party calendar dependency.
 *
 * Selecting a day, choosing Today, or clearing immediately calls `onChange` and
 * closes the panel — selection is the commit boundary. Direct `YYYY-MM-DD`
 * typing/paste stays available through the panel's text input.
 */
export function DatePickerField({
  value,
  onChange,
  id,
  label,
  placeholder,
  disabled,
  align = "start",
  className,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [panelSide, setPanelSide] = useState<"bottom" | "top">("bottom");
  const [panelAlign, setPanelAlign] =
    useState<DatePickerFieldProps["align"]>(align);
  const locale = useLocale();
  const t = useTranslations("components.datePicker");
  // Hooks can not run in default-parameter position, so the locale-resolved
  // fallbacks for the optional copy props are computed in the body.
  const resolvedLabel = label ?? t("label");
  const resolvedPlaceholder = placeholder ?? t("placeholder");
  const normalized = dateInputValue(value);
  // Readable, locale-formatted trigger label (e.g. `Jun 1, 2026`); the panel's
  // text input keeps raw `YYYY-MM-DD` for direct typing.
  const displayValue = formatDisplayDate(normalized, locale);
  const today = localTodayIso();
  // The last value committed in the current open session, so the focus-out and
  // mouse-close commit paths can both run without firing a duplicate onChange.
  // null = nothing committed yet, kept distinct from "" so a clear still fires.
  const committedRef = useRef<string | null>(null);
  // Set by explicit close actions (select/today/clear/Escape) so the focus-out
  // their unmount emits does not commit a stale/cancelled typed draft.
  const skipBlurCommitRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    const boundary = findScrollBoundaryRect(triggerRef.current);

    const placement = computePanelPlacement({
      trigger,
      panel: { width: panel.width, height: panel.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      boundary: boundary ?? undefined,
      preferredHorizontal: align === "end" ? "end" : "start",
    });
    setPanelSide(placement.vertical === "up" ? "top" : "bottom");
    setPanelAlign(align === "center" ? "center" : placement.horizontal);
  }, [open, align]);

  const commitDraft = useCallback(() => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return false;
    }
    const trimmed = draft.trim();
    if (trimmed === normalized) return false; // no change
    // A non-empty draft should be a valid date; an empty draft means "clear",
    // which is meaningful here because trimmed !== normalized implies a value
    // existed (matching the native input, where emptying the field clears it).
    if (trimmed !== "" && !isValidIsoDate(trimmed)) return false;
    if (committedRef.current === trimmed) return false;
    committedRef.current = trimmed;
    onChange(trimmed);
    return true;
  }, [draft, normalized, onChange]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        // Fresh session: seed the typed-entry buffer and clear commit guards.
        committedRef.current = null;
        skipBlurCommitRef.current = false;
        setDraft(dateInputValue(value));
      } else {
        // Dismiss (mouse click-away / trigger toggle): commit any pending typed
        // value before the panel unmounts, since the closing mousedown can drop
        // the input before its blur fires and silently lose a typed date.
        commitDraft();
      }
      setOpen(next);
    },
    [value, commitDraft],
  );

  // Close after an explicit choice; suppress the unmount focus-out commit so the
  // chosen value is not clobbered by an abandoned typed draft.
  const closeWithoutCommit = useCallback(() => {
    skipBlurCommitRef.current = true;
    setOpen(false);
  }, []);

  const handleSelect = useCallback(
    (iso: string) => {
      onChange(iso);
      closeWithoutCommit();
    },
    [onChange, closeWithoutCommit],
  );

  const handleToday = useCallback(() => {
    onChange(localTodayIso());
    closeWithoutCommit();
  }, [onChange, closeWithoutCommit]);

  const handleClear = useCallback(() => {
    onChange("");
    closeWithoutCommit();
  }, [onChange, closeWithoutCommit]);

  const handleRootKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Handle Escape for the whole picker (focus may still be on the trigger
      // after opening). Stop it here while open so it cancels the picker instead
      // of bubbling out and dismissing an enclosing dialog/sheet.
      if (open && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeWithoutCommit();
      }
    },
    [open, closeWithoutCommit],
  );

  const handleRootBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      // the open picker has a meaningful draft. While closed the draft is
      // stale (it is seeded just on open), so tabbing through the trigger should
      // does not commit — otherwise an empty draft would clear a saved date.
      if (!open) return;
      // Moves between the picker's own controls (input -> calendar/footer/month
      // nav) keep relatedTarget inside the root, so they neither auto-save an
      // intermediate date nor dismiss the panel.
      if (
        e.relatedTarget instanceof Node &&
        e.currentTarget.contains(e.relatedTarget)
      ) {
        return;
      }
      // Focus left the whole picker (e.g. Tab on to the next field): commit any
      // pending typed draft and close, so the calendar does not linger open over
      // the form with focus outside it.
      commitDraft();
      setOpen(false);
    },
    [open, commitDraft],
  );

  const handleDraftKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (commitDraft()) setOpen(false);
      }
    },
    [commitDraft],
  );

  return (
    // The focus-out boundary: committing the typed draft keys off focus leaving
    // this whole wrapper, so tabbing among the picker's own controls does not
    // auto-saves a half-finished date.
    <div
      className={cn("w-full", className)}
      onBlur={handleRootBlur}
      onKeyDown={handleRootKeyDown}
    >
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        className="group w-full"
      >
        <PopoverTrigger
          ref={triggerRef}
          id={id}
          disabled={disabled}
          aria-label={
            normalized ? `${resolvedLabel}: ${displayValue}` : resolvedLabel
          }
          data-testid="date-picker-trigger"
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-elevated pl-2.5 pr-8 text-left text-[13px] text-foreground transition-colors duration-150 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarIcon
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {normalized ? (
            <span className="flex-1 truncate tabular-nums">{displayValue}</span>
          ) : (
            <span className="flex-1 truncate text-muted-foreground">
              {resolvedPlaceholder}
            </span>
          )}
        </PopoverTrigger>

        {normalized && !disabled ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label={t("clearField", { field: resolvedLabel })}
            data-testid="date-picker-clear"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        ) : null}

        <PopoverContent
          ref={panelRef}
          align={panelAlign}
          side={panelSide}
          data-testid="date-picker-panel"
          className="w-64 p-2"
        >
          <input
            type="text"
            inputMode="numeric"
            aria-label={`${resolvedLabel} (YYYY-MM-DD)`}
            placeholder={t("isoFormat")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleDraftKeyDown}
            data-testid="date-picker-input"
            className="mb-2 w-full rounded-md border border-border bg-elevated px-2 py-1 font-mono text-[13px] text-foreground outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />

          <Calendar
            selected={normalized}
            today={today}
            onSelect={handleSelect}
          />

          <div className="mt-2 flex items-center justify-between border-t border-border-subtle pt-2">
            <button
              type="button"
              onClick={handleToday}
              data-testid="date-picker-today"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-brand transition-colors duration-150 hover:bg-surface-hover"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
              {t("today")}
            </button>
            {normalized ? (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
              >
                {t("clear")}
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
