import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { isDirectIssueMarkdownHref } from "@/features/issues/lib/markdownLinkPolicy";
import { isAkbFileUri } from "@/features/issues/lib/attachmentUrls";
import { parseAkbDocumentUri } from "@/lib/akb/documentUri";

const LINK_CLICK_SUPPRESSION_MS = 1000;

function findClickedEditorLink(
  root: ParentNode,
  event: MouseEvent,
): HTMLAnchorElement | null {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest<HTMLAnchorElement>("a[href]") ?? null;
  if (!anchor || !root.contains(anchor)) return null;
  return anchor;
}

export function openLinkWindow(href: string, target = "_blank"): boolean {
  if (!href) return false;

  // Tiptap's built-in openOnClick omits noopener for programmatic opens.
  const opened = window.open(href, target, "noopener,noreferrer");
  try {
    if (opened) opened.opener = null;
  } catch {
    // Cross-origin windows can reject opener mutation; noopener above is primary.
  }
  return true;
}

function isDirectEditorLink(
  anchor: HTMLAnchorElement,
  renderedHref: string,
): boolean {
  if (isDirectIssueMarkdownHref(renderedHref)) return true;

  // The shared Markdown surface preserves the authored target while resolving
  // its runtime href. Validate that target before opening without confirmation.
  const markdownTarget = anchor.dataset.markdownTarget;
  if (
    markdownTarget &&
    (isAkbFileUri(markdownTarget) || parseAkbDocumentUri(markdownTarget))
  ) {
    return true;
  }
  return false;
}

function openEditorLink(
  anchor: HTMLAnchorElement,
  requestExternalConfirmation: (href: string) => void,
): boolean {
  const authoredHref = anchor.getAttribute("href") ?? "";
  const href = anchor.href || authoredHref;
  if (!href) return false;

  if (linkSafetyConfig.enabled && !isDirectEditorLink(anchor, authoredHref)) {
    requestExternalConfirmation(href);
    return true;
  }

  // Mouseup can open the new window before the later click handler clears the
  // browser selection. Clear it first so returning from that window cannot
  // restore the clicked text as an editor selection.
  window.getSelection()?.removeAllRanges();
  return openLinkWindow(href, anchor.getAttribute("target") ?? "_blank");
}

export function openClickedEditorLink(
  root: ParentNode,
  event: MouseEvent,
  linksOpenedFromMouseUp: WeakMap<HTMLAnchorElement, number>,
  requestExternalConfirmation: (href: string) => void,
): boolean {
  if (event.button !== 0) return false;
  const anchor = findClickedEditorLink(root, event);
  if (!anchor) return false;

  const openedAt = linksOpenedFromMouseUp.get(anchor);
  if (
    openedAt !== undefined &&
    Date.now() - openedAt < LINK_CLICK_SUPPRESSION_MS
  ) {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    return true;
  }

  if (!openEditorLink(anchor, requestExternalConfirmation)) return false;
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
  return true;
}

export function preventEditorSelectionOnLinkMouseDown(
  root: ParentNode,
  event: MouseEvent,
): boolean {
  if (event.button !== 0) return false;
  if (!findClickedEditorLink(root, event)) return false;

  event.preventDefault();
  return true;
}

export function openEditorLinkOnMouseUp(
  root: ParentNode,
  event: MouseEvent,
  linksOpenedFromMouseUp: WeakMap<HTMLAnchorElement, number>,
  requestExternalConfirmation: (href: string) => void,
): boolean {
  if (event.button !== 0) return false;
  const anchor = findClickedEditorLink(root, event);
  if (!anchor) return false;
  if (!openEditorLink(anchor, requestExternalConfirmation)) return false;

  linksOpenedFromMouseUp.set(anchor, Date.now());
  event.preventDefault();
  return true;
}

/**
 * Normalize a user-typed link target. Returns null for empty input so the
 * caller can leave the current selection untouched (no link applied). Bare
 * domains gain an https:// scheme; anchors, absolute paths, mailto, and
 * explicit http(s) URLs pass through unchanged.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^akb:\/\//i.test(trimmed)) {
    return parseAkbDocumentUri(trimmed) ? trimmed : null;
  }
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
