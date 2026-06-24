"use client";

import {
  addMonths,
  buildMonthGrid,
  formatMonthYear,
  parseIsoDate,
  shiftDays,
  shiftMonths,
  weekdayLabels,
  ymdToIso,
} from "@/features/issues/lib/dateHelpers";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface CalendarProps {
  /** Currently selected day as `YYYY-MM-DD`, or "" when nothing is selected. */
  selected: string;
  /** Today as `YYYY-MM-DD` (injected so the marker and tests share one clock). */
  today: string;
  /** Called with the `YYYY-MM-DD` of the clicked/activated day. */
  onSelect: (iso: string) => void;
  className?: string;
}

function initialView(
  seed: string,
  today: string,
): { year: number; month: number } {
  const parsed = parseIsoDate(seed) ?? parseIsoDate(today);
  if (parsed) return { year: parsed.year, month: parsed.month };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

/**
 * Pure month-grid calendar. Owns just its view month and a roving keyboard
 * focus target; the selected value is controlled by the parent. The popover
 * unmounts this on close, so each open re-seeds the view from `selected`.
 */
function CalendarComponent({
  selected,
  today,
  onSelect,
  className,
}: CalendarProps) {
  const locale = useLocale();
  const t = useTranslations("components.calendar");
  const [view, setView] = useState(() => initialView(selected, today));
  const [focusedIso, setFocusedIso] = useState(() => selected || today);
  const gridRef = useRef<HTMLDivElement>(null);
  // move DOM focus after an explicit arrow-key move — does not on mount, so
  // opening the popover does not yank focus or scroll the page.
  const pendingFocus = useRef(false);

  const grid = useMemo(
    () => buildMonthGrid(view.year, view.month),
    [view.year, view.month],
  );

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-iso="${focusedIso}"]`)
      ?.focus();
  }, [focusedIso]);

  // Page the view AND move the roving-focus target into the new month, so the
  // displayed month consistently has a tabbable day cell (cells are just tabbable
  // when iso === focusedIso). Mouse paging does not steal DOM focus —
  // pendingFocus stays false — it keeps the keyboard entry point valid.
  const changeMonth = useCallback(
    (delta: number) => {
      const cur = parseIsoDate(focusedIso) ?? parseIsoDate(today);
      if (!cur) {
        setView((v) => addMonths(v.year, v.month, delta));
        return;
      }
      const next = shiftMonths(cur, delta);
      setView({ year: next.year, month: next.month });
      setFocusedIso(ymdToIso(next));
    },
    [focusedIso, today],
  );
  const goPrev = useCallback(() => changeMonth(-1), [changeMonth]);
  const goNext = useCallback(() => changeMonth(1), [changeMonth]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const cur = parseIsoDate(focusedIso) ?? parseIsoDate(today);
      if (!cur) return;
      let next: ReturnType<typeof shiftDays> | null = null;
      switch (e.key) {
        case "ArrowLeft":
          next = shiftDays(cur, -1);
          break;
        case "ArrowRight":
          next = shiftDays(cur, 1);
          break;
        case "ArrowUp":
          next = shiftDays(cur, -7);
          break;
        case "ArrowDown":
          next = shiftDays(cur, 7);
          break;
        case "PageUp":
          next = shiftMonths(cur, -1);
          break;
        case "PageDown":
          next = shiftMonths(cur, 1);
          break;
        default:
          return;
      }
      e.preventDefault();
      pendingFocus.current = true;
      setFocusedIso(ymdToIso(next));
      setView({ year: next.year, month: next.month });
    },
    [focusedIso, today],
  );

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          aria-label={t("previousMonth")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span
          aria-live="polite"
          className="text-[13px] font-medium text-foreground"
        >
          {formatMonthYear(view.year, view.month, locale)}
        </span>
        <button
          type="button"
          onClick={goNext}
          aria-label={t("nextMonth")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5" aria-hidden>
        {weekdayLabels(locale).map((w) => (
          <div
            key={w}
            className="flex h-6 items-center justify-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>

      <div ref={gridRef} className="grid grid-cols-7 gap-0.5">
        {grid.map((cell) => {
          const isSelected = cell.iso === selected;
          const isToday = cell.iso === today;
          return (
            <button
              key={cell.iso}
              type="button"
              data-iso={cell.iso}
              data-testid={`calendar-day-${cell.iso}`}
              tabIndex={cell.iso === focusedIso ? 0 : -1}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              aria-label={cell.iso}
              onClick={() => onSelect(cell.iso)}
              onKeyDown={handleKeyDown}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md font-mono text-[13px] tabular-nums transition-colors duration-150",
                isSelected
                  ? "bg-brand text-brand-foreground"
                  : isToday
                    ? "text-brand ring-1 ring-inset ring-brand/50 hover:bg-surface-hover"
                    : cell.inCurrentMonth
                      ? "text-foreground hover:bg-surface-hover"
                      : "text-muted-foreground/40 hover:bg-surface-hover",
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const Calendar = memo(CalendarComponent);
