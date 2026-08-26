"use client";

import {
  OverflowTooltip,
  useTextOverflow,
} from "@/components/ui/overflow-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Command as CommandPrimitive, useCommandState } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode, Ref } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
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
  CBX_OPTION_MUTED,
  CBX_OPTION_ROW,
  CBX_PANEL,
  CBX_PANEL_POSITIONED,
  CBX_SEARCH,
  CBX_TRIGGER_ACTIVE,
  CBX_TRIGGER_BUTTON,
  CBX_TRIGGER_FIELD,
} from "./comboboxChrome";
import { SearchProgressBar } from "./SearchProgressBar";
import { useComboboxPlacement } from "./useComboboxPlacement";

const NONE_COMMAND_VALUE = "__reef_combobox_none__";
const MISSING_COMMAND_VALUE = "__reef_combobox_missing__";

function optionCommandValue(value: string): string {
  return `option:${value}`;
}

export interface ComboboxOption<T extends string> {
  value: T;
  label: string;
  keywords?: string;
  disabled?: boolean;
  testId?: string;
  content: ReactNode;
  renderContent?: (state: ComboboxOptionRenderState) => ReactNode;
}

export interface ComboboxOptionRenderState {
  active: boolean;
  selected: boolean;
}

export interface ComboboxRenderValueContext {
  textRef: Ref<HTMLSpanElement>;
}

interface ComboboxProps<T extends string> {
  value: T | null;
  onChange: (value: T | null) => void;
  options: ReadonlyArray<ComboboxOption<T>>;
  id?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  testId?: string;
  triggerTestId?: string;
  disabled?: boolean;
  active?: boolean;
  loading?: boolean;
  placeholder?: ReactNode;
  renderValue?: (value: T, context: ComboboxRenderValueContext) => ReactNode;
  triggerTooltipValue?: string;
  triggerVariant?: "field" | "button";
  triggerContent?: ReactNode;
  searchable?: boolean;
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  noneOption?: { label: ReactNode };
  emptyState?: ReactNode;
  align?: "start" | "end";
  className?: string;
  contentClassName?: string;
  optionClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Combobox<T extends string>({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  ariaLabelledby,
  testId,
  triggerTestId,
  disabled,
  active,
  loading,
  placeholder,
  renderValue,
  triggerTooltipValue,
  triggerVariant = "field",
  triggerContent,
  searchable,
  onQueryChange,
  searchPlaceholder,
  noneOption,
  emptyState,
  align = "start",
  className,
  contentClassName,
  optionClassName,
  open: controlledOpen,
  onOpenChange,
}: ComboboxProps<T>) {
  const t = useTranslations("components.combobox");
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tooltipDismissKey, setTooltipDismissKey] = useState(0);
  const open = controlledOpen ?? internalOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerTextRef = useRef<HTMLSpanElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const rows = loading ? [] : options;
  const showNone = Boolean(noneOption) && (!searchable || query.trim() === "");
  const defaultCommandValue =
    value !== null
      ? rows.some((option) => option.value === value)
        ? optionCommandValue(value)
        : MISSING_COMMAND_VALUE
      : showNone
        ? NONE_COMMAND_VALUE
        : optionCommandValue(
            rows.find((option) => !option.disabled)?.value ?? "",
          );
  const placement = useComboboxPlacement({
    open,
    align,
    triggerRef,
    panelRef,
    measureKey: `${rows.length}:${query}:${loading ? 1 : 0}`,
  });
  const isTriggerOverflowing = useTextOverflow(
    triggerTextRef,
    triggerTooltipValue ?? "",
    Boolean(triggerTooltipValue),
  );

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      if (!next) {
        setQuery("");
        setTooltipDismissKey((key) => key + 1);
        onQueryChange?.("");
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange, onQueryChange],
  );

  const select = useCallback(
    (next: T | null) => {
      onChange(next);
      setOpen(false);
    },
    [onChange, setOpen],
  );

  const triggerBody =
    triggerContent ??
    (value !== null && selectedOption ? (
      (renderValue?.(value, { textRef: triggerTextRef }) ?? (
        <span
          ref={triggerTooltipValue ? triggerTextRef : undefined}
          className="truncate"
        >
          {selectedOption.label}
        </span>
      ))
    ) : value !== null ? (
      (renderValue?.(value, { textRef: triggerTextRef }) ?? (
        <span
          ref={triggerTooltipValue ? triggerTextRef : undefined}
          className="truncate"
        >
          {value}
        </span>
      ))
    ) : (
      <span className="truncate text-muted-foreground">{placeholder}</span>
    ));
  const isButton = triggerVariant === "button";
  const trigger = (
    <PopoverTrigger
      ref={triggerRef}
      id={id}
      data-testid={triggerTestId}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-haspopup="dialog"
      onKeyDown={(event) => {
        if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          setOpen(true);
        }
      }}
      className={cn(
        isButton ? CBX_TRIGGER_BUTTON : CBX_TRIGGER_FIELD,
        !isButton && active && CBX_TRIGGER_ACTIVE,
      )}
    >
      {triggerBody}
      {!isButton && !triggerContent && (
        <ChevronDown data-open={open} className={CBX_CHEVRON} />
      )}
    </PopoverTrigger>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => setOpen(next)}
      className={isButton ? "inline-block" : "w-full"}
    >
      <div
        data-testid={testId}
        className={cn(
          "relative",
          isButton ? "inline-block" : "w-full",
          className,
        )}
      >
        {triggerTooltipValue && isTriggerOverflowing && !open ? (
          <OverflowTooltip
            value={triggerTooltipValue}
            isOverflowing
            dismissKey={tooltipDismissKey}
          >
            {trigger}
          </OverflowTooltip>
        ) : (
          trigger
        )}

        <PopoverContent
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel ?? t("options")}
          align={placement.horizontal}
          side={placement.vertical === "up" ? "top" : "bottom"}
          initialFocus={() =>
            searchable ? searchRef.current : commandRef.current
          }
          className={cn(
            CBX_PANEL,
            CBX_PANEL_POSITIONED,
            "min-w-[12rem]",
            contentClassName,
          )}
        >
          <Command
            ref={commandRef}
            label={ariaLabel ?? t("options")}
            defaultValue={defaultCommandValue}
            shouldFilter={searchable && !onQueryChange}
            loop
            className="overflow-visible bg-transparent"
          >
            {searchable && (
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
            )}
            <CommandList
              label={ariaLabel ?? t("options")}
              className={cn(CBX_LIST, "relative")}
            >
              <SearchProgressBar
                active={Boolean(loading)}
                className="sticky top-0 bottom-auto"
              />
              {showNone && noneOption ? (
                <CommandItem
                  value={NONE_COMMAND_VALUE}
                  forceMount
                  onSelect={() => select(null)}
                  className={cn(
                    CBX_OPTION_BASE,
                    optionClassName ?? CBX_OPTION_ROW,
                    CBX_OPTION_MUTED,
                  )}
                >
                  {noneOption.label}
                  {value === null && <Check className={CBX_CHECK} aria-hidden />}
                </CommandItem>
              ) : null}
              {rows.map((option) => (
                <SingleComboboxItem
                  key={option.value}
                  option={option}
                  selected={option.value === value}
                  optionClassName={optionClassName}
                  onSelect={() => select(option.value)}
                />
              ))}
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
      </div>
    </Popover>
  );
}

function SingleComboboxItem<T extends string>({
  option,
  selected,
  optionClassName,
  onSelect,
}: {
  option: ComboboxOption<T>;
  selected: boolean;
  optionClassName?: string;
  onSelect: () => void;
}) {
  const commandValue = optionCommandValue(option.value);
  const active = useCommandState((state) => state.value === commandValue);
  return (
    <CommandItem
      value={commandValue}
      keywords={[option.label, option.keywords ?? ""]}
      disabled={option.disabled}
      data-active={active}
      data-testid={option.testId}
      onSelect={onSelect}
      className={cn(
        CBX_OPTION_BASE,
        optionClassName ?? CBX_OPTION_ROW,
        "data-[selected=true]:bg-surface-hover data-[selected=true]:text-foreground",
      )}
    >
      {option.renderContent?.({ active, selected }) ?? option.content}
      {selected && <Check className={CBX_CHECK} aria-hidden />}
    </CommandItem>
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
