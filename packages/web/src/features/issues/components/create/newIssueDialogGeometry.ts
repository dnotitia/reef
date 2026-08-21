"use client";

import {
  type CSSProperties,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const NEW_ISSUE_DIALOG_DEFAULT_MAX_WIDTH = 1200;
export const NEW_ISSUE_DIALOG_MAX_WIDTH = 1680;
export const NEW_ISSUE_DIALOG_EXPANSION_THRESHOLD = 32;
export const NEW_ISSUE_DIALOG_VIEWPORT_GUTTER = 32;
export const NEW_ISSUE_DIALOG_EXPANDED_SESSION_STORAGE_KEY =
  "reef:new-issue-dialog-expanded:v1";

export function getNewIssueDialogDefaultWidth(viewportWidth: number) {
  return Math.min(viewportWidth * 0.94, NEW_ISSUE_DIALOG_DEFAULT_MAX_WIDTH);
}

export function getNewIssueDialogMaxWidth(viewportWidth: number) {
  return Math.min(viewportWidth * 0.94, NEW_ISSUE_DIALOG_MAX_WIDTH);
}

export function getNewIssueDialogMaxHeight(viewportHeight: number) {
  return Math.max(0, viewportHeight - NEW_ISSUE_DIALOG_VIEWPORT_GUTTER);
}

export function canExpandNewIssueDialog({
  viewportWidth,
  viewportHeight,
  normalHeight,
}: {
  viewportWidth: number;
  viewportHeight: number;
  normalHeight: number | null;
}) {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    normalHeight === null ||
    !Number.isFinite(normalHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    (normalHeight ?? 0) <= 0
  ) {
    return false;
  }

  const widthGain =
    getNewIssueDialogMaxWidth(viewportWidth) -
    getNewIssueDialogDefaultWidth(viewportWidth);
  const heightGain = getNewIssueDialogMaxHeight(viewportHeight) - normalHeight;
  return (
    widthGain >= NEW_ISSUE_DIALOG_EXPANSION_THRESHOLD ||
    heightGain >= NEW_ISSUE_DIALOG_EXPANSION_THRESHOLD
  );
}

export function getMaximizedDescriptionHeight({
  viewportHeight,
  normalHeight,
  availableHeight,
}: {
  viewportHeight: number;
  normalHeight: number;
  availableHeight?: number | null;
}) {
  // The shell measures the space remaining in the scrollable form body after
  // the Description heading/title. MarkdownEditor owns the REEF-545 clamp;
  // this value remains transient and is never persisted here.
  if (
    typeof availableHeight === "number" &&
    Number.isFinite(availableHeight) &&
    availableHeight > 320
  ) {
    return availableHeight;
  }

  // Keep a deterministic fallback for the loading/test seam before both
  // layout refs are mounted. The editor still applies its own clamp.
  const additionalHeight = Math.max(
    0,
    getNewIssueDialogMaxHeight(viewportHeight) - normalHeight,
  );
  return 320 + additionalHeight;
}

function readStoredExpanded() {
  try {
    const raw = window.sessionStorage.getItem(
      NEW_ISSUE_DIALOG_EXPANDED_SESSION_STORAGE_KEY,
    );
    if (raw === null) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

function storeExpanded(expanded: boolean) {
  try {
    window.sessionStorage.setItem(
      NEW_ISSUE_DIALOG_EXPANDED_SESSION_STORAGE_KEY,
      JSON.stringify(expanded),
    );
  } catch {
    // Private browsing and disabled storage should not block the dialog.
  }
}

function readViewport() {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface NewIssueDialogGeometry {
  dialogRef: Ref<HTMLDivElement>;
  descriptionFrameRef: Ref<HTMLDivElement>;
  isMaximized: boolean;
  canMaximize: boolean;
  preferredDescriptionHeight?: number;
  dialogStyle?: CSSProperties;
  onToggleMaximize: () => void;
}

/** Owns only create-dialog canvas geometry; the MarkdownEditor owns its height policy. */
export function useNewIssueDialogGeometry(
  open: boolean,
  formBodyRef: { current: HTMLDivElement | null },
): NewIssueDialogGeometry {
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(
    null,
  );
  const dialogRef = useCallback((element: HTMLDivElement | null) => {
    setDialogElement(element);
  }, []);
  const [descriptionFrameElement, setDescriptionFrameElement] =
    useState<HTMLDivElement | null>(null);
  const descriptionFrameRef = useCallback((element: HTMLDivElement | null) => {
    setDescriptionFrameElement(element);
  }, []);
  const [viewport, setViewport] = useState(readViewport);
  const [normalHeight, setNormalHeight] = useState<number | null>(null);
  const normalHeightRef = useRef<number | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const isMaximizedRef = useRef(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [maximizedDescriptionHeight, setMaximizedDescriptionHeight] = useState<
    number | null
  >(null);

  const measureNormalHeight = useCallback(() => {
    const element = dialogElement;
    if (
      !element ||
      (isMaximizedRef.current && normalHeightRef.current !== null)
    )
      return;
    const height = element.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0) return;
    normalHeightRef.current = height;
    setNormalHeight(height);
  }, [dialogElement]);

  const measureMaximizedDescriptionHeight = useCallback(() => {
    if (!isMaximizedRef.current) return;
    const body = formBodyRef.current;
    const frame = descriptionFrameElement;
    if (!body || !frame) return;
    const bodyRect = body.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const frameOffset = frameRect.top - bodyRect.top + body.scrollTop;
    const availableHeight = body.clientHeight - frameOffset;
    if (!Number.isFinite(availableHeight) || availableHeight <= 0) return;
    setMaximizedDescriptionHeight((previous) =>
      previous !== null && Math.abs(previous - availableHeight) < 0.5
        ? previous
        : availableHeight,
    );
  }, [descriptionFrameElement, formBodyRef]);

  const syncViewport = useCallback(() => {
    setViewport(readViewport());
    measureNormalHeight();
    measureMaximizedDescriptionHeight();
  }, [measureMaximizedDescriptionHeight, measureNormalHeight]);

  useEffect(() => {
    const restored = readStoredExpanded();
    isMaximizedRef.current = restored;
    setIsMaximized(restored);
    setSessionLoaded(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncViewport();
    window.addEventListener("resize", syncViewport);

    const observer =
      typeof ResizeObserver === "undefined" || !dialogElement
        ? null
        : new ResizeObserver(() => {
            measureNormalHeight();
            measureMaximizedDescriptionHeight();
          });
    if (observer && dialogElement) observer.observe(dialogElement);

    return () => {
      window.removeEventListener("resize", syncViewport);
      observer?.disconnect();
    };
  }, [
    dialogElement,
    measureMaximizedDescriptionHeight,
    measureNormalHeight,
    open,
    syncViewport,
  ]);

  const canMaximize = useMemo(
    () =>
      open &&
      sessionLoaded &&
      canExpandNewIssueDialog({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        normalHeight: normalHeightRef.current ?? normalHeight,
      }),
    [normalHeight, open, sessionLoaded, viewport.height, viewport.width],
  );

  useEffect(() => {
    if (
      !open ||
      !sessionLoaded ||
      !isMaximized ||
      normalHeightRef.current === null ||
      canMaximize
    )
      return;
    isMaximizedRef.current = false;
    setIsMaximized(false);
    storeExpanded(false);
  }, [canMaximize, isMaximized, open, sessionLoaded]);

  const onToggleMaximize = useCallback(() => {
    if (!canMaximize) return;
    const next = !isMaximizedRef.current;
    isMaximizedRef.current = next;
    setIsMaximized(next);
    if (!next) setMaximizedDescriptionHeight(null);
    storeExpanded(next);
  }, [canMaximize]);

  const effectiveNormalHeight = normalHeightRef.current ?? normalHeight;
  const preferredDescriptionHeight =
    isMaximized && canMaximize && effectiveNormalHeight !== null
      ? getMaximizedDescriptionHeight({
          viewportHeight: viewport.height,
          normalHeight: effectiveNormalHeight,
          availableHeight: maximizedDescriptionHeight,
        })
      : undefined;

  return {
    dialogRef,
    descriptionFrameRef,
    isMaximized,
    canMaximize,
    preferredDescriptionHeight,
    dialogStyle: isMaximized ? { height: "calc(100dvh - 2rem)" } : undefined,
    onToggleMaximize,
  };
}
