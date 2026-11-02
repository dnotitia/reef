import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const fixtureLogin = require("./fixture-login.json");
export const REEF_VAULT = "reef-e2e";
export const NOTIFICATION_DATA_MODES = ["healthy", "forbidden", "error"];
export const NOTIFICATION_SCHEMA_MODES = ["healthy", "missing", "incompatible"];
export const INSTALLATION_BLOCKED_REASONS = [
  "worker_timeout",
  "step_failed",
  "fixture_blocked",
  "checksum_mismatch",
  "unknown",
  "null",
  "malformed",
];
export const INSTALLATION_DRIFT_STATUSES = ["in_sync", "mismatch", "unknown"];
export const INSTALLATION_LIFECYCLES = [
  "active",
  "installing",
  "upgrading",
  "blocked",
  "uninstalled",
];
export const INSTALLATION_LOOKUP_MODES = [
  "healthy",
  "forbidden",
  "unavailable",
  "invalid",
];
export const INSTALLATION_OBSERVATION_MODES = ["current", "stale", "missing"];
export const INSTALLATION_ROLES = ["owner", "admin", "writer", "reader"];
export const IMAGE_UPLOAD_FIXTURE_CONTENT_TYPE = "image/png";
export const IMAGE_UPLOAD_FIXTURE_FILE_NAME = "reef-markdown-editor-image.png";
export const IMAGE_UPLOAD_FIXTURE_PATH =
  "/__e2e/assets/reef-markdown-editor-image.png";
export const SUPPORTED_SCENARIOS = [
  "empty",
  "configured",
  "reports_outliers",
  "configured_empty",
  "configured_caught_up",
  "updated_at_range",
  "configured_multi",
  "requester_unset",
  "my_work_multi",
  "assignee_picker",
  "backlog_bulk_partial_failure",
  "demo_board",
  "content_search",
  "raw_only",
  "workspace_recovery",
  "workspace_recovery_current_stamp",
  "notifications_personal",
  "skill_outdated",
  "comment_mentions",
  "activity_display_names",
  "large_vault",
  "markdown_fixture",
  "markdown_mentions",
  "typography",
  "status_quick_edit",
  "planning_overflow",
  "epic_grouping",
  "sprint_rollover",
  "sprint_rollover_empty",
  "installation_drift",
];
export const SUPPORTED_SCENARIO_SET = new Set(SUPPORTED_SCENARIOS);
