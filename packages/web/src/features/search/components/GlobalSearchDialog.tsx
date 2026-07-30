"use client";

import { IssueOptionRow } from "@/components/fields/IssueOptionRow";
import { SearchProgressBar } from "@/components/ui/SearchProgressBar";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CommandMode } from "@/features/commands/components/CommandMode";
import type {
  CommandIssueTarget,
  CommandRegistry,
} from "@/features/commands/hooks/useCommandRegistry";
import {
  COMMAND_PAGE_CATALOG,
  type CommandPage,
  type CommandParentPage,
} from "@/features/commands/lib/appActionCatalog";
import { scoreCommandFilter } from "@/features/commands/lib/commandFilter";
import {
  initialCommandPageState,
  reduceCommandPageState,
} from "@/features/commands/lib/commandPageStack";
import { shouldRestorePaletteFocus } from "@/features/commands/lib/focusPolicy";
import { unresolvedBlockerCountIn } from "@/features/issues/lib/dependencyUtils";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  SEARCH_DEBOUNCE_WARM,
  useDebouncedQuery,
} from "@/lib/useDebouncedQuery";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useIssueSearchMode } from "../hooks/useIssueSearchMode";
import { useGlobalSearchStore } from "../stores/useGlobalSearchStore";

function foldWithSourceRanges(value: string): {
  folded: string;
  starts: number[];
  ends: number[];
} {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceIndex = 0;
  for (const symbol of value) {
    const foldedSymbol = symbol.toLowerCase();
    folded += foldedSymbol;
    for (let index = 0; index < foldedSymbol.length; index += 1) {
      starts.push(sourceIndex);
      ends.push(sourceIndex + symbol.length);
    }
    sourceIndex += symbol.length;
  }
  return { folded, starts, ends };
}

function findCaseInsensitiveLiteralRange(
  value: string,
  query: string,
): { start: number; end: number } | null {
  const source = foldWithSourceRanges(value);
  const needle = foldWithSourceRanges(query).folded;
  if (!needle) return null;
  const foldedIndex = source.folded.indexOf(needle);
  if (foldedIndex < 0) return null;
  const start = source.starts[foldedIndex];
  const end = source.ends[foldedIndex + needle.length - 1];
  return start === undefined || end === undefined ? null : { start, end };
}

function LiteralHighlight({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const parts: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const match = findCaseInsensitiveLiteralRange(text.slice(cursor), query);
    if (!match) {
      parts.push({ text: text.slice(cursor), matched: false });
      break;
    }
    const matchStart = cursor + match.start;
    const matchEnd = cursor + match.end;
    if (matchStart > cursor) {
      parts.push({ text: text.slice(cursor, matchStart), matched: false });
    }
    parts.push({
      text: text.slice(matchStart, matchEnd),
      matched: true,
    });
    cursor = matchEnd;
  }
  if (parts.length === 0) return text;
  return parts.map((part, index) =>
    part.matched ? (
      <mark
        // The source text + position is stable for a settled result.
        key={`${index}:${part.text}`}
        className="rounded-sm bg-brand/15 px-0.5 text-foreground"
      >
        {part.text}
      </mark>
    ) : (
      <Fragment key={`${index}:${part.text}`}>{part.text}</Fragment>
    ),
  );
}

/**
 * ⌘K global search palette.
 *
 * Data: the server-side issue search the issues list uses (REEF-034/080).
 * The debounced query is sent as the `q` facet of `GET /api/issues` (bounded by
 * `limit`), which matches reef_id · title · assignee · requester · reporter ·
 * milestone · sprint · release · labels server-side, replacing the previous
 * whole-vault cache. An empty box previews recent issues through
 * that endpoint. Two safety nets re-apply the board/list client pipeline over
 * the response (drop archived rows that placeholder data could surface; re-filter
 * by the live query); a complete id additionally triggers a direct by-id lookup
 * so a jump-to-id is reliable even if the bounded page didn't include it.
 *
 * cmdk's built-in fuzzy filter is disabled (`shouldFilter={false}`) because the
 * server decided the result set and order; cmdk would otherwise re-drop
 * rows it does not fuzzy-match (e.g. an assignee/label hit with no id/title match).
 * Each result is a card-level `IssueOptionRow` (REEF-032). Clicking an item
 * routes through `/issues/[id]` so the existing intercept route drives the
 * slide-over.
 */
interface GlobalSearchDialogProps {
  registry: CommandRegistry;
}

const CONTEXTUAL_COMMAND_PAGES = new Set<CommandParentPage>([
  "status",
  "assignee",
  "priority",
]);

export function GlobalSearchDialog({ registry }: GlobalSearchDialogProps) {
  const isOpen = useGlobalSearchStore((s) => s.isOpen);
  const close = useGlobalSearchStore((s) => s.close);
  const { vault } = useActiveVault();
  const router = useRouter();
  const t = useTranslations("search");
  const commands = useTranslations("commands") as unknown as (
    key: string,
  ) => string;
  const captureCommandContext = registry.captureContext;
  const [mode, setMode] = useState<"search" | "command">("search");
  const [commandState, dispatchCommand] = useReducer(
    reduceCommandPageState,
    initialCommandPageState,
  );
  const [commandTarget, setCommandTarget] = useState<CommandIssueTarget | null>(
    null,
  );
  const [commandSelection, setCommandSelection] = useState("issue.new");
  const allowCommandSelectionChangeRef = useRef(false);
  const originRef = useRef<HTMLElement | null>(null);
  const focusPolicyRef = useRef<"restore" | "navigate" | "handoff">("restore");
  // The live value drives the input + match highlighting; the debounced value
  // drives the server query so a request isn't fired on every keystroke. The
  // shared warm-tier debounce (REEF-370) replaces the previous inline 150ms
  // timer; `reset` clears both values instantly on select/close so a stale query
  // does not linger a debounce window past the palette closing.
  const {
    raw: query,
    debounced: debouncedQuery,
    onChange: setQuery,
    reset: resetQuery,
  } = useDebouncedQuery(SEARCH_DEBOUNCE_WARM);
  const searchVault = mode === "search" ? (vault ?? "") : "";

  useEffect(() => {
    if (!isOpen) return;
    focusPolicyRef.current = "restore";
    setCommandTarget(captureCommandContext());
  }, [captureCommandContext, isOpen]);

  const {
    blockedIndex,
    canLoadMore,
    contentInFlight,
    contentQueryIsCurrent,
    contentResults,
    debouncePending,
    exactIdPending,
    isError,
    isFetching,
    isLoading,
    isSearching,
    liveTrimmed,
    loadMore,
    results,
    resultsAreCurrent,
    searchBusy,
  } = useIssueSearchMode({
    query,
    debouncedQuery,
    vault: searchVault,
  });

  function handleSelect(id: string) {
    // Ignore selection while the shown rows are stale for the live query — the
    // result for what's typed hasn't settled yet, so navigating now could open
    // the wrong issue. Resolves within the debounce + a server round-trip.
    if (!resultsAreCurrent) return;
    focusPolicyRef.current = "navigate";
    close();
    resetQuery();
    router.push(withVault(vault, `/issues/${encodeURIComponent(id)}`));
  }

  function handleContentSelect(id: string) {
    if (!contentQueryIsCurrent) return;
    focusPolicyRef.current = "navigate";
    close();
    resetQuery();
    router.push(withVault(vault, `/issues/${encodeURIComponent(id)}`));
  }

  // Result rows are real anchors (`<Link href="/issues/{id}">`) so Cmd/Ctrl,
  // middle-, and right-click "open in new tab" all work like any link. This
  // handler reconciles that native behavior with cmdk's keyboard selection:
  //   - Modified left-click lets the browser open a new tab/window from the real
  //     href, leaving the current tab on the palette. (Middle-click fires
  //     `auxclick`, not `click`, so it bypasses this handler and navigates
  //     natively.) We stop propagation so cmdk's own item `onClick` doesn't
  //     fire a second, same-tab navigation.
  //   - Plain left-click reuses the exact keyboard path (`handleSelect`): the
  //     stale-row guard, palette close, and query reset. `preventDefault` cancels
  //     the anchor's own navigation so we don't navigate twice.
  function handleRowClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    handleSelect(id);
  }

  function handleContentRowClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    handleContentSelect(id);
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      close();
      resetQuery();
      setMode("search");
      setCommandSelection("issue.new");
      dispatchCommand({ type: "reset" });
    }
  }

  function enterCommandMode(initialQuery = "") {
    resetQuery();
    setMode("command");
    setCommandSelection(
      initialQuery
        ? resolveCommandSelection(initialQuery, "root")
        : "issue.new",
    );
    dispatchCommand({ type: "reset" });
    if (initialQuery) {
      dispatchCommand({ type: "query", query: initialQuery });
    }
  }

  function handleSearchValueChange(next: string) {
    if (query === "" && next.startsWith(">")) {
      enterCommandMode(next.slice(1).trimStart());
      return;
    }
    setQuery(next);
  }

  function handleCommandExecute(
    policy: "restore" | "navigate" | "handoff",
    run: () => void,
  ) {
    focusPolicyRef.current = policy;
    close();
    resetQuery();
    setMode("search");
    setCommandSelection("issue.new");
    dispatchCommand({ type: "reset" });
    queueMicrotask(run);
  }

  function handleCommandQueryChange(value: string) {
    setCommandSelection(resolveCommandSelection(value, commandPage));
    dispatchCommand({ type: "query", query: value });
  }

  function handlePushCommandPage(page: Exclude<CommandPage, "root">) {
    setCommandSelection(resolveCommandSelection("", page));
    dispatchCommand({ type: "push", page });
  }

  function handleCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const nested = commandState.pages.length > 1;
    if (event.key === "Backspace" && nested && commandState.query === "") {
      event.preventDefault();
      event.stopPropagation();
      setCommandSelection("issue.new");
      dispatchCommand({ type: "backspace" });
      return;
    }
  }

  function handleCommandNavigationKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    allowCommandSelectionChangeRef.current =
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End" ||
      (event.ctrlKey && ["n", "j", "p", "k"].includes(event.key));
  }

  function handleCommandSelectionChange(value: string) {
    if (!value) return;
    const expected = resolveCommandSelection(commandState.query, commandPage);
    if (value === expected || allowCommandSelectionChangeRef.current) {
      setCommandSelection(value);
    }
    allowCommandSelectionChangeRef.current = false;
  }

  function handleCloseAutoFocus(event: Event) {
    event.preventDefault();
    const origin = originRef.current;
    if (focusPolicyRef.current !== "restore") return;
    const fallback = document.querySelector<HTMLElement>(
      "[data-command-focus-destination]",
    );
    const destination = shouldRestorePaletteFocus(
      focusPolicyRef.current,
      origin?.isConnected === true,
    )
      ? origin
      : fallback;
    queueMicrotask(() => {
      destination?.focus({ preventScroll: true });
    });
  }

  function handleOpenAutoFocus() {
    const active = document.activeElement;
    originRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }

  function handleEscapeKeyDown(event: Event) {
    if (mode !== "command" || commandState.pages.length <= 1) return;
    event.preventDefault();
    setCommandSelection("issue.new");
    dispatchCommand({ type: "escape" });
  }

  function resolveCommandSelection(
    nextQuery: string,
    nextPage: CommandPage,
  ): string {
    const actions = registry.paletteActions(commandTarget);
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      if (nextPage === "root") {
        return actions.some((action) => action.descriptor.id === "issue.new")
          ? "issue.new"
          : "page.navigation";
      }
      if (nextPage === "assignee") return "assignee.unassigned";
      return (
        actions.find((action) => action.descriptor.parentPage === nextPage)
          ?.descriptor.id ?? ""
      );
    }

    const candidates: Array<{
      value: string;
      keywords: ReadonlyArray<string>;
    }> = [];
    if (nextPage === "root") {
      for (const descriptor of Object.values(COMMAND_PAGE_CATALOG)) {
        if (
          CONTEXTUAL_COMMAND_PAGES.has(descriptor.page) &&
          commandTarget === null
        ) {
          continue;
        }
        candidates.push({
          value: `page.${descriptor.page}`,
          keywords: [
            commands(`pages.${descriptor.page}`),
            ...descriptor.searchAliases,
            ...(CONTEXTUAL_COMMAND_PAGES.has(descriptor.page) && commandTarget
              ? [commandTarget.issueId]
              : []),
          ],
        });
      }
    }
    for (const action of actions) {
      if (nextPage !== "root" && action.descriptor.parentPage !== nextPage) {
        continue;
      }
      candidates.push({
        value: action.descriptor.id,
        keywords: [
          action.label,
          ...action.keywords,
          ...(action.target ? [action.target.issueId] : []),
        ],
      });
    }

    let selected = "";
    let selectedScore = 0;
    for (const candidate of candidates) {
      const score = scoreCommandFilter(
        candidate.value,
        trimmed,
        candidate.keywords,
      );
      if (score > selectedScore) {
        selected = candidate.value;
        selectedScore = score;
      }
    }
    return selected;
  }

  // Error and pending states avoid reading as "no results" while a query is still
  // resolving (or the safety net dropped the stale placeholder rows mid-fetch).
  // The message is rendered into a single persistent `role="status"` live region
  // below — kept mounted for the whole dialog lifetime so a screen reader hears
  // the "Searching…" ↔ "No matching issues." transition. Live regions announce
  // reliably when they exist before their text changes.
  const showResults = !isError && results.length > 0;
  let statusMessage = "";
  if (isError) {
    statusMessage = t("unavailable");
  } else if (contentInFlight && !debouncePending && !isFetching) {
    statusMessage = t("searchingContent");
  } else if (
    results.length === 0 &&
    (isLoading || isFetching || debouncePending)
  ) {
    statusMessage = t("searching");
  } else if (
    results.length === 0 &&
    contentResults.length === 0 &&
    !canLoadMore
  ) {
    statusMessage = isSearching ? t("noMatches") : t("empty");
  }
  const commandPage = commandState.pages.at(-1) ?? "root";
  const commandKey =
    mode === "command"
      ? `command:${commandPage}:${
          commandPage === "root" && commandState.query.trim()
            ? "filtered"
            : "default"
        }`
      : "search";

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      commandKey={commandKey}
      // `label` gives cmdk's combobox input an accessible name: cmdk hardcodes
      // the input's `aria-labelledby` to its own (otherwise empty) label element,
      // which shadows a caller `aria-label`, so the name flows through here.
      // Search preserves the server's result order; command mode delegates
      // localized label + alias fuzzy filtering to cmdk.
      commandProps={{
        shouldFilter: mode === "command",
        filter: mode === "command" ? scoreCommandFilter : undefined,
        disablePointerSelection: mode === "command",
        label: mode === "command" ? commands("title") : t("title"),
        onKeyDown:
          mode === "command" ? handleCommandNavigationKeyDown : undefined,
        ...(mode === "command"
          ? {
              value: commandSelection,
              onValueChange: handleCommandSelectionChange,
            }
          : {}),
      }}
      ariaBusy={mode === "search" && searchBusy}
      onCloseAutoFocus={handleCloseAutoFocus}
      onEscapeKeyDown={handleEscapeKeyDown}
      onOpenAutoFocus={handleOpenAutoFocus}
      // The palette owns its input row, so suppress the inherited top-right close
      // X that would otherwise overlap it. Esc-to-close is unaffected.
      showCloseButton={false}
    >
      {/* Radix Dialog requires an accessible name + description. Hide both
          visually so the palette still reads as a single-purpose search box. */}
      <DialogTitle className="sr-only">
        {mode === "command" ? commands("title") : t("title")}
      </DialogTitle>
      <DialogDescription className="sr-only">
        {mode === "command" ? commands("description") : t("description")}
      </DialogDescription>
      {mode === "command" ? (
        <>
          <CommandInput
            autoFocus
            placeholder={commands("commandPlaceholder")}
            value={commandState.query}
            onValueChange={handleCommandQueryChange}
            onKeyDown={handleCommandKeyDown}
            inputPrefix={
              <span
                className="flex max-w-[50%] min-w-0 shrink-0 items-center gap-1 text-sm text-muted-foreground"
                data-testid="command-breadcrumb"
              >
                <span aria-hidden="true">
                  &gt;{/* i18n-exempt: breadcrumb glyph */}
                </span>
                {commandState.pages.slice(1).map((page) => (
                  <span key={page} className="truncate">
                    {commands(`pages.${page}`)}
                  </span>
                ))}
              </span>
            }
            data-testid="command-palette-input"
          />
          <CommandList
            className="overscroll-contain"
            data-testid="command-palette-list"
          >
            <CommandMode
              state={commandState}
              vault={vault ?? ""}
              target={commandTarget}
              registry={registry}
              onPushPage={handlePushCommandPage}
              onExecute={handleCommandExecute}
            />
          </CommandList>
        </>
      ) : (
        <>
          {/* cmdk's CommandInput already hardcodes autoComplete/autoCorrect off and
          spellCheck false, so no extra props are needed for those. */}
          {/* Wrap so the in-flight hairline pins to the input's bottom edge. The
          persistent role="status" region below still owns the SR signal. */}
          <div className="relative">
            <CommandInput
              placeholder={t("placeholder")}
              value={query}
              onValueChange={handleSearchValueChange}
              data-testid="global-search-input"
            />
            {/* `exactIdPending` covers the second server request (`useExactIssue`
            by-id probe) a complete id triggers: during it the list query has
            already settled but selection is still blocked, so without it the
            bar would read as idle mid-load. */}
            <SearchProgressBar
              active={
                isFetching ||
                debouncePending ||
                exactIdPending ||
                contentInFlight
              }
            />
          </div>
          {/* `overscroll-contain` keeps scroll chaining from leaking to the page
          behind the modal once the list reaches its top/bottom. */}
          <CommandList className="overscroll-contain" aria-busy={searchBusy}>
            {!isSearching ? (
              <CommandGroup heading={commands("commandsHeading")}>
                <CommandItem
                  value={`${commands("commandsHeading")} ${commands(
                    "aliases.commandMenu",
                  )}`}
                  data-testid="command-mode-entry"
                  onSelect={() => enterCommandMode()}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {commands("commandsHeading")}
                  </span>
                  <ChevronRight
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </CommandItem>
              </CommandGroup>
            ) : null}
            {showResults ? (
              <CommandGroup
                heading={isSearching ? t("headingMatches") : t("headingRecent")}
              >
                {results.map((issue) => (
                  <CommandItem
                    key={issue.id}
                    value={`${issue.id} ${issue.title}`}
                    onSelect={() => handleSelect(issue.id)}
                    data-testid="global-search-item"
                    data-issue-id={issue.id}
                  >
                    {/* A real anchor so Cmd/Ctrl/middle/right-click open the issue in
                    a new tab; `tabIndex={-1}` keeps it out of the tab order (cmdk
                    drives selection from the input via aria-activedescendant),
                    and `handleRowClick` preserves the keyboard/SPA path. */}
                    <Link
                      href={withVault(
                        vault,
                        `/issues/${encodeURIComponent(issue.id)}`,
                      )}
                      tabIndex={-1}
                      onClick={(e) => handleRowClick(e, issue.id)}
                      className="flex min-w-0 flex-1"
                    >
                      <IssueOptionRow
                        issue={issue}
                        query={query}
                        blockerCount={unresolvedBlockerCountIn(
                          issue,
                          blockedIndex,
                        )}
                      />
                    </Link>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {contentResults.length > 0 || canLoadMore ? (
              <CommandGroup heading={t("headingContent")}>
                {contentResults.map((result) => (
                  <CommandItem
                    key={result.match_id}
                    value={`${result.reef_id} ${result.title} ${result.match_id}`}
                    onSelect={() => handleContentSelect(result.reef_id)}
                    data-testid="global-search-content-item"
                    data-issue-id={result.reef_id}
                    data-source={result.source}
                  >
                    <Link
                      href={withVault(
                        vault,
                        `/issues/${encodeURIComponent(result.reef_id)}`,
                      )}
                      tabIndex={-1}
                      onClick={(event) =>
                        handleContentRowClick(event, result.reef_id)
                      }
                      className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-mono text-xs font-semibold text-brand">
                          {result.reef_id}
                        </span>
                        <span className="truncate text-sm font-medium">
                          {result.title}
                        </span>
                        <span className="ml-auto shrink-0 rounded-full border border-brand/25 bg-brand/5 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                          {result.source === "body"
                            ? t("sourceBody")
                            : t("sourceComment")}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        <LiteralHighlight
                          text={result.snippet}
                          query={liveTrimmed}
                        />
                      </span>
                    </Link>
                  </CommandItem>
                ))}
                {canLoadMore ? (
                  <button
                    type="button"
                    data-testid="global-search-content-more"
                    disabled={contentInFlight}
                    onClick={loadMore}
                    className="mx-auto mt-1 block rounded-md px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50"
                  >
                    {contentInFlight ? t("loadingMore") : t("loadMore")}
                  </button>
                ) : null}
              </CommandGroup>
            ) : null}
            {/* `<output>` carries a polite `role="status"` live region for the
            "Searching…" ↔ "No matching issues." transition. The region remains
            mounted before its text changes. */}
            <output
              aria-live="polite"
              className={cn(
                "block text-center text-sm",
                statusMessage &&
                  !showResults &&
                  contentResults.length === 0 &&
                  !canLoadMore
                  ? "py-6"
                  : "sr-only",
              )}
            >
              {statusMessage}
            </output>
          </CommandList>
        </>
      )}
    </CommandDialog>
  );
}
