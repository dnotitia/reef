"use client";

import { DocumentOptionRow } from "@/components/fields/DocumentOptionRow";
import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import { useVaultDocumentSearch } from "@/features/issues/hooks/queries/useVaultDocumentSearch";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/** Mirrors the shared `<Input>` chrome, with room for a leading search glyph. */
const INPUT_CLASS =
  "flex h-8 w-full min-w-0 rounded-md border border-border bg-elevated pl-8 pr-8 py-1 text-[13px] text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50";

const DEBOUNCE_MS = 250;

interface DocumentRefInputProps {
  vault: string;
  /** Already-linked document URIs, filtered out of the candidate list. */
  existingUris: readonly string[];
  onAdd: (uri: string) => void;
  disabled?: boolean;
  /** An add mutation is in flight — keeps the spinner up after selection. */
  pending?: boolean;
}

/**
 * Typeahead to link an akb document to an issue as a `references` edge
 * (REEF-083). Hand-rolled (not cmdk) for the same reason as `IssueRelationInput`
 * — the input keeps its own focus/id — and the panel is portaled to <body> with
 * `pointer-events-auto` so it works inside modal Radix dialogs (REEF-092).
 *
 * Unlike the issue combobox there is no "recent" list: akb's search term is
 * required, so nothing renders until the (debounced) query is non-empty.
 */
export function DocumentRefInput({
  vault,
  existingUris,
  onAdd,
  disabled = false,
  pending = false,
}: DocumentRefInputProps) {
  const t = useTranslations("issues.refs");
  const listId = useId();
  const [draft, setDraft] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Debounce the query that actually hits the network; typing stays responsive.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(draft.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [draft]);

  const {
    data: hits = [],
    isFetching,
    isError,
  } = useVaultDocumentSearch(debounced, vault);

  const existing = useMemo(() => new Set(existingUris), [existingUris]);
  const options = useMemo(
    () => hits.filter((hit) => !existing.has(hit.uri)),
    [hits, existing],
  );

  const updateCoords = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 16);
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - 8 - width),
    );
    setCoords({ top: rect.bottom + 4, left, width });
  }, []);

  const showPanel = open && !disabled && debounced.length > 0;
  const active = options.length
    ? Math.max(0, Math.min(activeIndex, options.length - 1))
    : 0;

  useEffect(() => {
    if (!showPanel) return;
    const row = listRef.current?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [active, showPanel]);

  useEffect(() => {
    if (!showPanel) return;
    updateCoords();
    const reposition = () => updateCoords();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [showPanel, updateCoords]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function selectHit(uri: string) {
    onAdd(uri);
    setDraft("");
    setDebounced("");
    setActiveIndex(0);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        options.length ? Math.min(index + 1, options.length - 1) : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (showPanel && options[active]) {
        event.preventDefault();
        selectHit(options[active].uri);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={wrapperRef}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={showPanel ? listId : undefined}
            aria-autocomplete="list"
            aria-label={t("searchDocumentsToLink")}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={t("typeToSearchDocuments")}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLASS}
          />
        </div>

        {showPanel &&
          coords &&
          createPortal(
            <div
              ref={panelRef}
              data-testid="document-ref-panel"
              onMouseDown={(event) => event.preventDefault()}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: coords.width,
              }}
              className={cn(
                // pointer-events-auto: see IssueRelationInput — a modal Radix
                // dialog sets pointer-events:none on <body>, which this portaled
                // panel would otherwise inherit.
                "pointer-events-auto z-[100] rounded-md border border-border bg-popover p-1 shadow-lg shadow-foreground/5",
                "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
              )}
            >
              {/* In-flight hairline at the results panel's top edge — the shared
                  placement across search surfaces (REEF-369). Replaces the old
                  right-edge Loader2; the panel text + aria-live keep the SR
                  signal, so the old spinner isn't needed. */}
              <SearchProgressBar
                active={isFetching || pending}
                className="top-0 bottom-auto"
              />
              {isError ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {t("searchUnavailable")}
                </p>
              ) : options.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {isFetching ? t("searching") : t("noDocumentsMatch")}
                </p>
              ) : (
                <div
                  ref={listRef}
                  id={listId}
                  className="max-h-72 overflow-y-auto overflow-x-hidden overscroll-contain"
                >
                  {options.map((hit, index) => {
                    const isActive = index === active;
                    return (
                      <button
                        key={hit.uri}
                        type="button"
                        tabIndex={-1}
                        data-doc-uri={hit.uri}
                        onClick={() => selectHit(hit.uri)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          "flex w-full cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-left touch-manipulation",
                          isActive && "bg-accent text-accent-foreground",
                        )}
                      >
                        <DocumentOptionRow hit={hit} query={debounced} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>,
            document.body,
          )}
      </div>

      <span aria-live="polite" className="sr-only">
        {showPanel && !isError
          ? t("matchingCount", { count: options.length })
          : ""}
      </span>
    </div>
  );
}
