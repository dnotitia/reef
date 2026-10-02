import {
  fixtureLogin,
  IMAGE_UPLOAD_FIXTURE_CONTENT_TYPE,
  IMAGE_UPLOAD_FIXTURE_FILE_NAME,
  IMAGE_UPLOAD_FIXTURE_PATH,
  INSTALLATION_BLOCKED_REASONS,
  INSTALLATION_DRIFT_STATUSES,
  INSTALLATION_LIFECYCLES,
  INSTALLATION_LOOKUP_MODES,
  INSTALLATION_OBSERVATION_MODES,
  INSTALLATION_ROLES,
  NOTIFICATION_DATA_MODES,
  NOTIFICATION_SCHEMA_MODES,
  REEF_VAULT,
  SUPPORTED_SCENARIOS,
} from "./mock-fixtures.mjs";
import { markdownFixtureStartPath } from "./mock-state.mjs";

export function runtimeDiscovery(state) {
  return {
    schema_version: 2,
    status: "ready",
    scenario: state.scenario,
    operations: {
      health: { method: "GET", path: "/__e2e/health" },
      state: { method: "GET", path: "/__e2e/state" },
      reset: {
        method: "POST",
        path: "/__e2e/reset",
        content_type: "application/json",
        body: { scenario: "<supported_scenario>" },
      },
      activity_identity_control: {
        method: "POST",
        path: "/__e2e/activity-identity-control",
        content_type: "application/json",
        body: {
          vault: "<vault>",
          username: "<username>",
          display_name: "<display_name>",
        },
      },
      account_denial: {
        method: "POST",
        path: "/__e2e/account-denial",
        content_type: "application/json",
        body: {
          code: "membership_required|account_suspended|identity_conflict|null",
        },
      },
      issue_update_control: {
        method: "POST",
        path: "/__e2e/issue-update-control",
        content_type: "application/json",
        body: {
          vault: "<vault>",
          updates: [
            {
              issue_id: "<issue_id>",
              delay_ms: "<milliseconds>",
              failures: "<count>",
            },
          ],
        },
      },
      markdown_link_search_control: {
        method: "POST",
        path: "/__e2e/markdown-link-search-control",
        content_type: "application/json",
        body: {
          vault: "<vault>",
          query: "<query>",
          delay_ms: "<milliseconds>",
          failure_status: "null|500|503",
        },
      },
      issue_list_failure: {
        method: "POST",
        path: "/__e2e/issue-list-failure",
        content_type: "application/json",
        body: { enabled: "<boolean>", next_page_failures: "<count>" },
      },
      workspace_initialization_control: {
        method: "POST",
        path: "/__e2e/workspace-initialization-control",
        content_type: "application/json",
        body: {
          operation: "document|document_get|tables|null",
          failures: "<count>",
          successes_before_failure: "<count>",
        },
      },
      installation_control: {
        method: "POST",
        path: "/__e2e/installation-control",
        content_type: "application/json",
        body: {
          vault: "<vault>",
          lifecycle: INSTALLATION_LIFECYCLES.join("|"),
          drift: {
            release: INSTALLATION_DRIFT_STATUSES.join("|"),
            schema: INSTALLATION_DRIFT_STATUSES.join("|"),
            grant: INSTALLATION_DRIFT_STATUSES.join("|"),
          },
          observation: INSTALLATION_OBSERVATION_MODES.join("|"),
          blocked_reason: INSTALLATION_BLOCKED_REASONS.join("|"),
          member_lookup: INSTALLATION_LOOKUP_MODES.join("|"),
          detail_lookup: INSTALLATION_LOOKUP_MODES.join("|"),
          roles: {
            alice: INSTALLATION_ROLES.join("|"),
            bob: INSTALLATION_ROLES.join("|"),
            writer: INSTALLATION_ROLES.join("|"),
          },
        },
      },
      planning_catalog_control: {
        method: "POST",
        path: "/__e2e/planning-catalog-failure",
        content_type: "application/json",
        body: { enabled: "<boolean>" },
      },
      issue_reorder_control: {
        method: "POST",
        path: "/__e2e/issue-reorder-control",
        content_type: "application/json",
        body: {
          vault: "<vault>",
          delay_ms: "<milliseconds>",
          failures: "<count>",
        },
      },
      notification_control: {
        method: "POST",
        path: "/__e2e/notification-control",
        content_type: "application/json",
        body: {
          schema_mode: NOTIFICATION_SCHEMA_MODES.join("|"),
          data_mode: NOTIFICATION_DATA_MODES.join("|"),
        },
      },
      auth_control: {
        method: "POST",
        path: "/__e2e/auth-control",
        content_type: "application/json",
        body: {
          probe_delay_ms: "<milliseconds>",
          probe_delay_once: "<boolean>",
          probe_hang: "<boolean>",
          probe_failure_status: "null|500|503",
          session: "active|revoked",
          protected_response: "healthy|unauthorized|forbidden",
        },
      },
    },
    fixture_login: {
      username: fixtureLogin.username,
      password: fixtureLogin.password,
      login_path: fixtureLogin.login_path,
    },
    fixture_inputs: {
      image_upload: {
        method: "GET",
        path: IMAGE_UPLOAD_FIXTURE_PATH,
        file_name: IMAGE_UPLOAD_FIXTURE_FILE_NAME,
        content_type: IMAGE_UPLOAD_FIXTURE_CONTENT_TYPE,
      },
      markdown_link_search: {
        scenario: "markdown_fixture",
        document_query: "Alpha",
        file_query: "incident",
      },
    },
    scenarios: SUPPORTED_SCENARIOS,
    tasks: {
      auth_soft_navigation: {
        scenario: "configured",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues",
        controls: {
          auth_control: [
            "session revoke",
            "bounded probe delay (including one-shot) or hang",
            "temporary auth-probe 5xx response",
            "healthy, plain 401, or resource 403 protected responses",
          ],
          account_denial: [
            "membership_required|account_suspended|identity_conflict|null",
          ],
          protected_response: [
            "forbidden on an ordinary user-directory or member-search interaction (for example assignee or settings) to observe the resource access-denied surface",
          ],
        },
        interaction: {
          type: "auth_soft_navigation",
          operation:
            "verify cold and warm protected destinations stay behind the auth conclusion, revoked sessions converge to same-origin login, stale delayed probes do not win, cross-tab auth changes redirect, and valid slow probes preserve the destination",
        },
      },
      assignee_picker: {
        scenario: "assignee_picker",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues/REEF-001",
        interaction: {
          type: "assignee_picker",
          operation:
            "open issue detail, browse the complete writer/admin/owner roster, search by display name or login, select a candidate, reload to verify recent-first ordering, and verify a failed save leaves the existing assignment and recent history unchanged",
        },
      },
      activity_display_names: {
        scenario: "activity_display_names",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues/REEF-001",
        controls: {
          activity_identity_control: [
            "change a member display name without changing the stable username",
          ],
        },
        identities: {
          current_roster: "fixture.editor",
          blank_display_name: "fixture.blank",
          historical_fallback: "Historical Editor",
          missing_roster_fallback: "retired.editor",
        },
        interaction: {
          type: "activity_display_names",
          operation:
            "inspect creator, status, priority, delivery, assignee, and expanded body-history actors against the current roster; change the editor display name and reload to verify that the stable username resolves to its latest label",
        },
      },
      issue_drill_navigation: {
        scenario: "demo_board",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?view=list",
      },
      epic_grouping: {
        scenario: "epic_grouping",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?view=board&group=epic",
        interaction: {
          type: "issue_grouping",
          operation:
            "inspect flat root-Epic Board columns and List headers, follow the existing Epic detail action, and exercise the no-epic and unavailable-parent fallbacks",
        },
      },
      status_quick_edit: {
        scenario: "status_quick_edit",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?view=list",
        interaction: {
          type: "status_quick_edit",
          operation:
            "configure delayed priority, assignee, labels, and status updates, observe optimistic target values and field-near pending state in List, Backlog, and Board, repeat the same issue activation while pending, and verify independent delayed success, failure rollback, retry, and concurrent success confirmation",
        },
      },
      planning_overflow: {
        scenario: "planning_overflow",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?view=list",
        interaction: {
          type: "planning_overflow_tooltip",
          operation:
            "open the Issues Milestone filter, move the pointer from an overflowing milestone through its tooltip to the adjacent short option, observe active transition and tooltip dismissal, select it, and verify the filter URL and displayed value update at 1280x900 and 390x844",
        },
      },
      planning_read_failures: {
        scenario: "configured",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/planning",
        controls: {
          planning_catalog_control: ["toggle planning catalog failure"],
          issue_list_failure: ["toggle linked issue list failure"],
        },
        interaction: {
          type: "planning_read_failures",
          operation:
            "observe catalog and linked-issue read failures separately from true empty planning data, retry each failed read, and verify the planning rows converge to accurate counts and safe deletion availability",
        },
      },
      flow_metrics_outliers: {
        scenario: "reports_outliers",
        workspace: REEF_VAULT,
        start_path: "/workspace/reef-e2e/reports",
        interaction: {
          type: "report_outlier_navigation",
          operation:
            "open a cycle-time outlier from Reports and navigate to its source issue",
        },
      },
      sprint_rollover: {
        scenario: "sprint_rollover",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/planning",
        controls: {
          issue_update_control: [
            "fail one issue update once for partial retry",
          ],
          auth_control: [
            "set protected_response=forbidden to expose reader access",
          ],
        },
        interaction: {
          type: "sprint_rollover",
          operation:
            "review the unfinished/done/closed/backlog/archived preview, close and roll over to an existing or new target, retry a partial issue move, verify the active target and planning-link activity, and dismiss the overdue UTC nudge",
        },
      },
      sprint_rollover_empty: {
        scenario: "sprint_rollover_empty",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/planning",
        interaction: {
          type: "sprint_rollover_empty",
          operation:
            "close an active sprint with zero unfinished issues and activate the explicitly selected target",
        },
      },
      named_issue_filters: {
        scenario: "configured_multi",
        workspace: "reef-e2e",
        secondary_workspace: "reef-zeta",
        start_path: "/workspace/reef-e2e/issues?view=list",
      },
      backlog_bulk_partial_failure: {
        scenario: "backlog_bulk_partial_failure",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?scope=backlog&view=list",
        interaction: {
          type: "bulk_status_update",
          operation:
            "select the visible Backlog issues, choose In Review from the bulk Status control, observe one successful issue leave Backlog while one failed issue keeps its original Backlog state and selection, then open the failure tray and retry the failed update",
        },
      },
      content_search: {
        scenario: "content_search",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues",
        interaction: {
          type: "global_search",
          shortcut: "Mod+K",
          platform_shortcuts: {
            macos: "Meta+K",
            other: "Control+K",
          },
          query: "issue title, body, or comment phrase",
        },
      },
      chat: {
        scenario: "configured",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues",
        interaction: {
          type: "workspace_chat",
          operation:
            "open Ask AI, submit distinct questions, and observe each assistant response",
        },
      },
      updated_at_range: {
        scenario: "updated_at_range",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?view=list",
      },
      notifications: {
        scenario: "notifications",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/inbox",
        controls: {
          notification_control: [
            "stale schema_version=2 is ignored and remains unchanged",
            "schema_mode=healthy|missing|incompatible",
            "data_mode=healthy|forbidden|error",
            "Alice owner, writer writer, and Bob reader fixture sessions",
          ],
        },
        interaction: {
          type: "notification_inbox",
          operation:
            "verify reader listing and unread badge, writer state transitions, recipient/key isolation, reader PATCH 403 with session preservation, and explicit schema/data failures",
        },
      },
      installation_drift: {
        scenario: "installation_drift",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/settings/workspace",
        identities: {
          owner: {
            username: fixtureLogin.username,
            password: fixtureLogin.password,
            role: "owner",
            installation_detail_access: "allowed",
          },
          writer: {
            username: "writer",
            password: fixtureLogin.password,
            role: "writer",
            installation_detail_access: "not exposed",
          },
          reader: {
            username: "bob",
            password: fixtureLogin.password,
            role: "reader",
            installation_detail_access: "not exposed",
          },
        },
        controls: {
          installation_control: [
            `installation lifecycle: ${INSTALLATION_LIFECYCLES.join("|")}`,
            `release/schema/grant drift: ${INSTALLATION_DRIFT_STATUSES.join("|")}`,
            `observation freshness or absence: ${INSTALLATION_OBSERVATION_MODES.join("|")}`,
            `bounded, unknown, missing, or malformed reason: ${INSTALLATION_BLOCKED_REASONS.join("|")}`,
            `member/detail lookup outcome per vault: ${INSTALLATION_LOOKUP_MODES.join("|")}`,
            `change fixture roles: ${INSTALLATION_ROLES.join("|")}`,
          ],
        },
        interaction: {
          type: "installation_drift",
          operation:
            "compare owner/admin installation details with writer/reader minimal readiness, observe drift warnings without access loss, exercise lifecycle recovery guidance and read failures, then switch to another ready workspace",
        },
      },
      comments: {
        scenario: "comment_mentions",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues",
        interaction: {
          type: "issue_activity",
          operation:
            "open an issue, add a comment, and observe it in the activity timeline",
        },
      },
      markdown_fixture: {
        scenario: "markdown_fixture",
        workspace: REEF_VAULT,
        start_path: markdownFixtureStartPath(state),
        controls: {
          markdown_link_search_control: [
            "delay or fail one AKB search query while preserving the real Reef search route",
          ],
        },
        interaction: {
          type: "markdown_editor",
          operation:
            "open the fixture issue, search for the confirmed incident.log file and Alpha reference document from the link toolbar, select and apply a link, inspect the saved canonical target in Source, then switch back to WYSIWYG",
        },
      },
      large_issue_list: {
        scenario: "large_vault",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?view=list",
      },
      typography_regression: {
        scenario: "typography",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/issues?view=board",
      },
      empty_states: {
        scenario: "configured_empty",
        workspace: "reef-e2e",
        start_paths: {
          my_work: "/workspace/reef-e2e/my-work",
          inbox: "/workspace/reef-e2e/inbox",
          reports: "/workspace/reef-e2e/reports",
          planning: "/workspace/reef-e2e/planning",
        },
      },
      caught_up_states: {
        scenario: "configured_caught_up",
        workspace: "reef-e2e",
        start_path: "/workspace/reef-e2e/my-work",
      },
      workspace_initialization: {
        scenario: "workspace_recovery",
        workspace: "raw-vault",
        start_path: "/onboarding",
        fixture_login: {
          username: "writer",
          password: fixtureLogin.password,
          role: "writer",
          is_admin: false,
        },
        controls: {
          workspace_initialization_control: [
            "fail one document write to leave a partial vault",
            "clear the failure and retry the same workspace name",
          ],
        },
        interaction: {
          type: "workspace_initialization",
          operation:
            "create a workspace as a non-admin, recover a partially initialized same-name vault, preserve existing documents/settings/issues, and retry after a document write failure",
        },
      },
    },
  };
}
