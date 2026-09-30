export const EDITOR_BODY_MIN_HEIGHT = 200;
export const EDITOR_BODY_DEFAULT_HEIGHT = 320;
export const EDITOR_BODY_MAX_HEIGHT = 960;
export const EDITOR_BODY_MANUAL_FRAME_MARGIN_PX = 4;
export const EDITOR_BODY_KEYBOARD_STEP = 32;
export const EDITOR_BODY_RESIZE_MIN_WIDTH = 1024;
export const EDITOR_BODY_FINE_POINTER_MEDIA_QUERY = "(pointer: fine)";
export const EDITOR_BODY_VIEWPORT_RESERVATION = 160;
export const EDITOR_BODY_SESSION_STORAGE_KEY =
  "reef:issue-description-height:v1";
export const EDITOR_RESIZE_DESCRIPTION_ID =
  "markdown-editor-resize-description";

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
