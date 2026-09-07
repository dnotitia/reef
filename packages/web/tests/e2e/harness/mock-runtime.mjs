import {
  fixtureLogin,
  IMAGE_UPLOAD_FIXTURE_CONTENT_TYPE,
  IMAGE_UPLOAD_FIXTURE_FILE_NAME,
  IMAGE_UPLOAD_FIXTURE_PATH,
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
      reset: {
        method: "POST",
        path: "/__e2e/reset",
        content_type: "application/json",
        body: { scenario: "<supported_scenario>" },
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
      issue_list_failure: {
        method: "POST",
        path: "/__e2e/issue-list-failure",
        content_type: "application/json",
        body: { enabled: "<boolean>", next_page_failures: "<count>" },
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
      auth_control: {
        method: "POST",
        path: "/__e2e/auth-control",
        content_type: "application/json",
        body: {
          probe_delay_ms: "<milliseconds>",
          probe_delay_once: "<boolean>",
          probe_hang: "<boolean>",
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
        interaction: {
          type: "notification_inbox",
          operation:
            "open a comment mention notification, confirm it becomes read, and observe the source comment location in the issue activity timeline",
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
        interaction: {
          type: "markdown_editor",
          operation:
            "open the fixture issue, inspect the supported Markdown elements, switch to Source, return to WYSIWYG, and compare the preserved structure",
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
    },
  };
}
