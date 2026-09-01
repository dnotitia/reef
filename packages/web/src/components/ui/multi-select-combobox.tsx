"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Command as CommandPrimitive, useCommandState } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import type { ComboboxOption } from "./combobox";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "./command";
import {
  CBX_CHECK,
  CBX_CHEVRON,
  CBX_EMPTY,
  CBX_LIST,
  CBX_OPTION_BASE,
  CBX_OPTION_ROW,
  CBX_PANEL,
  CBX_PANEL_POSITIONED,
  CBX_SEARCH,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "./comboboxChrome";
import { SearchProgressBar } from "./SearchProgressBar";
import { useComboboxPlacement } from "./useComboboxPlacement";

function optionCommandValue(value: string): string {
  return `option:${value}`;
}

const AUXILIARY_COMMAND_VALUE = "auxiliary-option";

interface AuxiliaryOption {
  label: string;
  selected: boolean;
  onToggle: (checked: boolean) => void;
  testId?: string;
  content?: ReactNode;
}

interface MultiSelectComboboxProps<T extends string> {
  label: string;
  values: readonly T[] | undefined;
  onToggle: (value: T, checked: boolean) => void;
  options: ReadonlyArray<ComboboxOption<T>>;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  searchable?: boolean;
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  emptyState?: ReactNode;
  ariaLabel?: string;
  triggerTestId?: string;
  contentTestId?: string;
  align?: "start" | "end";
  className?: string;
  contentClassName?: string;
  optionClassName?: string;
  summarizeValue?: (value: T) => string;
  /** A filter-only choice that has its own state instead of a T value. */
  auxiliaryOption?: AuxiliaryOption;
}

function facetSummary<T extends string>(
  values: readonly T[] | undefined,
  summarizeValue?: (value: T) => string,
  auxiliaryOption?: AuxiliaryOption,
): string {
  const count = (values?.length ?? 0) + (auxiliaryOption?.selected ? 1 : 0);
  if (count === 0) return "";
  if (count === 1) {
    if (auxiliaryOption?.selected && !values?.length) {
      return ` (${auxiliaryOption.label})`;
    }
    const value = values?.[0];
    if (value === undefined) return ` (${auxiliaryOption?.label ?? ""})`;
    return ` (${summarizeValue ? summarizeValue(value) : value})`;
  }
  return ` (${count})`;
}

export function MultiSelectCombobox<T extends string>({
  label,
  values,
  onToggle,
  options,
  active,
  disabled,
  loading,
  searchable,
  onQueryChange,
  searchPlaceholder,
  emptyState,
  ariaLabel,
  triggerTestId,
  contentTestId,
  align = "start",
  className,
  contentClassName,
  optionClassName,
  summarizeValue,
  auxiliaryOption,
}: MultiSelectComboboxProps<T>) {
  const t = useTranslations("components.combobox");
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rows = loading ? [] : options;
  const showAuxiliaryOption =
    auxiliaryOption && (!searchable || !query.trim());
  const defaultCommandValue = auxiliaryOption?.selected
    ? AUXILIARY_COMMAND_VALUE
    : optionCommandValue(
        rows.find((option) => values?.includes(option.value) && !option.disabled)
          ?.value ?? rows.find((option) => !option.disabled)?.value ?? "",
      );
  const placement = useComboboxPlacement({
    open,
    align,
    triggerRef,
    panelRef,
    measureKey: `${rows.length}:${query}:${loading ? 1 : 0}`,
  });

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) {
        setQuery("");
        onQueryChange?.("");
      }
    },
    [onQueryChange],
  );

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next)} className={className}>
      <PopoverTrigger
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        disabled={disabled}
        aria-haspopup="dialog"
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          CBX_TRIGGER_CHIP,
          active ? CBX_TRIGGER_CHIP_ACTIVE : CBX_TRIGGER_CHIP_INACTIVE,
        )}
      >
        {label}
        {facetSummary(values, summarizeValue, auxiliaryOption)}
        <ChevronDown data-open={open} className={CBX_CHEVRON} />
      </PopoverTrigger>

      <PopoverContent
        ref={panelRef}
        role="dialog"
        aria-label={ariaLabel ?? label}
        data-testid={contentTestId}
        align={placement.horizontal}
        side={placement.vertical === "up" ? "top" : "bottom"}
        initialFocus={() => (searchable ? searchRef.current : commandRef.current)}
        className={cn(
          CBX_PANEL,
          CBX_PANEL_POSITIONED,
          "min-w-[12rem]",
          contentClassName,
        )}
      >
        <Command
          ref={commandRef}
          label={ariaLabel ?? label}
          defaultValue={defaultCommandValue}
          shouldFilter={searchable && !onQueryChange}
          loop
          className="overflow-visible bg-transparent"
        >
          {searchable ? (
            <CommandPrimitive.Input
              ref={searchRef}
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                onQueryChange?.(next);
              }}
              placeholder={searchPlaceholder ?? t("searchPlaceholder")}
              className={CBX_SEARCH}
            />
          ) : null}
          <CommandList
            label={ariaLabel ?? label}
            aria-multiselectable="true"
            className={cn(CBX_LIST, "relative")}
          >
            <SearchProgressBar
              active={Boolean(loading)}
              className="sticky top-0 bottom-auto"
            />
            {showAuxiliaryOption ? (
              <CommandItem
                value={AUXILIARY_COMMAND_VALUE}
                keywords={[auxiliaryOption.label]}
                aria-checked={auxiliaryOption.selected}
                data-checked={auxiliaryOption.selected}
                data-testid={auxiliaryOption.testId}
                onSelect={() =>
                  auxiliaryOption.onToggle(!auxiliaryOption.selected)
                }
                className={cn(
                  CBX_OPTION_BASE,
                  optionClassName ?? CBX_OPTION_ROW,
                  "data-[selected=true]:bg-surface-hover data-[selected=true]:text-foreground",
                )}
              >
                {auxiliaryOption.content ?? <span>{auxiliaryOption.label}</span>}
                {auxiliaryOption.selected ? (
                  <Check className={CBX_CHECK} aria-hidden />
                ) : null}
              </CommandItem>
            ) : null}
            {rows.map((option) => {
              const selected = values?.includes(option.value) ?? false;
              return (
                <CommandItem
                  key={option.value}
                  value={optionCommandValue(option.value)}
                  keywords={[option.label, option.keywords ?? ""]}
                  disabled={option.disabled}
                  aria-checked={selected}
                  data-checked={selected}
                  data-testid={option.testId}
                  onSelect={() => onToggle(option.value, !selected)}
                  className={cn(
                    CBX_OPTION_BASE,
                    optionClassName ?? CBX_OPTION_ROW,
                    "data-[selected=true]:bg-surface-hover data-[selected=true]:text-foreground",
                  )}
                >
                  {option.content}
                  {selected ? <Check className={CBX_CHECK} aria-hidden /> : null}
                </CommandItem>
              );
            })}
            {loading ? <p className={CBX_EMPTY}>{t("loading")}</p> : null}
            {!loading ? (
              <CommandEmpty className={CBX_EMPTY}>
                {emptyState ?? t("noResults")}
              </CommandEmpty>
            ) : null}
          </CommandList>
          {searchable ? <ResultCount query={query} /> : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ResultCount({ query }: { query: string }) {
  const t = useTranslations("components.combobox");
  const count = useCommandState((state) => state.filtered.count);
  return (
    <span aria-live="polite" className="sr-only">
      {query.trim() ? t("resultCount", { count }) : ""}
    </span>
  );
}
