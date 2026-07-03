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
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueRelations } from "@/features/issues/hooks/queries/useIssueRelations";
import type { IssueQueryParams } from "@/features/issues/lib/buildIssueQuery";
import {
  indexIssuesById,
  unresolvedBlockerCountIn,
} from "@/features/issues/lib/dependencyUtils";
import { isActive, searchIssues } from "@/features/issues/lib/issueListUtils";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { cn } from "@/lib/utils";
import { withVault } from "@/lib/workspaceHref";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useExactIssue } from "../hooks/useExactIssue";
import { useGlobalSearchStore } from "../stores/useGlobalSearchStore";

/** Recent-issues preview size shown when the search box is empty. */
const RECENT_LIMIT = 8;
/**
 * Page size for a free-text search — sent as the server `limit` AND used as the
 * DOM cap. Bounding the request keeps this debounced, per-keystroke path cheap in
 * a large vault (the server returns, and the browser parses/ranks, at most this
 * many rows). Broad terms (a letter, a common assignee/label) can match a huge
 * set, so the cap matters; the id-rank below promotes the best hits within it.
 */
const SEARCH_LIMIT = 20;
/**
 * A complete, canonical reef id (`PREFIX-` + at least 3 digits, e.g. `REEF-001`).
 * Ids are zero-padded to ≥3 digits, so this matches a finished id but not the
 * `REEF-1` / `REEF-01` a user is still typing. A complete id triggers the
 * exact-id lookup below, so a half-typed prefix avoids the extra fetch.
 */
const CANONICAL_ID = /^[a-z]+-\d{3,}$/i;
/** Debounce before issuing a server query, matching the issues-list SearchBar. */
const SEARCH_DEBOUNCE_MS = 150;

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
export function GlobalSearchDialog() {
  const isOpen = useGlobalSearchStore((s) => s.isOpen);
  const close = useGlobalSearchStore((s) => s.close);
  const { vault } = useActiveVault();
  const router = useRouter();
  const t = useTranslations("search");

  // The live value drives the input + match highlighting; the debounced value
  // drives the server query so a request isn't fired on every keystroke.
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const liveTrimmed = query.trim();
  const debouncedTrimmed = debouncedQuery.trim();
  const isSearching = liveTrimmed.length > 0;
  // True between a keystroke and the debounce firing — the server query (and the
  // rows it returns) still reflect the PREVIOUS text. Used to keep the palette in
  // a pending state so a fast Enter does not select a now-stale row.
  const debouncePending = liveTrimmed !== debouncedTrimmed;

  // Bounded request (the `archived` facet defaults to false, excluding
  // archived rows): an empty box previews recent issues; otherwise the server `q`
  // search, capped with `limit` so this debounced, per-keystroke path does not
  // scans/serializes the whole vault — not even for a broad term or a short id
  // prefix that substring-matches many ids. Exact-id reliability is handled by a
  // separate by-id lookup below, not by widening this request.
  const listQuery: IssueQueryParams = debouncedTrimmed
    ? { q: debouncedTrimmed, limit: String(SEARCH_LIMIT) }
    : { limit: String(RECENT_LIMIT) };
  const {
    data: issues,
    isError,
    isLoading,
    isFetching,
    isPlaceholderData,
  } = useIssueList(vault ?? "", listQuery);

  // Exact-id jump guarantee. The bounded `q` page is ordered by created_at, so an
  // exact id could in theory be truncated behind newer issues that merely mention
  // it. When the box holds a complete id that the settled page did NOT already
  // include, look that one issue up directly (O(1) by id, keeping the hot
  // path the way an unbounded `q` would). Gated on the page having settled so the
  // common case (the id is already on the page) costs no extra request. Uses the
  // vault-scoped probe (not the detail hook) so a hit cached for another vault is
  // not merged in for the current one.
  const exactId = CANONICAL_ID.test(debouncedTrimmed)
    ? debouncedTrimmed.toUpperCase()
    : "";
  const pageSettled = !isLoading && !isFetching && !isPlaceholderData;
  const exactOnPage = (issues ?? []).some(
    (i) => i.id.toUpperCase() === exactId,
  );
  const probeId = exactId && pageSettled && !exactOnPage ? exactId : "";
  const { data: probedIssue, isFetching: probeFetching } = useExactIssue(
    probeId,
    probeId ? (vault ?? "") : "",
  );

  // A complete id's jump target isn't settled until either the page is confirmed
  // to contain it, or — when it doesn't — the by-id probe has resolved. While the
  // page is still fetching (incl. a stale-while-revalidate refetch on the same
  // key, where `isPlaceholderData` is false) the cached page may omit the exact id
  // and lead with a mention, and the probe is held off until the page settles; so
  // selection stays blocked through that window for an id query specifically.
  const exactIdPending =
    exactId !== "" && (!pageSettled || (probeId !== "" && probeFetching));

  // The displayed rows are authoritative for what's typed once the debounce
  // has caught up (the request reflects the live text), the data in hand is for
  // the current query key (not placeholder rows from a prior key), and any
  // exact-id resolution has settled. Until then the rows still render for instant
  // feedback, but selecting one is blocked so a fast Enter/click does not jump to a
  // stale row (e.g. a mention shown before the exact id is promoted).
  const resultsAreCurrent =
    !debouncePending && !isPlaceholderData && !exactIdPending;

  // Whole-vault relation graph (incl. archived) so a dependency on an archived
  // done/closed issue isn't miscounted as a blocker; fall back to the visible
  // set until it loads. Built once so each rendered row is O(1).
  const { data: relations } = useIssueRelations(vault ?? "");
  const blockedIndex = useMemo(
    () => indexIssuesById(relations ?? issues ?? []),
    [relations, issues],
  );

  // Merge the directly-fetched exact issue (if any) into the page so the id-rank
  // below can float it to the top; dedupe in case the page already had it.
  const pool = issues ?? [];
  const withExact =
    probedIssue && !pool.some((i) => i.id === probedIssue.id)
      ? [probedIssue, ...pool]
      : pool;

  // Two client safety nets mirroring the board/list pipeline:
  //   1. `isActive` drops archived rows. The server excludes them, but
  //      `useIssueList` supplies placeholder data from ANY previous same-vault
  //      issue-list query while a new one is pending — including the board/list
  //      query with "Show archived" on — so an archived row could otherwise flash
  //      in the palette before the active response settles. (An archived
  //      exact-id hit is dropped here too, matching the old palette.)
  //   2. `searchIssues` re-filters by the LIVE query (not the debounced one) using
  //      the field set the server `q` uses, so placeholder/lagging rows that
  //      don't match what's typed are dropped (and legitimate matches kept). An
  //      empty query passes through, leaving the recent preview intact.
  const matched = searchIssues(withExact.filter(isActive), query);

  // Rank id hits to the top so typing an id jumps to it on Enter, even when a
  // newer issue merely mentions it (the server `q` matches both but orders by
  // created_at, not relevance). Exact id equality leads substring id hits — ids
  // are min-3-digit zero-padded, so "REEF-100" also substring-matches
  // "REEF-1000", and the exact issue should still win. A stable sort preserves the
  // server's order within each tier; the DOM cap is applied AFTER ranking so a
  // within-page exact hit leads rather than being sliced behind mentions.
  const needle = liveTrimmed.toLowerCase();
  const idRank = (id: string): number =>
    id === needle ? 0 : id.includes(needle) ? 1 : 2;
  // Both branches cap the rendered rows. The empty (recent) branch caps too:
  // `useIssueList` can hand back a prior same-vault query's placeholder rows (the
  // whole board/list) while the small `{ limit }` recent request is in flight, so
  // without the slice the palette would briefly flood with the entire cached vault.
  const results = needle
    ? [...matched]
        .sort((a, b) => idRank(a.id.toLowerCase()) - idRank(b.id.toLowerCase()))
        .slice(0, SEARCH_LIMIT)
    : matched.slice(0, RECENT_LIMIT);

  function handleSelect(id: string) {
    // Ignore selection while the shown rows are stale for the live query — the
    // result for what's typed hasn't settled yet, so navigating now could open
    // the wrong issue. Resolves within the debounce + a server round-trip.
    if (!resultsAreCurrent) return;
    close();
    setQuery("");
    setDebouncedQuery("");
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

  function handleOpenChange(open: boolean) {
    if (!open) {
      close();
      setQuery("");
      setDebouncedQuery("");
    }
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
  } else if (
    results.length === 0 &&
    (isLoading || isFetching || debouncePending)
  ) {
    statusMessage = t("searching");
  } else if (results.length === 0) {
    statusMessage = isSearching ? t("noMatches") : t("empty");
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      // `label` gives cmdk's combobox input an accessible name: cmdk hardcodes
      // the input's `aria-labelledby` to its own (otherwise empty) label element,
      // which shadows a caller `aria-label`, so the name flows through here.
      // `shouldFilter={false}` keeps the server's result order.
      commandProps={{ shouldFilter: false, label: t("title") }}
      // The palette owns its input row, so suppress the inherited top-right close
      // X that would otherwise overlap it. Esc-to-close is unaffected.
      showCloseButton={false}
    >
      {/* Radix Dialog requires an accessible name + description. Hide both
          visually so the palette still reads as a single-purpose search box. */}
      <DialogTitle className="sr-only">{t("title")}</DialogTitle>
      <DialogDescription className="sr-only">
        {t("description")}
      </DialogDescription>
      {/* cmdk's CommandInput already hardcodes autoComplete/autoCorrect off and
          spellCheck false, so no extra props are needed for those. */}
      {/* Wrap so the in-flight hairline pins to the input's bottom edge. The
          persistent role="status" region below still owns the SR signal. */}
      <div className="relative">
        <CommandInput
          placeholder={t("placeholder")}
          value={query}
          onValueChange={setQuery}
          data-testid="global-search-input"
        />
        <SearchProgressBar active={isFetching || debouncePending} />
      </div>
      {/* `overscroll-contain` keeps scroll chaining from leaking to the page
          behind the modal once the list reaches its top/bottom. */}
      <CommandList
        className="overscroll-contain"
        aria-busy={isSearching && !resultsAreCurrent}
      >
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
                    blockerCount={unresolvedBlockerCountIn(issue, blockedIndex)}
                  />
                </Link>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {/* `<output>` carries a polite `role="status"` live region for the
            "Searching…" ↔ "No matching issues." transition. The region remains
            mounted before its text changes. */}
        <output
          aria-live="polite"
          className={cn(
            "block text-center text-sm",
            statusMessage ? "py-6" : "sr-only",
          )}
        >
          {statusMessage}
        </output>
      </CommandList>
    </CommandDialog>
  );
}
