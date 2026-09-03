"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIssue } from "@/features/issues/hooks/queries/useIssue";
import { useIssueList } from "@/features/issues/hooks/queries/useIssueList";
import { useIssueSheetDismiss } from "@/features/issues/hooks/view/useIssueSheetDismiss";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { withVault } from "@/lib/workspaceHref";
import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { IssueChromeIdentity } from "./IssueChromeIdentity";
import { IssueChromeSlotProvider } from "./IssueChromeSlot";
import { IssueDetail } from "./IssueDetail";
import { IssueDetailCloseButton } from "./IssueDetailCloseButton";
import { IssueDetailSkeleton } from "./IssueDetailSkeleton";
import { IssueDrillBackBar } from "./IssueDrillBackBar";

interface IssueDetailSheetProps {
  /** Issue ID like "REEF-001". */
  issueId: string;
  /**
   * Exit the sheet to its entry view (the list/board the user came from). Used
   * by Close, by an outside click, and by Esc when there is no drill trail. The
   * first sheet in a detail session owns this callback; a relation drill may
   * remount the sheet through the intercepting route without changing the
   * destination. Back/Esc within a drill trail are handled internally via the
   * in-memory nav stack (REEF-270).
   */
  onClose: () => void;
}

const ISSUE_DETAIL_PANEL_ID = "issue-detail-panel";
const ISSUE_DETAIL_RESIZE_DESCRIPTION_ID = "issue-detail-resize-description";
const ISSUE_DETAIL_DESKTOP_MIN_WIDTH = 1280;
export const ISSUE_DETAIL_DEFAULT_WIDTH = 1440;
export const ISSUE_DETAIL_MIN_WIDTH = 1200;
const ISSUE_DETAIL_MAX_WIDTH = 1680;
export const ISSUE_DETAIL_KEYBOARD_STEP = 32;
export const ISSUE_DETAIL_SESSION_STORAGE_KEY = "reef:issue-detail-width:v2";
export const ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY =
  "reef:issue-detail-expanded:v2";
export const ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY =
  "reef:issue-detail-restore-width:v2";

function subscribeToViewport(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

function getViewportWidth() {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

function getServerViewportWidth() {
  return 0;
}

export function getIssueDetailMaxWidth(viewportWidth: number) {
  return Math.max(
    ISSUE_DETAIL_MIN_WIDTH,
    Math.min(viewportWidth * 0.94, ISSUE_DETAIL_MAX_WIDTH),
  );
}

export function clampIssueDetailWidth(value: number, maxWidth: number) {
  const safeMax = Math.max(ISSUE_DETAIL_MIN_WIDTH, maxWidth);
  if (!Number.isFinite(value)) {
    return Math.min(ISSUE_DETAIL_DEFAULT_WIDTH, safeMax);
  }
  return Math.min(Math.max(value, ISSUE_DETAIL_MIN_WIDTH), safeMax);
}

function readStoredIssueDetailWidth() {
  try {
    const raw = window.sessionStorage.getItem(ISSUE_DETAIL_SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function storeIssueDetailWidth(width: number) {
  try {
    window.sessionStorage.setItem(
      ISSUE_DETAIL_SESSION_STORAGE_KEY,
      JSON.stringify(width),
    );
  } catch {
    // Private browsing and disabled storage should not block resizing.
  }
}

function readStoredIssueDetailExpanded() {
  try {
    const raw = window.sessionStorage.getItem(
      ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY,
    );
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function storeIssueDetailExpanded(expanded: boolean) {
  try {
    window.sessionStorage.setItem(
      ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY,
      JSON.stringify(expanded),
    );
  } catch {
    // Private browsing and disabled storage should not block resizing.
  }
}

function readStoredIssueDetailRestoreWidth() {
  try {
    const raw = window.sessionStorage.getItem(
      ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY,
    );
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function storeIssueDetailRestoreWidth(width: number | null) {
  try {
    if (width === null) {
      window.sessionStorage.removeItem(
        ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY,
      );
      return;
    }
    window.sessionStorage.setItem(
      ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY,
      JSON.stringify(width),
    );
  } catch {
    // Private browsing and disabled storage should not block resizing.
  }
}

interface IssueDetailResizeHandlers {
  isExpanded: boolean;
  isDesktop: boolean;
  isResizing: boolean;
  maxWidth: number;
  panelWidth: number;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onToggleExpanded: () => void;
}

function useIssueDetailResize(): IssueDetailResizeHandlers {
  // The sheet is the single owner of this viewport subscription. The live
  // width snapshot also lets a desktop resize clamp a stored width before it
  // can make the rail or navigation unreachable.
  const viewportWidth = useSyncExternalStore(
    subscribeToViewport,
    getViewportWidth,
    getServerViewportWidth,
  );
  const isDesktop = viewportWidth >= ISSUE_DETAIL_DESKTOP_MIN_WIDTH;
  const maxWidth = getIssueDetailMaxWidth(viewportWidth);
  const [panelWidth, setPanelWidth] = useState(ISSUE_DETAIL_DEFAULT_WIDTH);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const panelWidthRef = useRef(ISSUE_DETAIL_DEFAULT_WIDTH);
  const normalWidthRef = useRef(ISSUE_DETAIL_DEFAULT_WIDTH);
  const expandedRef = useRef(false);
  const restoreWidthRef = useRef<number | null>(null);
  const loadedSessionStateRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!isDesktop || loadedSessionStateRef.current) return;
    loadedSessionStateRef.current = true;
    const storedWidth = readStoredIssueDetailWidth();
    const nextNormalWidth = clampIssueDetailWidth(
      storedWidth ?? Number.NaN,
      maxWidth,
    );
    const nextExpanded = readStoredIssueDetailExpanded() === true;
    const nextRestoreWidth = readStoredIssueDetailRestoreWidth();
    normalWidthRef.current = nextNormalWidth;
    restoreWidthRef.current = nextExpanded ? nextRestoreWidth : null;
    expandedRef.current = nextExpanded;
    setIsExpanded(nextExpanded);
    const nextPanelWidth = nextExpanded ? maxWidth : nextNormalWidth;
    panelWidthRef.current = nextPanelWidth;
    setPanelWidth(nextPanelWidth);
  }, [isDesktop, maxWidth]);

  useEffect(() => {
    if (!isDesktop || !loadedSessionStateRef.current) return;
    if (expandedRef.current) {
      if (panelWidthRef.current === maxWidth) return;
      panelWidthRef.current = maxWidth;
      setPanelWidth(maxWidth);
      return;
    }
    const nextWidth = clampIssueDetailWidth(normalWidthRef.current, maxWidth);
    if (nextWidth !== normalWidthRef.current) {
      normalWidthRef.current = nextWidth;
      storeIssueDetailWidth(nextWidth);
    }
    if (nextWidth === panelWidthRef.current) return;
    panelWidthRef.current = nextWidth;
    setPanelWidth(nextWidth);
  }, [isDesktop, maxWidth]);

  function updatePanelWidth(value: number) {
    const nextWidth = clampIssueDetailWidth(value, maxWidth);
    if (nextWidth === panelWidthRef.current) return;
    if (expandedRef.current) {
      expandedRef.current = false;
      setIsExpanded(false);
      restoreWidthRef.current = null;
      storeIssueDetailExpanded(false);
      storeIssueDetailRestoreWidth(null);
    }
    normalWidthRef.current = nextWidth;
    panelWidthRef.current = nextWidth;
    setPanelWidth(nextWidth);
    storeIssueDetailWidth(nextWidth);
  }

  function onToggleExpanded() {
    if (!isDesktop) return;
    if (expandedRef.current) {
      const nextWidth = clampIssueDetailWidth(
        restoreWidthRef.current ?? Number.NaN,
        maxWidth,
      );
      expandedRef.current = false;
      setIsExpanded(false);
      restoreWidthRef.current = null;
      normalWidthRef.current = nextWidth;
      panelWidthRef.current = nextWidth;
      setPanelWidth(nextWidth);
      storeIssueDetailWidth(nextWidth);
      storeIssueDetailExpanded(false);
      storeIssueDetailRestoreWidth(null);
      return;
    }

    const nextNormalWidth = clampIssueDetailWidth(
      normalWidthRef.current,
      maxWidth,
    );
    normalWidthRef.current = nextNormalWidth;
    restoreWidthRef.current = nextNormalWidth;
    expandedRef.current = true;
    setIsExpanded(true);
    panelWidthRef.current = maxWidth;
    setPanelWidth(maxWidth);
    storeIssueDetailWidth(nextNormalWidth);
    storeIssueDetailExpanded(true);
    storeIssueDetailRestoreWidth(nextNormalWidth);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isDesktop) return;
    let nextWidth: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = panelWidthRef.current + ISSUE_DETAIL_KEYBOARD_STEP;
        break;
      case "ArrowRight":
        nextWidth = panelWidthRef.current - ISSUE_DETAIL_KEYBOARD_STEP;
        break;
      case "Home":
        nextWidth = ISSUE_DETAIL_MIN_WIDTH;
        break;
      case "End":
        nextWidth = maxWidth;
        break;
      default:
        return;
    }
    event.preventDefault();
    updatePanelWidth(nextWidth);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!isDesktop || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidthRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // The sheet is anchored to the right: moving the boundary left grows the
    // primary pane, while moving it right makes room for the backdrop.
    updatePanelWidth(drag.startWidth + (drag.startX - event.clientX));
  }

  function finishPointerResize(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
    setIsResizing(false);
  }

  return {
    isExpanded,
    isDesktop,
    isResizing,
    maxWidth,
    panelWidth,
    onKeyDown,
    onLostPointerCapture: finishPointerResize,
    onPointerCancel: finishPointerResize,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointerResize,
    onToggleExpanded,
  };
}

/**
 * Shared slide-over wrapper for the IssueDetail panel. Both the
 * intercepting route (soft nav) and the base route (deep link) mount this
 * so the chrome stays identical. The first mounted sheet captures the entry
 * exit target for the whole detail session, even if a drill remounts this
 * component through the other route.
 *
 * Persistent chrome bar (REEF-286): the sheet owns a single top bar that lives
 * *outside* the body — wayfinding + identity on the left (drill Back · parent
 * breadcrumb · status · id · type), actions on the right (save status · ⋮ ·
 * Close). The bar renders in every state (loaded, skeleton, error, no-vault), so
 * the id (from the route param) and Close are consistently present and Back persists
 * while a drilled-in, uncached issue loads — the body below skeletons. The
 * data-dependent identity (status / type / breadcrumb) is read here from
 * `useIssue` / `useIssueList` and fills in on arrival; the body portals its
 * action cluster (save status + ⋮) into the bar's slot so the autosave + dialog
 * wiring stays in the body while the controls render in the bar.
 *
 * Drill navigation (REEF-270): following a relationship link swaps the content
 * in place and records the hop on an in-memory nav stack. A top-left Back
 * unwinds one hop; Close / outside click exit the whole trail to the entry view;
 * Esc means Back while drilled in, Close otherwise.
 */
export function IssueDetailSheet({ issueId, onClose }: IssueDetailSheetProps) {
  const t = useTranslations("issues.detail");
  const nav = useTranslations("nav");
  const {
    isExpanded,
    isDesktop,
    isResizing,
    maxWidth,
    panelWidth,
    onKeyDown,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onToggleExpanded,
  } = useIssueDetailResize();
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const { backTo, goBack, exit, dismissViaEsc } = useIssueSheetDismiss({
    issueId,
    onExit: onClose,
  });

  // Identity data for the persistent bar. Read here (not in the body) so the
  // status glyph / type pill / parent breadcrumb fill the bar the moment they
  // land and survive the body skeleton. Both queries are vault-gated, so while
  // the vault pointer is loading or unset they stay pending and the bar shows
  // the route-param id alone. `useUpdateIssue` patches these caches
  // optimistically (REEF-098), so an inline status / type / parent edit reflects
  // in the bar immediately.
  const { data } = useIssue(issueId, vault);
  const { data: allIssues, isPending: allIssuesPending } = useIssueList(vault);
  const issue = data?.issue;

  // The bar's action slot: the loaded body portals its save-status + ⋮ cluster
  // here, so that wiring stays in the body while the controls land in the bar.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  // `useIssue` is gated on `vault`. When the pointer is still loading or
  // unset, TanStack Query v5 keeps the query in `isPending: true`, which
  // would leave a permanent skeleton — so we render the skeleton / empty
  // CTA ourselves here instead of mounting `IssueDetail` empty.
  function renderBody() {
    if (vaultLoading) return <IssueDetailSkeleton />;
    if (!vault) {
      return (
        <div
          data-testid="issue-detail-no-vault"
          className="p-6 text-sm text-muted-foreground"
        >
          {t.rich("noVaultPrompt", {
            onboarding: nav("onboarding"),
            link: (chunks) => (
              <Link
                href={withVault(vault, "/settings")}
                className="text-brand-text underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </div>
      );
    }
    // Key by vault so an active-vault switch (now reachable from anywhere via
    // the sidebar workspace switcher, REEF-146) fully remounts the detail with
    // fresh state from a fresh query. Without this the form re-syncs on issue
    // id just, so a same-id issue in the new workspace would briefly show — and
    // could autosave — the previous workspace's edited values. Same-id
    // navigation within one vault keeps the key stable, preserving the
    // edit-across-refetch behavior IssueDetail relies on.
    return (
      <IssueDetail key={vault} issueId={issueId} vault={vault} onClose={exit} />
    );
  }

  return (
    <div data-testid="issue-detail-modal">
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) exit();
        }}
      >
        <SheetContent
          side="right"
          // The sheet's own persistent chrome bar owns the close affordance
          // (REEF-286), so the overlay X is suppressed here to avoid a
          // duplicate, colliding control in the top-right corner.
          showCloseButton={false}
          // Esc means Back while drilled into a relation trail, Close otherwise
          // (AC3); an outside click consistently exits to the entry view (AC2). We own
          // both so the in-memory nav stack — not the browser history — decides
          // (REEF-270). preventDefault stops Radix's default one-step dismiss.
          onEscapeKeyDown={(event) => {
            // A nested Radix layer (such as Select) may have already handled
            // this Escape and prevented its default action. Preserve that
            // inner-layer dismissal instead of closing the sheet as well.
            if (event.defaultPrevented) return;
            event.preventDefault();
            dismissViaEsc();
          }}
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent.target;
            // Nested dialogs portal outside the sheet; interacting with them
            // should not count as dismissing the issue detail underneath.
            if (
              target instanceof Element &&
              target.closest(
                '[data-slot="dialog-content"], [data-slot="dialog-overlay"]',
              )
            ) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            exit();
          }}
          // Wider canvas (REEF-149) so the rail's property rows get full width
          // and Planning dates / Relationship inputs stop truncating. The
          // Desktop uses the user-resizable width; the narrow sheet keeps the
          // established 94vw inset, while the small-mobile CSS breakpoint fills
          // the viewport so fixed chrome controls cannot spill past the edge.
          // The issue body below owns the scroll and uses `overscroll-contain`
          // to stop chaining to the page.
          // Keep the sheet viewport fixed while the issue body owns vertical
          // scrolling. The resize splitter is anchored to this viewport; if
          // the sheet itself scrolls, its absolute handle scrolls away with the
          // issue content.
          className="issue-detail-sheet min-w-0 overflow-hidden"
          style={
            {
              "--issue-detail-width": `${panelWidth}px`,
              width: isDesktop
                ? "var(--issue-detail-width)"
                : "min(94vw, var(--issue-detail-width-default))",
              maxWidth: isDesktop
                ? "var(--issue-detail-width-max)"
                : "var(--issue-detail-width-default)",
            } as CSSProperties
          }
        >
          {isDesktop ? (
            <>
              <div
                role="separator"
                tabIndex={0}
                aria-label={t("resizeHandle")}
                aria-controls={ISSUE_DETAIL_PANEL_ID}
                aria-describedby={ISSUE_DETAIL_RESIZE_DESCRIPTION_ID}
                aria-orientation="vertical"
                aria-valuemin={ISSUE_DETAIL_MIN_WIDTH}
                aria-valuemax={maxWidth}
                aria-valuenow={panelWidth}
                aria-valuetext={`${panelWidth}px`}
                data-testid="issue-detail-resize-handle"
                data-resizing={isResizing ? "true" : "false"}
                className="group absolute inset-y-0 left-0 z-10 flex w-3 touch-none select-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/60"
                data-reef-interaction="resize-panel"
                onKeyDown={onKeyDown}
                onPointerCancel={onPointerCancel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onLostPointerCapture={onLostPointerCapture}
              >
                <span
                  aria-hidden="true"
                  className={
                    isResizing
                      ? "h-full w-px bg-brand-fill"
                      : "h-full w-px bg-border-subtle transition-colors group-hover:bg-brand-fill group-focus-visible:bg-brand-fill"
                  }
                />
              </div>
              <span id={ISSUE_DETAIL_RESIZE_DESCRIPTION_ID} className="sr-only">
                {t("resizeHandleDescription", {
                  current: String(panelWidth),
                  min: String(ISSUE_DETAIL_MIN_WIDTH),
                  max: String(maxWidth),
                })}
              </span>
            </>
          ) : null}
          {/* Visually-hidden title/description satisfy Radix Dialog a11y
              without duplicating the PM-facing identity rendered in the bar. */}
          <SheetTitle className="sr-only">
            {t("srTitle", { issueId })}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("srDescription", { issueId })}
          </SheetDescription>
          {/* Single persistent chrome bar (REEF-286): wayfinding + identity on
              the left, actions + Close on the right. It renders in every state,
              so the id/Back/Close does not blink while the body below skeletons, and
              no state leaves an empty band — the id consistently fills the bar's left
              and Close is the single control on the right (AC1 · AC2 · AC3). The
              history Back (its own `Back navigation` landmark) stays visually
              separate from the structural parent breadcrumb (`Issue hierarchy`),
              so navigation and hierarchy do not read as one trail (AC4 / REEF-270
              AC5). Wrapped with the body in a no-gap column so SheetContent's
              gap-4 doesn't open between the bar and the body. */}
          <IssueChromeSlotProvider value={actionsSlot}>
            <div
              id={ISSUE_DETAIL_PANEL_ID}
              role="region"
              aria-label={t("srTitle", { issueId })}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <div
                data-testid="issue-detail-chrome"
                className="issue-detail-chrome flex items-center gap-2 px-6 pt-4"
              >
                {backTo ? (
                  <IssueDrillBackBar backTo={backTo} onBack={goBack} />
                ) : null}
                <IssueChromeIdentity
                  issueId={issueId}
                  status={issue?.status}
                  issueType={issue ? (issue.issue_type ?? "task") : undefined}
                  isArchived={issue?.archived_at != null}
                  parentId={issue?.parent_id ?? null}
                  allIssues={allIssues ?? []}
                  allIssuesPending={allIssuesPending}
                />
                <div className="issue-detail-actions flex shrink-0 items-center gap-2">
                  {/* `display:contents` so the body's portaled save-status + ⋮
                      become flex siblings of Close, and the slot adds no gap
                      while it is empty during loading. */}
                  <div ref={setActionsSlot} className="contents" />
                  {isDesktop ? (
                    <button
                      type="button"
                      data-testid="issue-detail-width-toggle"
                      aria-label={t(
                        isExpanded ? "restoreWidth" : "expandWidth",
                      )}
                      aria-pressed={isExpanded}
                      onClick={onToggleExpanded}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
                    >
                      {isExpanded ? (
                        <Minimize2 className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Maximize2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
                  <IssueDetailCloseButton onClose={exit} />
                </div>
              </div>
              <div
                data-testid="issue-detail-scroll"
                className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
              >
                {renderBody()}
              </div>
            </div>
          </IssueChromeSlotProvider>
        </SheetContent>
      </Sheet>
    </div>
  );
}
