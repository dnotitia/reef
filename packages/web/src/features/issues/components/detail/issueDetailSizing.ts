export const ISSUE_DETAIL_DESKTOP_MIN_WIDTH = 1280;
export const ISSUE_DETAIL_DEFAULT_WIDTH = 1440;
export const ISSUE_DETAIL_MIN_WIDTH = 1200;
export const ISSUE_DETAIL_MAX_WIDTH = 1680;
export const ISSUE_DETAIL_KEYBOARD_STEP = 32;
export const ISSUE_DETAIL_SESSION_STORAGE_KEY = "reef:issue-detail-width:v2";
export const ISSUE_DETAIL_EXPANDED_SESSION_STORAGE_KEY =
  "reef:issue-detail-expanded:v2";
export const ISSUE_DETAIL_RESTORE_WIDTH_SESSION_STORAGE_KEY =
  "reef:issue-detail-restore-width:v2";

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
