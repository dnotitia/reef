import { linkSafetyConfig } from "@/components/markdown/linkSafety";
import { isDirectIssueMarkdownHref } from "@/features/issues/lib/markdownLinkPolicy";
import {
  buildAkbDocumentUrl,
  parseAkbDocumentUri,
} from "@/lib/akb/documentUri";

export const LINK_CLICK_SUPPRESSION_MS = 1000;

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
  akbWebBase: string | null,
): boolean {
  if (isDirectIssueMarkdownHref(renderedHref)) return true;

  // Runtime AKB_WEB_URL retargeting replaces the rendered href but preserves
  // the validated Markdown source in both renderer-owned attributes. Require
  // that pair to agree so an ordinary external href cannot opt itself out of
  // confirmation with a single arbitrary data attribute.
  const documentUri = anchor.getAttribute("data-document-uri");
  const retargetedDocumentUri = anchor.getAttribute("data-akb-uri");
  return (
    documentUri !== null &&
    retargetedDocumentUri === documentUri &&
    parseAkbDocumentUri(documentUri) !== null &&
    buildAkbDocumentUrl(akbWebBase, documentUri) === renderedHref
  );
}

function openEditorLink(
  anchor: HTMLAnchorElement,
  requestExternalConfirmation: (href: string) => void,
  akbWebBase: string | null,
): boolean {
  const authoredHref = anchor.getAttribute("href") ?? "";
  const href = anchor.href || authoredHref;
  if (!href) return false;

  if (
    linkSafetyConfig.enabled &&
    !isDirectEditorLink(anchor, authoredHref, akbWebBase)
  ) {
    requestExternalConfirmation(href);
    return true;
  }

  return openLinkWindow(href, anchor.getAttribute("target") ?? "_blank");
}

export function openClickedEditorLink(
  root: ParentNode,
  event: MouseEvent,
  linksOpenedFromMouseUp: WeakMap<HTMLAnchorElement, number>,
  requestExternalConfirmation: (href: string) => void,
  akbWebBase: string | null,
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
    return true;
  }

  if (!openEditorLink(anchor, requestExternalConfirmation, akbWebBase))
    return false;
  event.preventDefault();
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
  akbWebBase: string | null,
): boolean {
  if (event.button !== 0) return false;
  const anchor = findClickedEditorLink(root, event);
  if (!anchor) return false;
  if (!openEditorLink(anchor, requestExternalConfirmation, akbWebBase))
    return false;

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
