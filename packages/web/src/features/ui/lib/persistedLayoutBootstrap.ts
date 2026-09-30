import {
  ISSUE_DETAIL_DEFAULT_WIDTH,
  ISSUE_DETAIL_DESKTOP_MIN_WIDTH,
  ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY,
  ISSUE_DETAIL_MAX_WIDTH,
  ISSUE_DETAIL_MIN_WIDTH,
  ISSUE_DETAIL_SESSION_STORAGE_KEY,
} from "@/features/issues/components/detail/issueDetailSizing";
import {
  EDITOR_BODY_DEFAULT_HEIGHT,
  EDITOR_BODY_FINE_POINTER_MEDIA_QUERY,
  EDITOR_BODY_MANUAL_FRAME_MARGIN_PX,
  EDITOR_BODY_MAX_HEIGHT,
  EDITOR_BODY_MIN_HEIGHT,
  EDITOR_BODY_RESIZE_MIN_WIDTH,
  EDITOR_BODY_SESSION_STORAGE_KEY,
  EDITOR_BODY_VIEWPORT_RESERVATION,
} from "@/components/markdown-editor/heightResizePolicy";

const persistedLayoutPolicy = JSON.stringify({
  issueDetail: {
    defaultWidth: ISSUE_DETAIL_DEFAULT_WIDTH,
    desktopMinWidth: ISSUE_DETAIL_DESKTOP_MIN_WIDTH,
    expandedKey: ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY,
    maxWidth: ISSUE_DETAIL_MAX_WIDTH,
    minWidth: ISSUE_DETAIL_MIN_WIDTH,
    widthKey: ISSUE_DETAIL_SESSION_STORAGE_KEY,
  },
  markdownEditor: {
    defaultHeight: EDITOR_BODY_DEFAULT_HEIGHT,
    finePointerQuery: EDITOR_BODY_FINE_POINTER_MEDIA_QUERY,
    manualFrameMargin: EDITOR_BODY_MANUAL_FRAME_MARGIN_PX,
    maxHeight: EDITOR_BODY_MAX_HEIGHT,
    minHeight: EDITOR_BODY_MIN_HEIGHT,
    resizeMinWidth: EDITOR_BODY_RESIZE_MIN_WIDTH,
    sessionKey: EDITOR_BODY_SESSION_STORAGE_KEY,
    viewportReservation: EDITOR_BODY_VIEWPORT_RESERVATION,
  },
});

/**
 * Read the current tab's saved editor sizes before the loading surfaces can
 * paint. This is intentionally a static, nonce-authorized inline script: the
 * values are tab-local presentation preferences and never leave the browser.
 */
export const PERSISTED_LAYOUT_BOOTSTRAP_SCRIPT = `(() => {
  const policy = ${persistedLayoutPolicy};
  const root = document.documentElement;
  const readNumber = (key) => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw === null) return null;
      const value = JSON.parse(raw);
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  const issueDetail = policy.issueDetail;
  const editor = policy.markdownEditor;
  const finePointer = window.matchMedia(editor.finePointerQuery);
  const applyLayout = () => {
    const maxWidth = Math.max(
      issueDetail.minWidth,
      Math.min(window.innerWidth * 0.94, issueDetail.maxWidth),
    );
    const savedWidth = readNumber(issueDetail.widthKey);
    const normalWidth = Math.min(
      Math.max(savedWidth ?? issueDetail.defaultWidth, issueDetail.minWidth),
      maxWidth,
    );
    let expanded = false;
    try {
      expanded = window.sessionStorage.getItem(issueDetail.expandedKey) === "true";
    } catch {
      // Use the normal width when tab storage is unavailable.
    }
    const initialWidth = expanded ? maxWidth : normalWidth;
    root.style.setProperty("--issue-detail-width-default", initialWidth + "px");
    root.style.setProperty("--reef-issue-detail-initial-width", initialWidth + "px");

    const resizeAvailable =
      window.innerWidth >= editor.resizeMinWidth && finePointer.matches;
    const maxHeight = Math.max(
      editor.minHeight,
      Math.min(editor.maxHeight, window.innerHeight - editor.viewportReservation),
    );
    const savedHeight = readNumber(editor.sessionKey);
    const initialHeight = Math.min(
      Math.max(savedHeight ?? editor.defaultHeight, editor.minHeight),
      maxHeight,
    );
    root.style.setProperty(
      "--reef-markdown-editor-initial-frame-height",
      resizeAvailable ? initialHeight + "px" : "calc(200px + 1rem)",
    );
    root.style.setProperty(
      "--reef-markdown-editor-frame-margin",
      resizeAvailable ? editor.manualFrameMargin + "px" : "0px",
    );
  };
  applyLayout();
  window.addEventListener("resize", applyLayout, { passive: true });
  finePointer.addEventListener("change", applyLayout);
})();`;
