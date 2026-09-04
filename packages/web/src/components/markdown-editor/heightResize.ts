import type { KeyboardEvent, PointerEvent, CSSProperties } from "react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Shared height policy for both editor surfaces — the WYSIWYG body and the
 * Source textarea. An opted-in issue Description starts at a 320px frame so
 * an empty description reads as a real authoring canvas instead of a cramped
 * box. Content scrolls inside that frame instead of stretching the surrounding
 * sheet or dialog, so the relationship fields below stay in normal flow and
 * remain reachable by the scrolling container. The 200px floor remains the
 * lower keyboard/pointer boundary and the clamp adapts to the full-height
 * detail slide-over and the create dialog alike: 48vh keeps the rest of the
 * form in view, and a 960px ceiling caps the height on large monitors. (REEF-133)
 *
 * The dynamic wrapper's loading skeleton reserves the same 320px frame for
 * opted-in issue Descriptions, while other consumers retain their 200px
 * automatic floor. (REEF-220)
 */
export const EDITOR_BODY_SIZING =
  "min-h-[200px] max-h-[clamp(200px,48vh,560px)] overflow-y-auto [scrollbar-gutter:stable]";
export const EDITOR_BODY_FRAME_CLASS = "p-1";
export const EDITOR_CONTENT_CLASS = "reef-markdown-editor";
export const MARKDOWN_SURFACE_CLASS = "reef-markdown-surface";
export const EDITOR_RESIZABLE_BODY_ID = "markdown-editor-body-frame";
export const EDITOR_BODY_MIN_HEIGHT = 200;
export const EDITOR_BODY_DEFAULT_HEIGHT = 320;
export const EDITOR_BODY_MAX_HEIGHT = 960;
export const EDITOR_BODY_KEYBOARD_STEP = 32;
/**
 * The height control is useful once the editor has enough room for a stable
 * writing surface. This is intentionally narrower than the Issue Detail
 * sheet's desktop breakpoint so browser zoom and split-window layouts do not
 * make a mouse-accessible control disappear.
 */
export const EDITOR_BODY_RESIZE_MIN_WIDTH = 1024;
export const EDITOR_BODY_FINE_POINTER_MEDIA_QUERY = "(pointer: fine)";
export const EDITOR_BODY_VIEWPORT_RESERVATION = 160;
export const EDITOR_BODY_SESSION_STORAGE_KEY =
  "reef:issue-description-height:v1";
export const EDITOR_BODY_SESSION_STORAGE_EVENT =
  "reef:issue-description-height-change";
export const EDITOR_RESIZE_DESCRIPTION_ID =
  "markdown-editor-resize-description";

/**
 * Manual height uses a scrollable content surface inside a non-scrolling frame.
 * Keeping the scroll owner below the frame lets the resize chrome stay pinned
 * to the frame's bottom-right edge instead of becoming part of the scrollable
 * content and moving out of view.
 */
export const EDITOR_MANUAL_BODY_CLASS =
  "h-full min-h-0 max-h-none overflow-visible [scrollbar-gutter:stable]";
export const EDITOR_MANUAL_SCROLL_SURFACE_CLASS =
  "h-full min-h-0 overflow-auto [scrollbar-gutter:stable]";
export const EDITOR_MANUAL_SOURCE_CLASS =
  "h-full min-h-0 max-h-none overflow-auto [scrollbar-gutter:stable]";

function subscribeToEditorViewport(
  enabled: boolean,
  onStoreChange: () => void,
) {
  if (!enabled || typeof window === "undefined") return () => {};
  window.addEventListener("resize", onStoreChange);
  return () => window.removeEventListener("resize", onStoreChange);
}

function subscribeToEditorPointer(enabled: boolean, onStoreChange: () => void) {
  if (
    !enabled ||
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }

  const mediaQuery = window.matchMedia(EDITOR_BODY_FINE_POINTER_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getEditorViewportSnapshot() {
  if (typeof window === "undefined") return "0:0";
  return `${window.innerWidth}:${window.innerHeight}`;
}

function getServerEditorViewportSnapshot() {
  return "0:0";
}

function getEditorPointerSnapshot() {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "0";
  }
  return window.matchMedia(EDITOR_BODY_FINE_POINTER_MEDIA_QUERY).matches
    ? "1"
    : "0";
}

function getServerEditorPointerSnapshot() {
  return "0";
}

function parseEditorViewportSnapshot(snapshot: string) {
  const [width, height] = snapshot.split(":").map(Number);
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

export function getEditorMaxHeight(viewportHeight: number) {
  return Math.max(
    EDITOR_BODY_MIN_HEIGHT,
    Math.min(
      EDITOR_BODY_MAX_HEIGHT,
      viewportHeight - EDITOR_BODY_VIEWPORT_RESERVATION,
    ),
  );
}

export function clampEditorHeight(value: number, maxHeight: number) {
  const safeMax = Math.max(EDITOR_BODY_MIN_HEIGHT, maxHeight);
  if (!Number.isFinite(value)) {
    return Math.min(EDITOR_BODY_DEFAULT_HEIGHT, safeMax);
  }
  return Math.min(Math.max(value, EDITOR_BODY_MIN_HEIGHT), safeMax);
}

function subscribeToStoredEditorHeight(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(EDITOR_BODY_SESSION_STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(
      EDITOR_BODY_SESSION_STORAGE_EVENT,
      onStoreChange,
    );
  };
}

function getStoredEditorHeightSnapshot() {
  try {
    return window.sessionStorage.getItem(EDITOR_BODY_SESSION_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getServerStoredEditorHeightSnapshot() {
  return "";
}

function parseStoredEditorHeight(snapshot: string) {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function storeEditorHeight(height: number) {
  try {
    window.sessionStorage.setItem(
      EDITOR_BODY_SESSION_STORAGE_KEY,
      JSON.stringify(height),
    );
    window.dispatchEvent(new Event(EDITOR_BODY_SESSION_STORAGE_EVENT));
  } catch {
    // Private browsing and disabled storage should not block resizing.
  }
}

export interface MarkdownEditorHeightResizeHandlers {
  isResizeAvailable: boolean;
  isManual: boolean;
  isResizing: boolean;
  maxHeight: number;
  currentHeight: number;
  bodyFrameStyle?: CSSProperties;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  refreshAutoHeight: () => void;
}

export function useMarkdownEditorHeightResize(
  enabled: boolean,
  preferredHeight?: number,
): MarkdownEditorHeightResizeHandlers {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeToEditorViewport(enabled, onStoreChange),
    [enabled],
  );
  const subscribeToPointer = useCallback(
    (onStoreChange: () => void) =>
      subscribeToEditorPointer(enabled, onStoreChange),
    [enabled],
  );
  const viewportSnapshot = useSyncExternalStore(
    subscribe,
    getEditorViewportSnapshot,
    getServerEditorViewportSnapshot,
  );
  const pointerSnapshot = useSyncExternalStore(
    subscribeToPointer,
    getEditorPointerSnapshot,
    getServerEditorPointerSnapshot,
  );
  const { width: viewportWidth, height: viewportHeight } =
    parseEditorViewportSnapshot(viewportSnapshot);
  const storedEditorHeightSnapshot = useSyncExternalStore(
    subscribeToStoredEditorHeight,
    getStoredEditorHeightSnapshot,
    getServerStoredEditorHeightSnapshot,
  );
  const storedEditorHeight = parseStoredEditorHeight(
    storedEditorHeightSnapshot,
  );
  const liveViewportWidth =
    viewportWidth || (typeof window === "undefined" ? 0 : window.innerWidth);
  const liveViewportHeight =
    viewportHeight || (typeof window === "undefined" ? 0 : window.innerHeight);
  const isResizeAvailable =
    enabled &&
    pointerSnapshot === "1" &&
    liveViewportWidth >= EDITOR_BODY_RESIZE_MIN_WIDTH;
  const maxHeight = getEditorMaxHeight(liveViewportHeight);
  const [manualHeightState, setManualHeight] = useState<number | null>(null);
  const [currentHeight, setCurrentHeight] = useState(
    EDITOR_BODY_DEFAULT_HEIGHT,
  );
  const [isResizing, setIsResizing] = useState(false);
  const persistedManualHeight =
    isResizeAvailable && storedEditorHeight !== null
      ? clampEditorHeight(storedEditorHeight, maxHeight)
      : null;
  const preferredManualHeightCandidate =
    isResizeAvailable &&
    typeof preferredHeight === "number" &&
    Number.isFinite(preferredHeight)
      ? clampEditorHeight(preferredHeight, maxHeight)
      : null;
  const preferredManualHeight =
    preferredManualHeightCandidate !== null &&
    (persistedManualHeight === null ||
      preferredManualHeightCandidate > persistedManualHeight)
      ? preferredManualHeightCandidate
      : null;
  const defaultManualHeight = clampEditorHeight(
    EDITOR_BODY_DEFAULT_HEIGHT,
    maxHeight,
  );
  const effectiveHeight =
    manualHeightState ??
    preferredManualHeight ??
    persistedManualHeight ??
    defaultManualHeight;
  const manualHeightRef = useRef<number | null>(manualHeightState);
  const currentHeightRef = useRef(EDITOR_BODY_DEFAULT_HEIGHT);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  // Opted-in issue descriptions always own a fixed frame. This callback is
  // retained for the editor's value-sync seam, but it deliberately never
  // measures content: an empty body must not collapse the 320px default.
  const refreshAutoHeight = useCallback(() => {
    if (!isResizeAvailable || manualHeightState !== null) return;
    const nextHeight = clampEditorHeight(
      preferredManualHeight ??
        persistedManualHeight ??
        EDITOR_BODY_DEFAULT_HEIGHT,
      maxHeight,
    );
    currentHeightRef.current = nextHeight;
    setCurrentHeight(nextHeight);
  }, [
    isResizeAvailable,
    manualHeightState,
    maxHeight,
    persistedManualHeight,
    preferredManualHeight,
  ]);

  useLayoutEffect(() => {
    if (!isResizeAvailable || liveViewportHeight <= 0) {
      manualHeightRef.current = manualHeightState;
      return;
    }
    if (manualHeightState !== null) {
      const nextHeight = clampEditorHeight(manualHeightState, maxHeight);
      manualHeightRef.current = nextHeight;
      currentHeightRef.current = nextHeight;
      if (nextHeight !== manualHeightState) {
        setManualHeight(nextHeight);
        storeEditorHeight(nextHeight);
      }
      setCurrentHeight(nextHeight);
      return;
    }

    manualHeightRef.current = null;
    currentHeightRef.current = effectiveHeight;
    setCurrentHeight(effectiveHeight);
    if (
      persistedManualHeight !== null &&
      persistedManualHeight !== storedEditorHeight
    ) {
      storeEditorHeight(persistedManualHeight);
    }
  }, [
    effectiveHeight,
    isResizeAvailable,
    liveViewportHeight,
    manualHeightState,
    maxHeight,
    persistedManualHeight,
    storedEditorHeight,
  ]);

  const enterManualMode = useCallback(() => {
    if (!isResizeAvailable) return null;
    const existingHeight = manualHeightRef.current;
    const nextHeight = clampEditorHeight(
      existingHeight ?? effectiveHeight,
      maxHeight,
    );
    manualHeightRef.current = nextHeight;
    setManualHeight(nextHeight);
    currentHeightRef.current = nextHeight;
    setCurrentHeight(nextHeight);
    return nextHeight;
  }, [effectiveHeight, isResizeAvailable, maxHeight]);

  const updateHeight = useCallback(
    (value: number) => {
      if (!isResizeAvailable) return;
      const nextHeight = clampEditorHeight(value, maxHeight);
      manualHeightRef.current = nextHeight;
      currentHeightRef.current = nextHeight;
      setManualHeight(nextHeight);
      setCurrentHeight(nextHeight);
      storeEditorHeight(nextHeight);
    },
    [isResizeAvailable, maxHeight],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isResizeAvailable) return;
      let nextHeight: number | null = null;
      switch (event.key) {
        case "ArrowDown":
          nextHeight =
            (enterManualMode() ?? currentHeightRef.current) +
            EDITOR_BODY_KEYBOARD_STEP;
          break;
        case "ArrowUp":
          nextHeight =
            (enterManualMode() ?? currentHeightRef.current) -
            EDITOR_BODY_KEYBOARD_STEP;
          break;
        case "Home":
          enterManualMode();
          nextHeight = EDITOR_BODY_MIN_HEIGHT;
          break;
        case "End":
          enterManualMode();
          nextHeight = maxHeight;
          break;
        default:
          return;
      }
      event.preventDefault();
      if (nextHeight !== null) updateHeight(nextHeight);
    },
    [enterManualMode, isResizeAvailable, maxHeight, updateHeight],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isResizeAvailable || event.button !== 0) return;
      const startHeight = enterManualMode();
      if (startHeight === null) return;
      event.preventDefault();
      event.currentTarget.focus();
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
    },
    [enterManualMode, isResizeAvailable],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      updateHeight(drag.startHeight + (event.clientY - drag.startY));
    },
    [updateHeight],
  );

  const finishPointerResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      }
      dragRef.current = null;
      setIsResizing(false);
    },
    [],
  );

  const isManual = isResizeAvailable;
  const accessibleHeight = clampEditorHeight(
    isManual ? effectiveHeight : currentHeight,
    maxHeight,
  );

  return {
    isResizeAvailable,
    isManual,
    isResizing,
    maxHeight,
    currentHeight: accessibleHeight,
    bodyFrameStyle: isManual ? { height: `${accessibleHeight}px` } : undefined,
    onKeyDown,
    onLostPointerCapture: finishPointerResize,
    onPointerCancel: finishPointerResize,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointerResize,
    refreshAutoHeight,
  };
}
